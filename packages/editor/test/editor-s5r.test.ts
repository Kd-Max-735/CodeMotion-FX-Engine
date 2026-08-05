import { describe, expect, it } from "vitest";
import { validateContract } from "@codemotion/schema";
import { makeTextExtrudeRasterFixture } from "@codemotion/effects-3d";
import { createProjectFrameProducer } from "@codemotion/exporter";
import { resolveLayerTimeSample, resolveProjectTimeSample } from "@codemotion/timeline";
import { P0_EDITOR_EFFECTS, createP0EffectInstance, effectParameterFields } from "../src/effect-catalog.js";
import { createStarterProject, mainLayers } from "../src/model.js";
import { EditorStore } from "../src/store.js";

function isolateLayer(project: ReturnType<typeof createStarterProject>, layerId: string): void {
  for (const layer of mainLayers(project)) layer.visible = layer.id === layerId;
}

function realShapeSource(width: number, height: number) {
  return {
    kind: "shape",
    viewport: { x: 0, y: 0, width, height },
    paths: [{
      commands: [
        { op: "move", x: width * 0.1, y: height * 0.1 },
        { op: "line", x: width * 0.9, y: height * 0.1 },
        { op: "line", x: width * 0.9, y: height * 0.9 },
        { op: "line", x: width * 0.1, y: height * 0.9 },
        { op: "close" }
      ],
      fillRule: "nonzero",
      fill: "#ff5a3c",
      stroke: null,
      strokeWidth: 0
    }]
  };
}

async function renderProject(project: ReturnType<typeof createStarterProject>, quality: "preview" | "final") {
  for (const composition of project.compositions) {
    for (const layer of composition.layers) {
      for (const effect of layer.effects) effect.renderQuality = quality;
    }
  }
  const pixels = await createProjectFrameProducer(project, new Map(), { timeContractVersion: "1.1.0" })({
    frame: 30,
    time: 1,
    deltaTime: 1 / 30,
    fps: 30,
    width: 64,
    height: 36
  });
  return { pixels, time: 1, quality };
}

describe("Stage 5R editor integration", () => {
  it("exposes exactly 40 complete Schema-driven effects and three presets each", () => {
    expect(P0_EDITOR_EFFECTS).toHaveLength(40);
    expect(new Set(P0_EDITOR_EFFECTS.map((effect) => effect.effectId)).size).toBe(40);
    for (const effect of P0_EDITOR_EFFECTS) {
      const properties = (effect.parameterSchema as { properties: Record<string, unknown> }).properties;
      const fields = effectParameterFields(effect);
      expect(fields.map((field) => field.name)).toEqual(Object.keys(properties));
      expect(fields.length).toBeGreaterThan(0);
      expect(effect.presets).toHaveLength(3);
      for (const preset of effect.presets) expect(Object.keys(preset.params)).toEqual(Object.keys(properties));
    }
  });

  it("adds, selects, enables, sorts, presets, keyframes and deletes through generic commands", () => {
    const project = createStarterProject();
    const store = new EditorStore(undefined, project);
    store.selectLayer("layer.accent");
    const firstDefinition = P0_EDITOR_EFFECTS[0]!;
    const secondDefinition = P0_EDITOR_EFFECTS[1]!;
    store.addEffect("layer.accent", firstDefinition.effectId);
    const first = mainLayers(store.getSnapshot().document.project)[1]!.effects[0]!;
    expect(store.getSnapshot().selectedEffectId).toBe(first.id);
    store.toggleEffect("layer.accent", first.id);
    expect(mainLayers(store.getSnapshot().document.project)[1]!.effects[0]!.enabled).toBe(false);
    store.applyEffectPreset("layer.accent", first.id, 0);
    const field = effectParameterFields(firstDefinition).find((entry) => entry.keyframeable)!;
    store.setTime(2);
    store.addEffectKeyframe("layer.accent", first.id, field);
    store.updateEffectParameter("layer.accent", first.id, field, field.type === "number" ? field.maximum ?? 1 : "changed");
    store.addEffect("layer.accent", secondDefinition.effectId, 0);
    const second = mainLayers(store.getSnapshot().document.project)[1]!.effects[1]!;
    store.reorderEffect("layer.accent", second.id, -1);
    expect(mainLayers(store.getSnapshot().document.project)[1]!.effects[0]!.id).toBe(second.id);
    store.deleteEffect("layer.accent", second.id);
    store.setZoom(200);
    expect(store.getSnapshot().zoom).toBe(200);
    expect(mainLayers(store.getSnapshot().document.project)[1]!.effects).toHaveLength(1);
    expect(validateContract("MotionProject", store.getSnapshot().document.project).valid).toBe(true);
  });

  it("keeps all 40 created instances valid without effect-specific editor branches", () => {
    const project = createStarterProject();
    const layer = mainLayers(project)[1]!;
    layer.effects = P0_EDITOR_EFFECTS.map((effect, index) =>
      createP0EffectInstance(effect.effectId, index % 3, `effect.s5r.${index}`)
    );
    expect(validateContract("MotionProject", project).valid).toBe(true);
  });

  it("renders a real shape effect through the shared G5 producer at preview and final quality", async () => {
    const project = createStarterProject("shared renderer", 64, 36, 30);
    isolateLayer(project, "layer.accent");
    const layer = mainLayers(project)[1]!;
    layer.opacity = { mode: "constant", value: 1 };
    layer.transform.position = { mode: "constant", value: { x: 0, y: 0, z: 0 } };
    layer.properties = {
      ...layer.properties,
      rasterSource: realShapeSource(64, 36)
    } as unknown as typeof layer.properties;
    layer.effects = [createP0EffectInstance(P0_EDITOR_EFFECTS[0]!.effectId, 1, "effect.shared.motion")];
    const preview = await renderProject(project, "preview");
    const final = await renderProject(project, "final");
    expect(preview.pixels).toHaveLength(64 * 36 * 4);
    expect(preview.pixels.some((byte) => byte !== 0)).toBe(true);
    expect(final.pixels.some((byte) => byte !== 0)).toBe(true);
    expect(preview.time).toBe(final.time);
    expect(preview.quality).toBe("preview");
    expect(final.quality).toBe("final");
  });

  it("renders T08 from real glyph coverage through the shared G5 producer", async () => {
    const project = createStarterProject("T08 editor", 64, 36, 30);
    isolateLayer(project, "layer.title");
    const layer = mainLayers(project)[2]!;
    layer.properties = { ...layer.properties, text: "FX" } as typeof layer.properties;
    layer.opacity = { mode: "constant", value: 1 };
    layer.transform.position = { mode: "constant", value: { x: 0, y: 0, z: 0 } };
    const projectTime = resolveProjectTimeSample({ projectTime: 1, previousProjectTime: 29 / 30, fps: 30 });
    const layerTime = resolveLayerTimeSample(layer, projectTime);
    const fixture = makeTextExtrudeRasterFixture("FX", 64, 36, layerTime);
    layer.properties = {
      ...layer.properties,
      rasterSource: fixture.rasterInput.source
    } as unknown as typeof layer.properties;
    layer.effects = [createP0EffectInstance("fx.text.textExtrude3D", 1, "effect.shared.t08")];
    const result = await renderProject(project, "preview");
    expect(result.pixels.some((byte) => byte !== 0)).toBe(true);
  });
});
