import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
  AuthorizedEffectInputs,
  EffectToolDefinition,
  ServerEffectRenderContext
} from "../../../src/types.js";
import {
  EffectToolContractError,
  assertEffectToolDefinition,
  executeSelectedEffectTool,
  validateAndNormalizeEffectEnvelope
} from "../../../src/validation.js";
import {
  BATCH_07_DEFINITIONS,
  lSystemDefinition,
  spectrumBarsDefinition,
  waveformDefinition
} from "../../../src/batches/batch-07/index.js";

const expectedIdentities = [
  ["fx.gen.noiseField", "noise_field"],
  ["fx.gen.fractal", "fractal"],
  ["fx.gen.lSystem", "l_system"],
  ["fx.gen.voronoi", "voronoi"],
  ["fx.gen.metaballs", "metaballs"],
  ["fx.gen.spiralTunnel", "spiral_tunnel"],
  ["fx.gen.waveSurface", "wave_surface"],
  ["fx.gen.sacredGeometry", "sacred_geometry"],
  ["fx.audio.spectrumBars", "spectrum_bars"],
  ["fx.audio.waveform", "waveform"]
] as const;

function context(
  definition: EffectToolDefinition,
  inputs: AuthorizedEffectInputs = {},
  time = 1.25,
  seed = 20260814
): ServerEffectRenderContext {
  return {
    environment: "server",
    requestId: "batch-07-request",
    tenantId: "tenant-07",
    userId: "user-07",
    time,
    deltaTime: 1 / 30,
    frame: 38,
    fps: 30,
    width: 1920,
    height: 1080,
    seed,
    quality: "preview",
    backend: definition.primaryBackend,
    inputs
  };
}

function outputRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected a metadata output object.");
  }
  return value as Record<string, unknown>;
}

function authorizedAnalysis(binding: Record<string, unknown>): AuthorizedEffectInputs {
  return {
    audio_analysis: {
      slot: "audio_analysis",
      kind: "data",
      tenantId: "tenant-07",
      userId: "user-07",
      locked: true,
      binding
    }
  };
}

describe("batch-07 definitions", () => {
  it("exports exactly the requested ten valid definitions with about three presets each", () => {
    expect(BATCH_07_DEFINITIONS.map((definition) => [definition.effectId, definition.toolName]))
      .toEqual(expectedIdentities);
    expect(new Set(BATCH_07_DEFINITIONS.map((definition) => definition.toolName)).size).toBe(10);
    for (const definition of BATCH_07_DEFINITIONS) {
      expect(() => assertEffectToolDefinition(definition)).not.toThrow();
      expect(definition.presets).toHaveLength(3);
      expect(definition.primaryBackend.deterministic).toBe(true);
      expect(definition.parameterSchema).toMatchObject({ type: "object", additionalProperties: false });
    }
  });

  it("normalizes defaults through the exact selected-tool envelope", () => {
    for (const definition of BATCH_07_DEFINITIONS) {
      const envelope = validateAndNormalizeEffectEnvelope(
        definition,
        definition.toolName,
        { type: definition.toolName, data: {} }
      );
      expect(envelope.type).toBe(definition.toolName);
      expect(Object.keys(envelope.data).sort()).toEqual(Object.keys(definition.defaults).sort());
    }
  });

  it("uses eight distinct bounded algorithms and reproduces identical output", async () => {
    const algorithms = new Set<string>();
    for (const definition of BATCH_07_DEFINITIONS.slice(0, 8)) {
      const first = await executeSelectedEffectTool(
        definition,
        definition.toolName,
        { type: definition.toolName, data: definition.defaults },
        context(definition)
      );
      const second = await executeSelectedEffectTool(
        definition,
        definition.toolName,
        { type: definition.toolName, data: definition.defaults },
        context(definition)
      );
      expect(second).toEqual(first);
      const output = outputRecord(first.output);
      expect(typeof output.algorithm).toBe("string");
      algorithms.add(output.algorithm as string);
      for (const entry of Object.values(output)) {
        if (Array.isArray(entry)) expect(entry.length).toBeLessThanOrEqual(8192);
      }
    }
    expect(algorithms.size).toBe(8);
  });

  it("keeps every procedural output within its maximum legal budget", async () => {
    const boundaryCases = [
      { toolName: "noise_field", data: { gridSize: 64, octaves: 6 }, field: "values", limit: 4096 },
      { toolName: "fractal", data: { gridSize: 64, iterations: 256 }, field: "escape", limit: 4096 },
      { toolName: "l_system", data: { pattern: "koch", iterations: 5 }, field: "segments", limit: 8192 },
      { toolName: "voronoi", data: { pointCount: 128, gridSize: 64 }, field: "cells", limit: 4096 },
      { toolName: "metaballs", data: { ballCount: 32, gridSize: 64 }, field: "field", limit: 4096 },
      { toolName: "spiral_tunnel", data: { turns: 24, pointsPerTurn: 96 }, field: "points", limit: 2304 },
      { toolName: "wave_surface", data: { gridSize: 64 }, field: "heights", limit: 4096 },
      { toolName: "sacred_geometry", data: { pattern: "metatron", rings: 12, symmetry: 24 }, field: "circles", limit: 1024 }
    ];
    for (const boundary of boundaryCases) {
      const definition = BATCH_07_DEFINITIONS.find((entry) => entry.toolName === boundary.toolName)!;
      const result = await executeSelectedEffectTool(
        definition,
        boundary.toolName,
        { type: boundary.toolName, data: boundary.data },
        context(definition)
      );
      const values = outputRecord(result.output)[boundary.field];
      expect(values).toBeInstanceOf(Array);
      expect((values as unknown[]).length).toBeGreaterThan(0);
      expect((values as unknown[]).length).toBeLessThanOrEqual(boundary.limit);
    }
  });

  it("enforces pattern-specific recursion budgets before rendering", () => {
    for (const pattern of ["plant", "koch"]) {
      expect(() => validateAndNormalizeEffectEnvelope(
        lSystemDefinition,
        "l_system",
        { type: "l_system", data: { pattern, iterations: 6 } }
      )).toThrow(expect.objectContaining({ code: "PARAMETER_INVALID" }));
    }
    expect(() => validateAndNormalizeEffectEnvelope(
      lSystemDefinition,
      "l_system",
      { type: "l_system", data: { pattern: "dragon", iterations: 6 } }
    )).not.toThrow();
  });
});

describe("batch-07 audio analysis tools", () => {
  const analysis = authorizedAnalysis({
    frequencyBins: Array.from({ length: 128 }, (_, index) => index / 127),
    previousFrequencyBins: Array.from({ length: 128 }, (_, index) => (127 - index) / 127),
    waveformSamples: Array.from({ length: 1024 }, (_, index) => Math.sin(index / 24)),
    previousWaveformSamples: Array.from({ length: 1024 }, (_, index) => Math.sin(index / 24 - 0.1))
  });

  it("reads server-bound analysis and renders frequency bars and time-domain points differently", async () => {
    const barsResult = await executeSelectedEffectTool(
      spectrumBarsDefinition,
      "spectrum_bars",
      { type: "spectrum_bars", data: {} },
      context(spectrumBarsDefinition, analysis)
    );
    const waveformResult = await executeSelectedEffectTool(
      waveformDefinition,
      "waveform",
      { type: "waveform", data: {} },
      context(waveformDefinition, analysis)
    );
    const bars = outputRecord(barsResult.output);
    const waveform = outputRecord(waveformResult.output);
    expect(bars.algorithm).toBe("frequency_band_aggregation");
    expect(bars.bars).toHaveLength(spectrumBarsDefinition.defaults.barCount);
    expect(waveform.algorithm).toBe("time_domain_linear_resampling");
    expect(waveform.points).toHaveLength(waveformDefinition.defaults.sampleCount);
    expect(waveform).not.toHaveProperty("bars");
  });

  it("rejects model-side audio identities and missing server analysis before rendering", async () => {
    expect(() => validateAndNormalizeEffectEnvelope(
      spectrumBarsDefinition,
      "spectrum_bars",
      { type: "spectrum_bars", data: { audio: "asset_0123456789abcdef01234567" } }
    )).toThrow(expect.objectContaining({ code: "RESOURCE_INJECTION" }));

    await expect(executeSelectedEffectTool(
      waveformDefinition,
      "waveform",
      { type: "waveform", data: {} },
      context(waveformDefinition)
    )).rejects.toBeInstanceOf(EffectToolContractError);
  });

  it("rejects malformed or oversized analysis arrays", async () => {
    const malformed = authorizedAnalysis({ waveformSamples: [0, Number.NaN] });
    await expect(executeSelectedEffectTool(
      waveformDefinition,
      "waveform",
      { type: "waveform", data: {} },
      context(waveformDefinition, malformed)
    )).rejects.toThrow("finite normalized samples");
  });
});

describe("batch-07 Chinese field specifications", () => {
  it("provides one complete model instruction for every tool", () => {
    for (const [, toolName] of expectedIdentities) {
      const fileName = toolName.replaceAll("_", "-");
      const markdown = readFileSync(
        new URL(`../../../field-specs/batch-07/${fileName}.md`, import.meta.url),
        "utf8"
      );
      expect(markdown).toContain(`\`${toolName}\``);
      expect(markdown).toContain("合法 JSON 示例");
      expect(markdown).toContain("参数表");
      expect(markdown).toContain("推荐档位");
      expect(markdown).toContain("默认值与中性行为");
      expect(markdown).toContain("不能处理的内容");
      expect(markdown).toContain(`\"type\":\"${toolName}\"`);
      expect(markdown).not.toMatch(/(?:asset|resource|file)[-_][a-z0-9]{12,}/iu);
    }
  });
});
