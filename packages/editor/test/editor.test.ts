import { describe, expect, it, vi } from "vitest";
import { loadProject, saveProject, validateContract } from "@codemotion/schema";
import { EFFECT_DRAG_MIME, LAB_PIPELINE_EFFECT_ID, isLabPipelineEffect } from "../src/lab-effect.js";
import { AUTOSAVE_KEY, EditorStore } from "../src/store.js";
import { LAYER_PROPERTY_SCHEMA, createStarterProject, locateProjectError, mainLayers, pipelineEffect } from "../src/model.js";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

function field(path: string, component?: string) {
  const result = LAYER_PROPERTY_SCHEMA.sections.flatMap((section) => section.fields)
    .find((candidate) => candidate.path === path && candidate.component === component);
  if (!result) throw new Error(`Missing field ${path}.${component ?? ""}`);
  return result;
}

describe("stage 4 editor", () => {
  it("creates a valid editable project using the frozen core contract", () => {
    const project = createStarterProject("Schema project", 1080, 1920, 60);
    const result = validateContract("MotionProject", project);
    expect(result.valid).toBe(true);
    expect(project.compositions[0]?.layers).toHaveLength(3);
  });

  it("creates a Schema-valid project wrapper for the internal renderer validation pass", () => {
    const project = createStarterProject();
    const effect = pipelineEffect();
    project.compositions[0]!.layers[1]!.effects.push(effect);

    expect(EFFECT_DRAG_MIME).toBe("application/x-cmfx-effect");
    expect(effect.effectId).toBe(LAB_PIPELINE_EFFECT_ID);
    expect(isLabPipelineEffect(effect)).toBe(true);
    expect(validateContract("MotionProject", project).valid).toBe(true);
  });

  it("covers property, layer, effect and keyframe commands with undo and redo", () => {
    const store = new EditorStore(undefined, createStarterProject());
    store.selectLayer("layer.accent");
    store.setTime(1.5);
    store.updateSelected(field("transform.position", "x"), 720);
    expect(store.propertyValue(field("transform.position", "x"))).toBe(720);
    store.addKeyframe("transform.scale");
    store.toggleLayer("layer.accent", "visible");
    store.addPipelineEffect("layer.accent");
    const edited = mainLayers(store.getSnapshot().document.project).find((layer) => layer.id === "layer.accent");
    expect(edited?.visible).toBe(false);
    expect(edited?.effects[0]?.effectId).toBe(LAB_PIPELINE_EFFECT_ID);
    expect(validateContract("MotionProject", store.getSnapshot().document.project).valid).toBe(true);
    store.undo();
    expect(mainLayers(store.getSnapshot().document.project).find((layer) => layer.id === "layer.accent")?.effects).toHaveLength(0);
    store.redo();
    expect(mainLayers(store.getSnapshot().document.project).find((layer) => layer.id === "layer.accent")?.effects).toHaveLength(1);
    store.addLayer();
    const addedId = store.getSnapshot().document.selectedLayerId;
    expect(mainLayers(store.getSnapshot().document.project)).toHaveLength(4);
    if (!addedId) throw new Error("New layer was not selected.");
    store.duplicateLayer(addedId);
    expect(mainLayers(store.getSnapshot().document.project)).toHaveLength(5);
    const copyId = store.getSnapshot().document.selectedLayerId;
    if (!copyId) throw new Error("Copied layer was not selected.");
    store.deleteLayer(copyId);
    expect(mainLayers(store.getSnapshot().document.project)).toHaveLength(4);
    store.undo();
    expect(mainLayers(store.getSnapshot().document.project)).toHaveLength(5);
  });

  it("autosaves, restarts, recovers, replays history and round-trips a pipeline effect", () => {
    vi.useFakeTimers();
    try {
      const storage = new MemoryStorage();
      const store = new EditorStore(storage, createStarterProject("Recovery source"));
      store.addPipelineEffect("layer.accent");
      expect(store.getSnapshot().saveStatus).toBe("dirty");
      vi.advanceTimersByTime(500);
      expect(store.getSnapshot().saveStatus).toBe("saved");

      const autosave = storage.getItem(AUTOSAVE_KEY);
      expect(autosave).not.toBeNull();
      const firstEnvelope = JSON.parse(autosave!) as { projectJson: string };
      const firstLoaded = loadProject(firstEnvelope.projectJson);
      const firstEffect = mainLayers(firstLoaded).find((layer) => layer.id === "layer.accent")?.effects[0];
      expect(firstEffect).toMatchObject({
        effectId: LAB_PIPELINE_EFFECT_ID,
        enabled: true,
        params: { strength: { mode: "constant", value: 1 } }
      });

      const restarted = new EditorStore(storage, createStarterProject("Blank"));
      expect(restarted.getSnapshot().recoverable).toBe(true);
      restarted.recover();
      expect(restarted.getSnapshot().saveStatus).toBe("saved");
      expect(restarted.getSnapshot().recoverable).toBe(false);
      const recoveredLayer = mainLayers(restarted.getSnapshot().document.project).find((layer) => layer.id === "layer.accent");
      expect(recoveredLayer?.effects).toHaveLength(1);
      expect(recoveredLayer?.effects[0]).toEqual(firstEffect);

      restarted.addPipelineEffect("layer.accent");
      vi.advanceTimersByTime(500);
      expect(restarted.getSnapshot().saveStatus).toBe("saved");
      expect(mainLayers(loadAutosave(storage)).find((layer) => layer.id === "layer.accent")?.effects).toHaveLength(2);

      restarted.undo();
      vi.advanceTimersByTime(500);
      expect(restarted.getSnapshot().saveStatus).toBe("saved");
      expect(mainLayers(loadAutosave(storage)).find((layer) => layer.id === "layer.accent")?.effects).toHaveLength(1);

      restarted.redo();
      vi.advanceTimersByTime(500);
      expect(restarted.getSnapshot().saveStatus).toBe("saved");
      expect(mainLayers(loadAutosave(storage)).find((layer) => layer.id === "layer.accent")?.effects).toHaveLength(2);

      const download = restarted.exportJson();
      expect(saveProject(loadProject(download))).toBe(download);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the current project and reports a corrupt autosave without throwing", () => {
    const storage = new MemoryStorage();
    storage.setItem(AUTOSAVE_KEY, "{not-json");
    const store = new EditorStore(storage, createStarterProject("Current project"));

    expect(() => store.recover()).not.toThrow();
    expect(store.getSnapshot()).toMatchObject({
      saveStatus: "error",
      recoverable: true,
      document: { project: { name: "Current project" } },
      error: { message: expect.stringContaining("自动保存恢复失败") }
    });
    expect(storage.getItem(AUTOSAVE_KEY)).toBe("{not-json");
  });

  it("locates validation errors to layer, effect and parameter", () => {
    const project = createStarterProject();
    const effect = pipelineEffect();
    effect.params.strength = Number.NaN;
    project.compositions[0]?.layers[1]?.effects.push(effect);
    const result = validateContract("MotionProject", project);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    const error = { message: "Project validation failed", details: { issues: result.issues } };
    const located = locateProjectError(error, project);
    expect(located.layerId).toBe("layer.accent");
    expect(located.effectId).toBe(effect.id);
    expect(located.parameter).toBe("strength");
  });

  it("meets the 200ms timeline and 100ms parameter feedback budgets", () => {
    const store = new EditorStore(undefined, createStarterProject());
    const timelineStart = performance.now();
    for (let frame = 0; frame < 2_000; frame += 1) store.setTime((frame % 240) / 30);
    const timelineMs = performance.now() - timelineStart;

    store.selectLayer("layer.accent");
    const parameterStart = performance.now();
    store.updateSelected(field("opacity"), 0.42);
    const parameterMs = performance.now() - parameterStart;

    expect(timelineMs).toBeLessThan(200);
    expect(parameterMs).toBeLessThan(100);
    expect(store.propertyValue(field("opacity"))).toBe(0.42);
  });
});

function loadAutosave(storage: MemoryStorage) {
  const raw = storage.getItem(AUTOSAVE_KEY);
  if (!raw) throw new Error("Expected an autosaved project.");
  return loadProject((JSON.parse(raw) as { projectJson: string }).projectJson);
}
