import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertEffectToolDefinition,
  executeSelectedEffectTool,
  type AuthorizedEffectInputs,
  type EffectInputKind,
  type EffectToolDefinition,
  type ServerEffectRenderContext
} from "../../../src/index.js";
import {
  BATCH_08_DEFINITIONS,
  BEAT_PULSE_DEFINITION,
  CHART_REVEAL_DEFINITION,
  GLASS_DEFINITION,
  HOLOGRAM_DEFINITION,
  LIVE_BINDING_DEFINITION,
  METAL_DEFINITION,
  NUMBER_COUNTER_DEFINITION,
  ONSET_TRIGGER_DEFINITION,
  TEXTURE_OVERLAY_DEFINITION,
  VOCAL_REACTIVE_TEXT_DEFINITION
} from "../../../src/batches/batch-08/index.js";

const audioAnalysis = Object.freeze({
  version: "audio-analysis-v1",
  duration: 2,
  frames: Object.freeze([
    Object.freeze({ time: 0, rms: 0.1, peak: 0.2, bass: 0.1, mid: 0.1, vocal: 0.15, high: 0.08, beatConfidence: 0.1, onsetStrength: 0.2 }),
    Object.freeze({ time: 0.5, rms: 0.8, peak: 0.95, bass: 0.75, mid: 0.7, vocal: 0.9, high: 0.55, beatConfidence: 0.92, onsetStrength: 0.88 }),
    Object.freeze({ time: 1, rms: 0.25, peak: 0.4, bass: 0.2, mid: 0.3, vocal: 0.35, high: 0.25, beatConfidence: 0.15, onsetStrength: 0.2 })
  ])
});

function authorized(slot: string, kind: EffectInputKind, binding: unknown) {
  return Object.freeze({
    slot,
    kind,
    tenantId: "tenant-b08",
    userId: "user-b08",
    locked: true as const,
    binding
  });
}

function context(
  definition: EffectToolDefinition,
  inputs: AuthorizedEffectInputs,
  time = 0.5
): ServerEffectRenderContext {
  return {
    environment: "server",
    requestId: "request-b08",
    tenantId: "tenant-b08",
    userId: "user-b08",
    time,
    deltaTime: 1 / 30,
    frame: Math.round(time * 30),
    fps: 30,
    width: 1920,
    height: 1080,
    seed: 804,
    quality: "final",
    backend: definition.primaryBackend,
    inputs
  };
}

function modelOutput(definition: EffectToolDefinition) {
  return { type: definition.toolName, data: { ...definition.defaults } };
}

async function run(definition: EffectToolDefinition, inputs: AuthorizedEffectInputs, time = 0.5) {
  return executeSelectedEffectTool(
    definition,
    definition.toolName,
    modelOutput(definition),
    context(definition, inputs, time)
  );
}

const targetSurface = Object.freeze({
  version: "material-surface-v1",
  baseColor: Object.freeze([0.35, 0.5, 0.7, 1]),
  facing: 0.45,
  luminance: 0.62
});

describe("batch-08 definitions", () => {
  it("exports ten independent, contract-valid definitions with about three presets each", () => {
    expect(BATCH_08_DEFINITIONS).toHaveLength(10);
    expect(new Set(BATCH_08_DEFINITIONS.map((definition) => definition.effectId)).size).toBe(10);
    expect(new Set(BATCH_08_DEFINITIONS.map((definition) => definition.toolName)).size).toBe(10);
    for (const definition of BATCH_08_DEFINITIONS) {
      expect(() => assertEffectToolDefinition(definition)).not.toThrow();
      expect(definition.presets).toHaveLength(3);
      expect(definition.parameterSchema).toMatchObject({ type: "object", additionalProperties: false });
    }
  });

  it("uses real server-bound analysis for beat, onset, and vocal response", async () => {
    const audioInputs = { audio_analysis: authorized("audio_analysis", "audio", audioAnalysis) };
    const beat = await run(BEAT_PULSE_DEFINITION, audioInputs);
    expect(beat.output).toMatchObject({ analysisVersion: "audio-analysis-v1", pulse: 0.92 });

    const onset = await run(ONSET_TRIGGER_DEFINITION, {
      ...audioInputs,
      target_effect: authorized("target_effect", "data", { version: "effect-target-v1", handle: "server-effect-4" })
    });
    expect(onset.output).toMatchObject({ triggered: true, targetEffectHandle: "server-effect-4" });
    const beforeOnset = await run(ONSET_TRIGGER_DEFINITION, {
      ...audioInputs,
      target_effect: authorized("target_effect", "data", { version: "effect-target-v1", handle: "server-effect-4" })
    }, 0.49);
    expect(beforeOnset.output).toMatchObject({ triggered: false, triggerTime: null });

    const vocal = await run(VOCAL_REACTIVE_TEXT_DEFINITION, {
      ...audioInputs,
      text_layer: authorized("text_layer", "data", { version: "text-layer-v1", layerHandle: "layer-text-7" }),
      text_font: authorized("text_font", "font", { version: "font-binding-v1", fontHandle: "font-server-2" })
    });
    expect(vocal.output).toMatchObject({ layerHandle: "layer-text-7", fontHandle: "font-server-2", property: "scale" });
    expect((vocal.output as { energy: number }).energy).toBeGreaterThan(0.5);
  });

  it("renders number and chart values only from server-validated data", async () => {
    const counter = await run(NUMBER_COUNTER_DEFINITION, {
      number_range: authorized("number_range", "data", { version: "validated-number-v1", from: 10, to: 110 })
    }, 0.6);
    expect((counter.output as { value: number }).value).toBeGreaterThan(10);
    expect((counter.output as { value: number }).value).toBeLessThan(110);

    const chart = await run(CHART_REVEAL_DEFINITION, {
      chart_data: authorized("chart_data", "data", {
        version: "validated-chart-v1",
        series: [{ label: "A", value: 4 }, { label: "B", value: 9 }]
      })
    }, 0.75);
    expect(chart.output).toMatchObject({ chartType: "bar", items: [{ label: "A", value: 4 }, { label: "B", value: 9 }] });
  });

  it("limits live binding to validated snapshots and allow-listed target properties", async () => {
    const validInput = {
      validated_binding: authorized("validated_binding", "data", {
        version: "validated-live-binding-v1",
        value: 75,
        previousValue: 50,
        minimum: 0,
        maximum: 100,
        targetHandle: "layer-safe-3",
        targetProperty: "opacity"
      })
    };
    const result = await run(LIVE_BINDING_DEFINITION, validInput);
    expect(result.output).toMatchObject({ targetHandle: "layer-safe-3", targetProperty: "opacity", applied: true });

    await expect(run(LIVE_BINDING_DEFINITION, {
      validated_binding: authorized("validated_binding", "data", {
        version: "validated-live-binding-v1",
        value: 1,
        previousValue: 0,
        minimum: 0,
        maximum: 1,
        targetHandle: "layer-safe-3",
        targetProperty: "constructor"
      })
    })).rejects.toThrow("approved property");

    await expect(executeSelectedEffectTool(
      LIVE_BINDING_DEFINITION,
      LIVE_BINDING_DEFINITION.toolName,
      { type: LIVE_BINDING_DEFINITION.toolName, data: { ...LIVE_BINDING_DEFINITION.defaults, source: "value.secret" } },
      context(LIVE_BINDING_DEFINITION, validInput)
    )).rejects.toMatchObject({ code: "PARAMETER_INVALID" });
  });

  it("composites a server texture with blend, opacity, motion, and premultiplied alpha", async () => {
    const result = await run(TEXTURE_OVERLAY_DEFINITION, {
      base_layer: authorized("base_layer", "data", { version: "pixel-layer-v1", sample: [0.2, 0.4, 0.6, 0.5] }),
      overlay_texture: authorized("overlay_texture", "texture", { version: "texture-sample-v1", sample: [0.8, 0.5, 0.25, 0.5], width: 512, height: 256 })
    }, 2);
    expect(result.output).toMatchObject({
      rgba: [0.2035, 0.2563, 0.3056, 0.6125],
      textureSize: [512, 256],
      blendMode: "overlay",
      premultipliedAlpha: true
    });
  });

  it("keeps glass, metal, and hologram as distinct material models", async () => {
    const glass = await run(GLASS_DEFINITION, {
      target_layer: authorized("target_layer", "data", targetSurface),
      backdrop_layer: authorized("backdrop_layer", "data", { version: "pixel-layer-v1", sample: [0.2, 0.3, 0.4, 1] })
    });
    const metal = await run(METAL_DEFINITION, {
      target_layer: authorized("target_layer", "data", targetSurface),
      environment_texture: authorized("environment_texture", "texture", { version: "texture-sample-v1", sample: [0.8, 0.7, 0.6, 1], width: 1024, height: 512 })
    });
    const hologram = await run(HOLOGRAM_DEFINITION, {
      target_layer: authorized("target_layer", "data", targetSurface),
      depth_map: authorized("depth_map", "depth-map", { version: "depth-sample-v1", depth: 0.8 })
    });
    expect((glass.output as { materialModel: string }).materialModel).toBe("dielectric_transmission");
    expect((metal.output as { materialModel: string }).materialModel).toBe("conductive_pbr");
    expect((hologram.output as { materialModel: string }).materialModel).toBe("emissive_hologram");
  });
});

describe("batch-08 Chinese field specifications", () => {
  const specDirectory = join(dirname(fileURLToPath(import.meta.url)), "../../../field-specs/batch-08");

  it("provides ten complete specs whose JSON examples parse and contain no binding fields", () => {
    const files = readdirSync(specDirectory).filter((name) => name.endsWith(".md"));
    expect(files).toHaveLength(10);
    const forbidden = /"(?:audio|source|dataSource|texture|font|layer|effectRef|resourceId|path|url)"\s*:/u;
    const specTypes: string[] = [];
    for (const file of files) {
      const markdown = readFileSync(join(specDirectory, file), "utf8");
      for (const heading of ["工具作用", "输出约束", "参数字段", "选择策略", "参数优先级", "自然语言示例", "推荐值、默认值和中性值", "非适用范围"]) {
        expect(markdown, `${file} missing ${heading}`).toContain(heading);
      }
      const jsonBlocks = [...markdown.matchAll(/```json\s*([\s\S]*?)```/gu)];
      expect(jsonBlocks, `${file} JSON example count`).toHaveLength(1);
      const example = JSON.parse(jsonBlocks[0]![1]!) as { type: string; data: Record<string, unknown> };
      expect(Object.keys(example)).toEqual(["type", "data"]);
      expect(example.type).toMatch(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u);
      expect(markdown).toContain(`toolName：\`${example.type}\``);
      specTypes.push(example.type);
      expect(example.data).not.toBeNull();
      expect(forbidden.test(jsonBlocks[0]![1]!)).toBe(false);
      const naturalExamples = markdown.match(/^\d+\. .+$/gmu) ?? [];
      expect(naturalExamples.length, `${file} natural examples`).toBeGreaterThanOrEqual(5);
      expect(naturalExamples.length, `${file} natural examples`).toBeLessThanOrEqual(8);
    }
    expect(specTypes.sort()).toEqual(BATCH_08_DEFINITIONS.map((definition) => definition.toolName).sort());
  });
});
