import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateContract } from "@codemotion/schema";
import type { EffectDefinition, JsonObject } from "@codemotion/core";
import type { EffectRenderContext } from "@codemotion/renderer-api";
import { WebGLRendererAdapter } from "@codemotion/renderer-webgl";
import { FakeWebGL2Context } from "../../renderer-webgl/test/fake-webgl.js";
import {
  GROUP_2_BLUEPRINTS,
  GROUP_2_P0_EFFECTS,
  P0_EFFECTS,
  P0_EFFECTS_BY_ID,
  createCatalogWebGLPass,
  createGroup2P0Effects,
  hashPixelSurface,
  makePreviewInput,
  makeTextExtrudePreviewInput,
  normalizeEffectParams,
  type ParameterSpec,
  type PixelSurface,
  verifyGroup3TextExtrudeInterface
} from "../src/index.js";

const golden = JSON.parse(readFileSync(
  new URL("./fixtures/golden-frames.json", import.meta.url),
  "utf8"
)) as {
  schemaVersion: string;
  width: number;
  height: number;
  t08Source: {
    width: number;
    height: number;
    seed: number;
    quality: "final";
  };
  frames: Record<string, Record<string, string>>;
};

const definitionKeys = [
  "schemaVersion", "effectId", "version", "displayName", "category", "description",
  "tags", "inputTypes", "outputType", "parameterSchema", "uiSchema", "defaultPreset",
  "renderBackends", "preferredBackend", "fallbackBackend", "deterministic", "supportsAlpha",
  "supportsMask", "supportsKeyframes", "supportsExpressions", "performanceClass",
  "qualityLevels", "validationRules", "migrations"
] as const;

function contractView(effect: EffectDefinition): EffectDefinition {
  return Object.fromEntries(definitionKeys.map((key) => [key, effect[key]])) as unknown as EffectDefinition;
}

function extremes(effectId: string): JsonObject {
  const blueprint = GROUP_2_BLUEPRINTS.find((item) => item.effectId === effectId);
  if (!blueprint) throw new Error(effectId);
  const values: JsonObject = {};
  for (const parameter of blueprint.parameters) {
    values[parameter.name] = parameter.kind === "number" ? Number.POSITIVE_INFINITY
      : parameter.kind === "vector2" ? [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]
        : parameter.kind === "enum" ? "__invalid__"
          : parameter.kind === "boolean" ? "__invalid__"
            : "x".repeat(parameter.maxLength + 10);
  }
  return values;
}

function parameterCandidates(spec: ParameterSpec): readonly unknown[] {
  if (spec.kind === "number") {
    const span = spec.max - spec.min;
    return [
      spec.min,
      spec.max,
      spec.min + span * 0.25,
      spec.min + span * 0.73
    ].filter((value) => Math.abs(value - spec.default) > Number.EPSILON);
  }
  if (spec.kind === "enum") return spec.options.filter((value) => value !== spec.default);
  if (spec.kind === "boolean") return [!spec.default];
  if (spec.kind === "text") {
    return [
      `${spec.default}-semantic-variant`.slice(0, spec.maxLength),
      "alternate-source".slice(0, spec.maxLength),
      "Z9".slice(0, spec.maxLength)
    ].filter((value) => value !== spec.default && value.length >= spec.minLength);
  }
  return [
    [spec.min, spec.max],
    [spec.max, spec.min],
    [spec.min + (spec.max - spec.min) * 0.27, spec.min + (spec.max - spec.min) * 0.71]
  ];
}

function surfaceData(surface: PixelSurface): number[] {
  return Array.from(surface.data);
}

function premultiplySurface(surface: PixelSurface): PixelSurface {
  const data = new Uint8ClampedArray(surface.data.length);
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = surface.data[offset + 3]!;
    data[offset] = Math.round(surface.data[offset]! * alpha / 255);
    data[offset + 1] = Math.round(surface.data[offset + 1]! * alpha / 255);
    data[offset + 2] = Math.round(surface.data[offset + 2]! * alpha / 255);
    data[offset + 3] = alpha;
  }
  return { ...surface, data, alphaMode: "premultiplied" };
}

function fallbackContext(
  effectId: string,
  params: Readonly<Record<string, unknown>>,
  source: PixelSurface,
  secondary: PixelSurface,
  progress: number
): EffectRenderContext {
  return {
    time: progress,
    deltaTime: 1 / 30,
    frame: Math.round(progress * 30),
    fps: 30,
    width: source.width,
    height: source.height,
    seed: 20260728,
    quality: "final",
    colorSpace: "srgb",
    inputTextures: [],
    params,
    renderer: { backend: "canvas2d" } as EffectRenderContext["renderer"],
    data: {
      effectId,
      pixelSurface: { ...source, data: surfaceData(source) },
      secondarySurface: { ...secondary, data: surfaceData(secondary) }
    }
  };
}

describe("Group 2 P0 catalog", () => {
  it("contains exactly the 39 frozen Group 2 IDs and excludes Group 3 T08", () => {
    expect(GROUP_2_P0_EFFECTS).toHaveLength(39);
    expect(new Set(GROUP_2_P0_EFFECTS.map((effect) => effect.effectId)).size).toBe(39);
    expect(new Set(GROUP_2_P0_EFFECTS.map((effect) => effect.sourceId)).size).toBe(39);
    expect(GROUP_2_P0_EFFECTS.some((effect) => effect.effectId === "fx.text.textExtrude3D")).toBe(false);
    expect(GROUP_2_P0_EFFECTS.map((effect) => effect.effectId))
      .toEqual(GROUP_2_BLUEPRINTS.map((effect) => effect.effectId));
  });

  it("aggregates exactly 40 unique non-placeholder effects in frozen slot order", () => {
    expect(P0_EFFECTS).toHaveLength(40);
    expect(P0_EFFECTS_BY_ID.size).toBe(40);
    expect(new Set(P0_EFFECTS.map((effect) => effect.effectId)).size).toBe(40);
    expect(new Set(P0_EFFECTS.map((effect) => effect.sourceId)).size).toBe(40);
    expect(P0_EFFECTS[15]?.sourceId).toBe("T08");
    expect(P0_EFFECTS[15]?.effectId).toBe("fx.text.textExtrude3D");
    expect(P0_EFFECTS[16]?.sourceId).toBe("V01");
    for (const effect of P0_EFFECTS) {
      expect(effect.description.length).toBeGreaterThan(10);
      expect(effect.description).not.toMatch(/placeholder|stub|todo/iu);
      expect(typeof effect.render).toBe("function");
      expect(typeof effect.renderPixels).toBe("function");
      expect(typeof effect.dispose).toBe("function");
      expect(effect.presets).toHaveLength(3);
      expect(effect.preview.asset).toContain(effect.sourceId);
    }
    const canonicalRegistry = JSON.stringify(P0_EFFECTS.map((effect, index) => ({
      slot: index + 1,
      sourceId: effect.sourceId,
      effectId: effect.effectId,
      version: effect.version,
      owner: effect.implementationOwner
    })));
    expect(createHash("sha256").update(canonicalRegistry).digest("hex"))
      .toBe("f827b6cf684fa6963e00ce33d4dd90efbd6b03ba6505c3d0149058bd53d73a3c");
  });

  it.each(GROUP_2_P0_EFFECTS)("$sourceId $effectId has a valid complete definition", (effect) => {
    const result = validateContract("EffectDefinition", contractView(effect));
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
    expect(effect.version).toBe("1.0.0");
    expect(effect.preferredBackend).toBe("webgl");
    expect(effect.fallbackBackend).toBe("canvas2d");
    expect(effect.qualityLevels.map((level) => level.quality)).toEqual(["draft", "preview", "final"]);
    expect(effect.performanceClass).toMatch(/^(light|medium|heavy|extreme)$/u);
    expect(effect.documentation.readme).toContain("README.md");
    expect(effect.documentation.changelog).toContain("CHANGELOG.md");
    expect(effect.preview.asset).toContain(effect.sourceId);
  });

  it.each(GROUP_2_P0_EFFECTS)("$sourceId $effectId has constrained params, UI and 3 usable presets", (effect) => {
    const schema = effect.parameterSchema as JsonObject;
    const ui = effect.uiSchema;
    const required = schema.required as string[];
    const properties = schema.properties as JsonObject;
    const fields = ui.fields as JsonObject;
    expect(required.length).toBeGreaterThanOrEqual(4);
    expect(Object.keys(properties)).toEqual(required);
    expect(Object.keys(fields)).toEqual(required);
    expect(effect.presets).toHaveLength(3);
    expect(new Set(effect.presets.map((preset) => preset.presetId)).size).toBe(3);
    for (const preset of effect.presets) {
      expect(preset.effectId).toBe(effect.effectId);
      expect(preset.version).toBe(effect.version);
      expect(normalizeEffectParams(effect.effectId, preset.params)).toEqual(preset.params);
      expect(preset.previewAsset).toContain(effect.sourceId);
    }
  });

  it.each(GROUP_2_P0_EFFECTS)(
    "$sourceId $effectId gives every declared parameter observable CPU and Canvas2D-fallback semantics",
    async (effect) => {
      const blueprint = GROUP_2_BLUEPRINTS.find((item) => item.effectId === effect.effectId)!;
      const source = makePreviewInput(64, 36);
      const secondary = makePreviewInput(64, 36, true);
      for (const parameter of blueprint.parameters) {
        let observation: { readonly progress: number; readonly value: unknown } | undefined;
        for (const progress of [0.23, 0.51, 0.77]) {
          const baseline = effect.renderPixels(source, effect.defaultPreset, {
            progress,
            seed: 20260728,
            quality: "final",
            secondary
          });
          const baselineHash = hashPixelSurface(baseline);
          for (const value of parameterCandidates(parameter)) {
            const candidate = effect.renderPixels(source, {
              ...effect.defaultPreset,
              [parameter.name]: value
            }, {
              progress,
              seed: 20260728,
              quality: "final",
              secondary
            });
            if (hashPixelSurface(candidate) !== baselineHash) {
              observation = { progress, value };
              break;
            }
          }
          if (observation) break;
        }
        expect(
          observation,
          `${effect.sourceId} ${effect.effectId}.${parameter.name} did not change any tested frame`
        ).toBeDefined();
        const baselineFallback = await effect.render(fallbackContext(
          effect.effectId,
          effect.defaultPreset,
          source,
          secondary,
          observation!.progress
        ));
        const candidateFallback = await effect.render(fallbackContext(
          effect.effectId,
          { ...effect.defaultPreset, [parameter.name]: observation!.value },
          source,
          secondary,
          observation!.progress
        ));
        expect(baselineFallback.type).toBe("frame");
        expect(candidateFallback.type).toBe("frame");
        if (baselineFallback.type === "frame" && candidateFallback.type === "frame") {
          expect(
            candidateFallback.data.pixels,
            `${effect.sourceId} ${effect.effectId}.${parameter.name} fallback remained unchanged`
          ).not.toEqual(baselineFallback.data.pixels);
        }
      }
    }
  );

  it("has one deterministic Golden Frame per effect at 0/25/50/75/100%", () => {
    const source = makePreviewInput(golden.width, golden.height);
    const secondary = makePreviewInput(golden.width, golden.height, true);
    const mask = makePreviewInput(golden.width, golden.height);
    expect(golden.schemaVersion).toBe("1.0.0");
    expect(Object.keys(golden.frames)).toHaveLength(40);
    for (const effect of GROUP_2_P0_EFFECTS) {
      const expected = golden.frames[effect.effectId];
      expect(expected).toBeDefined();
      for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
        const rendered = effect.renderPixels(
          source,
          { ...effect.defaultPreset, progress },
          { progress, seed: 20260728, quality: "final", secondary, mask }
        );
        expect(hashPixelSurface(rendered), `${effect.effectId}@${progress}`).toBe(expected![String(progress)]);
      }
    }
    const t08 = P0_EFFECTS.find((effect) => effect.sourceId === "T08");
    expect(t08).toBeDefined();
    const t08Source = makeTextExtrudePreviewInput(golden.t08Source.width, golden.t08Source.height);
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      const rendered = t08!.renderPixels(
        t08Source,
        { ...t08!.defaultPreset, progress },
        { progress, seed: golden.t08Source.seed, quality: golden.t08Source.quality }
      );
      expect(hashPixelSurface(rendered), `T08@${progress}`)
        .toBe(golden.frames[t08!.effectId]![String(progress)]);
    }
  });

  it.each(GROUP_2_P0_EFFECTS)("$sourceId $effectId is deterministic and clamps extreme/null-like params", (effect) => {
    const source = makePreviewInput(20, 12);
    const secondary = makePreviewInput(20, 12, true);
    const normalized = normalizeEffectParams(effect.effectId, {
      ...extremes(effect.effectId),
      ...Object.fromEntries(Object.keys(effect.defaultPreset).map((key) => [key, null]))
    });
    const first = effect.renderPixels(source, normalized, {
      progress: 0.5,
      seed: 99,
      quality: "draft",
      secondary
    });
    const second = effect.renderPixels(source, normalized, {
      progress: 0.5,
      seed: 99,
      quality: "draft",
      secondary
    });
    expect(first.data).toEqual(second.data);
    expect(first.data.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)).toBe(true);
  });

  it.each(GROUP_2_P0_EFFECTS)("$sourceId $effectId preserves transparent Alpha and obeys a zero mask", (effect) => {
    const transparent = makePreviewInput(10, 6);
    transparent.data.fill(0);
    const secondary = makePreviewInput(10, 6, true);
    secondary.data.fill(0);
    const zeroMask = makePreviewInput(10, 6);
    zeroMask.data.fill(0);
    const unmasked = effect.renderPixels(transparent, effect.defaultPreset, {
      progress: 0.5,
      seed: 7,
      quality: "draft",
      secondary
    });
    if (effect.category !== "vector" && effect.category !== "draw") {
      for (let offset = 3; offset < unmasked.data.length; offset += 4) expect(unmasked.data[offset]).toBe(0);
    }
    for (let offset = 0; offset < unmasked.data.length; offset += 4) {
      if (unmasked.data[offset + 3] === 0) {
        expect(unmasked.data.slice(offset, offset + 3)).toEqual(new Uint8ClampedArray([0, 0, 0]));
      }
    }
    const masked = effect.renderPixels(makePreviewInput(10, 6), effect.defaultPreset, {
      progress: 0.5,
      seed: 7,
      quality: "draft",
      secondary,
      mask: zeroMask
    });
    for (let offset = 3; offset < masked.data.length; offset += 4) expect(masked.data[offset]).toBe(0);
  });

  it.each(GROUP_2_P0_EFFECTS)(
    "$sourceId $effectId keeps straight and premultiplied fallback output equivalent",
    (effect) => {
      const straight = makePreviewInput(32, 18);
      const secondaryStraight = makePreviewInput(32, 18, true);
      const premultiplied = premultiplySurface(straight);
      const secondaryPremultiplied = premultiplySurface(secondaryStraight);
      const straightOutput = effect.renderPixels(straight, effect.defaultPreset, {
        progress: 0.51,
        seed: 20260728,
        quality: "final",
        secondary: secondaryStraight
      });
      const premultipliedOutput = effect.renderPixels(premultiplied, effect.defaultPreset, {
        progress: 0.51,
        seed: 20260728,
        quality: "final",
        secondary: secondaryPremultiplied
      });
      let maxDelta = 0;
      for (let offset = 0; offset < straightOutput.data.length; offset += 4) {
        expect(premultipliedOutput.data[offset + 3]).toBe(straightOutput.data[offset + 3]);
        const alpha = straightOutput.data[offset + 3]!;
        for (let channel = 0; channel < 3; channel += 1) {
          const expected = Math.round(straightOutput.data[offset + channel]! * alpha / 255);
          maxDelta = Math.max(
            maxDelta,
            Math.abs(expected - premultipliedOutput.data[offset + channel]!)
          );
        }
        if (alpha === 0) {
          expect(premultipliedOutput.data.slice(offset, offset + 3))
            .toEqual(new Uint8ClampedArray([0, 0, 0]));
        }
      }
      expect(maxDelta, `${effect.effectId} exceeded 8-bit associate/unassociate error`).toBeLessThanOrEqual(8);
    }
  );

  it.each(GROUP_2_P0_EFFECTS.filter((effect) => effect.category === "transition"))(
    "$sourceId $effectId maps progress endpoints exactly to A/B without a mask",
    (effect) => {
      const a = makePreviewInput(12, 8);
      const b = makePreviewInput(12, 8, true);
      expect(effect.renderPixels(a, { ...effect.defaultPreset, progress: 0 }, {
        progress: 0, seed: 1, quality: "final", secondary: b
      }).data).toEqual(a.data);
      expect(effect.renderPixels(a, { ...effect.defaultPreset, progress: 1 }, {
        progress: 1, seed: 1, quality: "final", secondary: b
      }).data).toEqual(b.data);
    }
  );

  it("provides a compilable WebGL2 path descriptor for every effect", () => {
    for (const effect of GROUP_2_P0_EFFECTS) {
      const blueprint = GROUP_2_BLUEPRINTS.find((item) => item.effectId === effect.effectId)!;
      const pass = createCatalogWebGLPass(
        blueprint,
        effect.defaultPreset,
        0.5,
        7,
        "preview",
        16,
        9
      );
      expect(pass.id).toBe(effect.effectId);
      expect(pass.fragmentSource).toContain("#version 300 es");
      expect(pass.fragmentSource).toContain("outColor");
      expect(pass.uniforms.u_progress).toBe(0.5);
    }
  });

  it("executes all 40 registered WebGL paths and releases every GPU allocation once", async () => {
    const gl = new FakeWebGL2Context();
    const adapter = new WebGLRendererAdapter({ contextFactory: () => gl });
    adapter.initialize({ width: 16, height: 9, colorSpace: "srgb", quality: "preview" });
    const descriptor = {
      width: 16,
      height: 9,
      format: "rgba8" as const,
      colorSpace: "srgb" as const,
      samples: 1,
      usage: "input" as const
    };
    const a = adapter.createTexture(descriptor);
    const b = adapter.createTexture(descriptor);
    const mask = adapter.createTexture({ ...descriptor, usage: "mask" });
    const frame = {
      time: 0.5,
      deltaTime: 1 / 30,
      frame: 15,
      fps: 30,
      width: 16,
      height: 9,
      seed: 20260728,
      quality: "preview" as const,
      colorSpace: "srgb" as const
    };
    const effectContext = {
      ...frame,
      inputTextures: [a, b],
      params: P0_EFFECTS[0]!.defaultPreset,
      mask,
      renderer: adapter
    };
    adapter.beginFrame(effectContext);
    for (const effect of P0_EFFECTS) {
      effectContext.params = effect.defaultPreset;
      const output = await effect.render(effectContext);
      expect(output.type).toBe("texture");
      if (output.type === "texture") adapter.releaseTexture(output.texture);
    }
    adapter.endFrame(effectContext);
    adapter.releaseTexture(a);
    adapter.releaseTexture(b);
    adapter.releaseTexture(mask);
    adapter.dispose();
    expect(gl.drawCalls).toBeGreaterThanOrEqual(40);
    for (const texture of gl.createdTextures) {
      expect(gl.deletedTextures.filter((deleted) => deleted === texture)).toHaveLength(1);
    }
    for (const framebuffer of gl.createdFramebuffers) {
      expect(gl.deletedFramebuffers.filter((deleted) => deleted === framebuffer)).toHaveLength(1);
    }
  });

  it("documents every effect in README and CHANGELOG", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
    for (const effect of GROUP_2_P0_EFFECTS) {
      expect(readme).toContain(effect.effectId);
      expect(readme).toContain(`id="${effect.sourceId.toLowerCase()}-${effect.effectId.replaceAll(".", "").toLowerCase()}"`);
      expect(changelog).toContain(`### ${effect.sourceId}`);
      expect(changelog).toContain(effect.effectId);
    }
  });

  it("releases each effect instance through dispose", () => {
    const effects = createGroup2P0Effects();
    const source = makePreviewInput(4, 4);
    for (const effect of effects) {
      effect.dispose();
      expect(() => effect.renderPixels(source)).toThrow(/disposed/u);
    }
  });

  it("recognizes the delivered Group 3 T08 frozen interface and acceptance metadata", () => {
    const t08 = P0_EFFECTS_BY_ID.get("fx.text.textExtrude3D");
    expect(t08).toBeDefined();
    expect(verifyGroup3TextExtrudeInterface(t08)).toEqual({
      effectId: "fx.text.textExtrude3D",
      available: true,
      compatible: true,
      missing: []
    });
    expect(t08!.version).toBe("1.0.0");
    expect(t08!.implementationOwner).toBe("Group 3");
    expect(validateContract("EffectDefinition", contractView(t08!)).valid).toBe(true);
    const schema = t08!.parameterSchema as JsonObject;
    const required = schema.required as string[];
    const properties = schema.properties as JsonObject;
    const fields = t08!.uiSchema.fields as JsonObject;
    for (const name of ["depth", "bevel", "material", "light"]) {
      expect(required).toContain(name);
      expect(properties[name]).toBeDefined();
      expect(fields[name]).toBeDefined();
    }
    expect(t08!.presets).toHaveLength(3);
    expect(t08!.preferredBackend).toBe("webgl");
    expect(t08!.fallbackBackend).toBe("canvas2d");
    expect(t08!.qualityLevels.map((level) => level.quality)).toEqual(["draft", "preview", "final"]);
    expect(t08!.performanceClass).toBe("heavy");
    expect(t08!.benchmarkBudgetMs).toBeGreaterThan(0);
    expect(t08!.supportsAlpha).toBe(true);
    expect(t08!.supportsMask).toBe(true);
    expect(t08!.deterministic).toBe(true);
  });
});
