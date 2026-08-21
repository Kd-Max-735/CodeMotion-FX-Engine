import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type AuthorizedEffectInputs,
  type EffectInputKind,
  type EffectToolDefinition,
  type ServerEffectRenderContext
} from "../../../src/types.js";
import {
  assertEffectToolDefinition,
  executeSelectedEffectTool,
  validateAndNormalizeEffectEnvelope
} from "../../../src/validation.js";
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
import { MAX_AUDIO_ANALYSIS_FRAMES } from "../../../src/batches/batch-08/audio-analysis.js";

const EXPECTED_IDENTITIES = Object.freeze([
  ["fx.audio.beatPulse", "beat_pulse"],
  ["fx.audio.onsetTrigger", "onset_trigger"],
  ["fx.audio.vocalReactiveText", "vocal_reactive_text"],
  ["fx.data.numberCounter", "number_counter"],
  ["fx.data.chartReveal", "chart_reveal"],
  ["fx.data.liveBinding", "live_binding"],
  ["fx.composite.textureOverlay", "texture_overlay"],
  ["fx.material.glass", "glass"],
  ["fx.material.metal", "metal"],
  ["fx.material.hologram", "hologram"]
] as const);

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

function validInputs(definition: EffectToolDefinition): AuthorizedEffectInputs {
  switch (definition.toolName) {
    case "beat_pulse":
      return { audio_analysis: authorized("audio_analysis", "audio", audioAnalysis) };
    case "onset_trigger":
      return {
        audio_analysis: authorized("audio_analysis", "audio", audioAnalysis),
        target_effect: authorized("target_effect", "data", { version: "effect-target-v1", handle: "server-effect-4" })
      };
    case "vocal_reactive_text":
      return {
        audio_analysis: authorized("audio_analysis", "audio", audioAnalysis),
        text_layer: authorized("text_layer", "data", { version: "text-layer-v1", layerHandle: "layer-text-7" }),
        text_font: authorized("text_font", "font", { version: "font-binding-v1", fontHandle: "font-server-2" })
      };
    case "number_counter":
      return { source_image: authorized("source_image", "image", {
        version: "rgba8-frame-v1", width: 1920, height: 1080, data: new Uint8Array(1920 * 1080 * 4)
      }) };
    case "chart_reveal":
      return {
        chart_data: authorized("chart_data", "data", {
          version: "validated-chart-v1",
          series: [{ label: "A", value: 4 }, { label: "B", value: 9 }]
        })
      };
    case "live_binding":
      return {
        source_image: authorized("source_image", "image", {
          version: "rgba8-frame-v1", width: 1920, height: 1080, data: new Uint8Array(1920 * 1080 * 4)
        }),
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
    case "texture_overlay":
      return {
        base_image: authorized("base_image", "image", { version: "rgba8-frame-v1", width: 1920, height: 1080, data: new Uint8Array(1920 * 1080 * 4) }),
        overlay_image: authorized("overlay_image", "image", { version: "rgba8-frame-v1", width: 1920, height: 1080, data: new Uint8Array(1920 * 1080 * 4) }),
        subject_mask: authorized("subject_mask", "mask", { version: "sam31-mask-v1", width: 1920, height: 1080, data: new Uint8Array(1920 * 1080) })
      };
    case "glass":
      return {
        target_layer: authorized("target_layer", "data", targetSurface),
        backdrop_layer: authorized("backdrop_layer", "data", { version: "pixel-layer-v1", sample: [0.2, 0.3, 0.4, 1] })
      };
    case "metal":
      return {
        target_layer: authorized("target_layer", "data", targetSurface),
        environment_texture: authorized("environment_texture", "texture", { version: "texture-sample-v1", sample: [0.8, 0.7, 0.6, 1], width: 1024, height: 512 })
      };
    case "hologram":
      return {
        target_layer: authorized("target_layer", "data", targetSurface),
        depth_map: authorized("depth_map", "depth-map", { version: "depth-sample-v1", depth: 0.8 })
      };
    default:
      throw new TypeError(`No batch-08 fixture for ${definition.toolName}.`);
  }
}

function expectFiniteTree(value: unknown, depth = 0): void {
  expect(depth).toBeLessThanOrEqual(8);
  if (typeof value === "number") {
    expect(Number.isFinite(value)).toBe(true);
    return;
  }
  if (Array.isArray(value)) {
    expect(value.length).toBeLessThanOrEqual(MAX_AUDIO_ANALYSIS_FRAMES);
    for (const item of value) expectFiniteTree(item, depth + 1);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) expectFiniteTree(item, depth + 1);
  }
}

describe("batch-08 definitions", () => {
  it("exports the ten exact names with closed Schema/default/preset consistency", () => {
    expect(BATCH_08_DEFINITIONS.map((definition) => [definition.effectId, definition.toolName]))
      .toEqual(EXPECTED_IDENTITIES);
    for (const definition of BATCH_08_DEFINITIONS) {
      expect(() => assertEffectToolDefinition(definition)).not.toThrow();
      expect(definition.presets).toHaveLength(3);
      expect(definition.primaryBackend.deterministic).toBe(true);
      expect(definition.parameterSchema).toMatchObject({ type: "object", additionalProperties: false });
      const schema = definition.parameterSchema as {
        properties: Record<string, { default: unknown }>;
      };
      expect(Object.keys(schema.properties).sort()).toEqual(Object.keys(definition.defaults).sort());
      for (const [name, property] of Object.entries(schema.properties)) {
        expect(property.default).toEqual(definition.defaults[name]);
      }
      for (const preset of definition.presets) {
        expect(Object.keys(preset.params).sort()).toEqual(Object.keys(definition.defaults).sort());
      }
    }
  });

  it("requires exact selected names and rejects model-side resource/input fields", () => {
    for (const definition of BATCH_08_DEFINITIONS) {
      expect(() => validateAndNormalizeEffectEnvelope(
        definition,
        definition.toolName,
        { type: definition.toolName.toUpperCase(), data: definition.defaults }
      )).toThrow(expect.objectContaining({ code: "TYPE_MISMATCH" }));

      expect(() => validateAndNormalizeEffectEnvelope(
        definition,
        definition.toolName,
        { type: definition.toolName, data: { ...definition.defaults, asset_id: "asset_0123456789abcdef" } }
      )).toThrow(expect.objectContaining({ code: "RESOURCE_INJECTION" }));

      for (const slot of definition.inputSlots) {
        expect(() => validateAndNormalizeEffectEnvelope(
          definition,
          definition.toolName,
          { type: definition.toolName, data: { ...definition.defaults, [slot.name]: "server-forbidden" } }
        )).toThrow(expect.objectContaining({
          code: expect.stringMatching(/^(?:PARAMETER_INVALID|RESOURCE_INJECTION)$/u)
        }));
      }
    }
  });

  it("rejects every missing input and invalid owner, kind, or lock before render", async () => {
    for (const definition of BATCH_08_DEFINITIONS) {
      const inputs = validInputs(definition);
      for (const slot of definition.inputSlots) {
        const missing = { ...inputs } as Record<string, unknown>;
        delete missing[slot.name];
        await expect(run(definition, missing as AuthorizedEffectInputs)).rejects
          .toMatchObject({ code: "INPUT_AUTHORIZATION_INVALID" });
      }

      const firstSlot = definition.inputSlots[0]!;
      const binding = inputs[firstSlot.name];
      expect(Array.isArray(binding)).toBe(false);
      for (const mutation of [
        { tenantId: "other-tenant" },
        { userId: "other-user" },
        { locked: false },
        { kind: firstSlot.kind === "data" ? "audio" : "data" }
      ]) {
        await expect(run(definition, {
          ...inputs,
          [firstSlot.name]: { ...(binding as object), ...mutation }
        } as AuthorizedEffectInputs)).rejects.toMatchObject({ code: "INPUT_AUTHORIZATION_INVALID" });
      }
    }
  });

  it("is deterministic, finite, bounded, and returns the declared server output contract", async () => {
    for (const definition of BATCH_08_DEFINITIONS) {
      const inputs = validInputs(definition);
      const first = await run(definition, inputs, 0.75);
      const second = await run(definition, inputs, 0.75);
      expect(second).toEqual(first);
      expect(first.backendId).toBe(definition.primaryBackend.backendId);
      expect(first.kind).toBe(["composite", "material"].includes(definition.category)
        ? "texture"
        : "metadata");
      expect(first.degraded).toBe(false);
      expect(Array.isArray(first.warnings)).toBe(true);
      expectFiniteTree(first.output);
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

  it("renders model-selected number values over an authorized image and holds the exact end value", async () => {
    const counter = await run(NUMBER_COUNTER_DEFINITION, {
      source_image: authorized("source_image", "image", { version: "rgba8-frame-v1", width: 1920, height: 1080 })
    }, 0.6);
    expect((counter.output as { value: number }).value).toBeGreaterThan(0);
    expect((counter.output as { value: number }).value).toBeLessThan(100);
    const completed = await executeSelectedEffectTool(
      NUMBER_COUNTER_DEFINITION,
      NUMBER_COUNTER_DEFINITION.toolName,
      { type: NUMBER_COUNTER_DEFINITION.toolName, data: {
        ...NUMBER_COUNTER_DEFINITION.defaults,
        fromValue: 20,
        toValue: 100,
        duration: 6,
        positionX: 0.76,
        positionY: 0.24,
        numberColor: "#12ABEF",
        progressColor: "#FEDC21"
      } },
      context(NUMBER_COUNTER_DEFINITION, {
        source_image: authorized("source_image", "image", { version: "rgba8-frame-v1", width: 1920, height: 1080 })
      }, 6)
    );
    expect(completed.output).toMatchObject({
      progress: 1,
      value: 100,
      formatted: "100",
      positionX: 0.76,
      positionY: 0.24,
      numberColor: "#12abef",
      progressColor: "#fedc21"
    });
  });

  it("renders chart values only from server-validated data", async () => {
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
      source_image: authorized("source_image", "image", {
        version: "rgba8-frame-v1", width: 1920, height: 1080, data: new Uint8Array(1920 * 1080 * 4)
      }),
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
    expect(result.output).toMatchObject({
      targetHandle: "layer-safe-3",
      targetProperty: "opacity",
      mapping: "normalized",
      applied: true
    });

    const changed = await run(LIVE_BINDING_DEFINITION, {
      source_image: validInput.source_image,
      validated_binding: authorized("validated_binding", "data", {
        version: "validated-live-binding-v1",
        value: 20,
        previousValue: 10,
        minimum: 0,
        maximum: 100,
        targetHandle: "layer-safe-3",
        targetProperty: "opacity"
      })
    }, 5);
    expect(changed.output).not.toEqual(result.output);

    await expect(run(LIVE_BINDING_DEFINITION, {
      source_image: validInput.source_image,
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
      base_image: authorized("base_image", "image", { version: "rgba8-frame-v1", width: 1920, height: 1080, data: new Uint8Array(1920 * 1080 * 4) }),
      overlay_image: authorized("overlay_image", "image", { version: "rgba8-frame-v1", width: 1920, height: 1080, data: new Uint8Array(1920 * 1080 * 4) }),
      subject_mask: authorized("subject_mask", "mask", { version: "sam31-mask-v1", width: 1920, height: 1080, data: new Uint8Array(1920 * 1080) })
    }, 2);
    expect(result.output).toMatchObject({
      uvScale: [1, 1],
      textureSize: [1920, 1080],
      blendMode: "overlay",
      opacity: 0.45,
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

  it("rejects oversized analysis, chart, texture, handles, and non-finite computed output", async () => {
    const oversizedFrames = Array.from(
      { length: MAX_AUDIO_ANALYSIS_FRAMES + 1 },
      () => audioAnalysis.frames[0]
    );
    await expect(run(BEAT_PULSE_DEFINITION, {
      audio_analysis: authorized("audio_analysis", "audio", {
        version: "audio-analysis-v1",
        duration: 2,
        frames: oversizedFrames
      })
    })).rejects.toThrow(`between 1 and ${MAX_AUDIO_ANALYSIS_FRAMES} frames`);

    await expect(run(CHART_REVEAL_DEFINITION, {
      chart_data: authorized("chart_data", "data", {
        version: "validated-chart-v1",
        series: Array.from({ length: 501 }, (_, index) => ({ label: `item-${index}`, value: index }))
      })
    })).rejects.toThrow("validated chart data is invalid");

    await expect(run(TEXTURE_OVERLAY_DEFINITION, {
      base_layer: authorized("base_layer", "data", { version: "pixel-layer-v1", sample: [0, 0, 0, 1] }),
      overlay_texture: authorized("overlay_texture", "texture", {
        version: "texture-sample-v1",
        sample: [1, 1, 1, 1],
        width: 16_385,
        height: 1
      })
    })).rejects.toThrow("between 1 and 16384");

    await expect(run(ONSET_TRIGGER_DEFINITION, {
      audio_analysis: authorized("audio_analysis", "audio", audioAnalysis),
      target_effect: authorized("target_effect", "data", {
        version: "effect-target-v1",
        handle: "x".repeat(257)
      })
    })).rejects.toThrow("target effect binding is invalid");

    const extremeBinding = {
      validated_binding: authorized("validated_binding", "data", {
        version: "validated-live-binding-v1",
        value: Number.MAX_VALUE,
        previousValue: Number.MAX_VALUE,
        minimum: 0,
        maximum: Number.MAX_VALUE,
        targetHandle: "layer-safe-3",
        targetProperty: "number"
      })
    };
    await expect(executeSelectedEffectTool(
      LIVE_BINDING_DEFINITION,
      LIVE_BINDING_DEFINITION.toolName,
      {
        type: LIVE_BINDING_DEFINITION.toolName,
        data: { ...LIVE_BINDING_DEFINITION.defaults, mapping: "direct", gain: 10 }
      },
      context(LIVE_BINDING_DEFINITION, extremeBinding)
    )).rejects.toThrow("Rendered numeric output must be finite");

  });

  it("normalizes a full finite numeric range without intermediate overflow", async () => {
    const result = await run(LIVE_BINDING_DEFINITION, {
      validated_binding: authorized("validated_binding", "data", {
        version: "validated-live-binding-v1",
        value: 0,
        previousValue: 0,
        minimum: -Number.MAX_VALUE,
        maximum: Number.MAX_VALUE,
        targetHandle: "layer-safe-3",
        targetProperty: "number"
      })
    });
    expect(result.output).toMatchObject({ applied: true, value: 0.5 });
  });

  it("keeps extreme finite frame/time/seed inputs deterministic and finite", async () => {
    for (const definition of [TEXTURE_OVERLAY_DEFINITION, HOLOGRAM_DEFINITION]) {
      const extremeContext = {
        ...context(definition, validInputs(definition), 1),
        time: Number.MAX_VALUE,
        frame: Number.MAX_SAFE_INTEGER,
        seed: Number.MAX_VALUE
      };
      const first = await executeSelectedEffectTool(
        definition,
        definition.toolName,
        modelOutput(definition),
        extremeContext
      );
      const second = await executeSelectedEffectTool(
        definition,
        definition.toolName,
        modelOutput(definition),
        extremeContext
      );
      expect(second).toEqual(first);
      expectFiniteTree(first.output);
    }
  });
});

describe("batch-08 Chinese field specifications", () => {
  const specDirectory = join(dirname(fileURLToPath(import.meta.url)), "../../../field-specs/tools");

  it("provides ten complete specs exactly aligned with definitions and server input slots", () => {
    const files = BATCH_08_DEFINITIONS.map((definition) => `${definition.toolName}.md`);
    expect(files).toHaveLength(10);
    const forbidden = /"(?:audio|source|dataSource|texture|font|layer|effectRef|resourceId|path|url)"\s*:/u;
    const specTypes: string[] = [];
    for (const file of files) {
      const markdown = readFileSync(join(specDirectory, file), "utf8");
      for (const heading of ["工具作用", "输出约束", "参数字段", "服务器输入", "选择策略", "参数优先级", "自然语言示例", "推荐值、默认值和中性值", "非适用范围"]) {
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
      const definition = BATCH_08_DEFINITIONS.find((candidate) => candidate.toolName === example.type);
      expect(definition, `${file} unknown toolName`).toBeDefined();
      expect(example.data).toEqual(definition!.defaults);
      const parameterSection = markdown.match(/## 参数字段\s*([\s\S]*?)\n## /u)?.[1] ?? "";
      const documentedParams = [...parameterSection.matchAll(/^\| `([^`]+)` \|/gmu)]
        .map((match) => match[1]!).sort();
      expect(documentedParams, `${file} parameter fields`)
        .toEqual(Object.keys(definition!.defaults).sort());
      const inputSection = markdown.match(/## 服务器输入\s*([\s\S]*?)\n## /u)?.[1] ?? "";
      const documentedInputs = [...inputSection.matchAll(
        /^\| `([^`]+)` \| `([^`]+)` \| (是|否) \|/gmu
      )].map((match) => ({ name: match[1], kind: match[2], required: match[3] === "是" }));
      expect(documentedInputs, `${file} input slots`).toEqual(
        definition!.inputSlots.map((slot) => ({
          name: slot.name,
          kind: slot.kind,
          required: slot.required
        }))
      );
      const naturalExamples = markdown.match(/^\d+\. .+$/gmu) ?? [];
      expect(naturalExamples.length, `${file} natural examples`).toBeGreaterThanOrEqual(5);
      expect(naturalExamples.length, `${file} natural examples`).toBeLessThanOrEqual(8);
    }
    expect(specTypes.sort()).toEqual(BATCH_08_DEFINITIONS.map((definition) => definition.toolName).sort());
  });
});
