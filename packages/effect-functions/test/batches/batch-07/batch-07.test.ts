import { describe, expect, it } from "vitest";
import type {
  AuthorizedEffectInputs,
  EffectToolDefinition,
  ServerEffectRenderContext
} from "../../../src/types.js";
import {
  assertEffectToolDefinition,
  executeSelectedEffectTool,
  validateAndNormalizeEffectEnvelope
} from "../../../src/validation.js";
import { getEffectFieldSpec, loadEffectFieldSpec } from "../../../src/field-specs.js";
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

function authorizedRawAnalysis(binding: Record<string, unknown>): AuthorizedEffectInputs {
  return {
    audio_analysis: {
      slot: "audio_analysis",
      kind: "audio",
      tenantId: "tenant-07",
      userId: "user-07",
      locked: true,
      binding
    }
  };
}

function authorizedAnalysis(binding: Record<string, unknown>): AuthorizedEffectInputs {
  return authorizedRawAnalysis({ version: "audio-analysis-v1", ...binding });
}

function definitionFor(toolName: string): EffectToolDefinition {
  const definition = BATCH_07_DEFINITIONS.find((entry) => entry.toolName === toolName);
  if (definition === undefined) throw new RangeError(`Missing batch-07 definition ${toolName}.`);
  return definition;
}

function expectFiniteTree(value: unknown): void {
  if (typeof value === "number") {
    expect(Number.isFinite(value)).toBe(true);
  } else if (Array.isArray(value)) {
    value.forEach(expectFiniteTree);
  } else if (typeof value === "object" && value !== null) {
    Object.values(value).forEach(expectFiniteTree);
  }
}

function thresholdComponentCount(field: readonly number[], width: number, threshold: number): number {
  const visited = new Uint8Array(field.length);
  let components = 0;
  for (let start = 0; start < field.length; start += 1) {
    if (visited[start] === 1 || field[start]! < threshold) continue;
    components += 1;
    const pending = [start];
    visited[start] = 1;
    while (pending.length > 0) {
      const index = pending.pop()!;
      const x = index % width;
      const neighbors = [index - width, index + width];
      if (x > 0) neighbors.push(index - 1);
      if (x + 1 < width) neighbors.push(index + 1);
      for (const neighbor of neighbors) {
        if (neighbor < 0 || neighbor >= field.length || visited[neighbor] === 1
          || field[neighbor]! < threshold) continue;
        visited[neighbor] = 1;
        pending.push(neighbor);
      }
    }
  }
  return components;
}

async function render(
  definition: EffectToolDefinition,
  data: Record<string, unknown> = {},
  renderContext = context(definition)
) {
  return executeSelectedEffectTool(
    definition,
    definition.toolName,
    { type: definition.toolName, data },
    renderContext
  );
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
      expect(definition.primaryBackend.kind).toBe("server-cpu");
      expect(definition.fallbackStrategy.kind).toBe("reject");
      expect(definition.parameterSchema).toMatchObject({ type: "object", additionalProperties: false });

      const properties = definition.parameterSchema.properties as Record<string, { default: unknown }>;
      expect(Object.keys(properties).sort()).toEqual(Object.keys(definition.defaults).sort());
      for (const [name, property] of Object.entries(properties)) {
        expect(property.default).toEqual(definition.defaults[name]);
      }
      for (const preset of definition.presets) {
        expect(Object.keys(preset.params).sort()).toEqual(Object.keys(definition.defaults).sort());
      }

      if (definition.toolName === "spectrum_bars" || definition.toolName === "waveform") {
        expect(definition.inputSlots).toEqual([expect.objectContaining({
          name: "audio_analysis",
          kind: "audio",
          required: true,
          cardinality: "one"
        })]);
      } else {
        expect(definition.inputSlots).toEqual([]);
      }
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

    const normalized = validateAndNormalizeEffectEnvelope(
      definitionFor("fractal"),
      "fractal",
      { type: "fractal", data: { centerX: -0.50000049, insideColor: "#abcdef" } }
    );
    expect(normalized.data).toMatchObject({ centerX: -0.5, insideColor: "#ABCDEF" });
  });

  it("rejects exact-name mismatches, unknown fields, bounds, enums, and non-finite numbers", () => {
    expect(() => validateAndNormalizeEffectEnvelope(
      definitionFor("fractal"),
      "fractal",
      { type: "Fractal", data: {} }
    )).toThrow(expect.objectContaining({ code: "TYPE_MISMATCH" }));

    const invalidCases: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
      ["noise_field", { gridSize: 7 }],
      ["fractal", { iterations: 257 }],
      ["l_system", { pattern: "custom" }],
      ["voronoi", { pointCount: 129 }],
      ["metaballs", { ballCount: 1 }],
      ["spiral_tunnel", { pointsPerTurn: 97 }],
      ["wave_surface", { mode: "ocean" }],
      ["sacred_geometry", { rings: 13 }],
      ["spectrum_bars", { barCount: 7 }],
      ["waveform", { sampleCount: 513 }]
    ];
    for (const [toolName, data] of invalidCases) {
      expect(() => validateAndNormalizeEffectEnvelope(
        definitionFor(toolName),
        toolName,
        { type: toolName, data }
      ), toolName).toThrow(expect.objectContaining({ code: "PARAMETER_INVALID" }));
    }

    for (const definition of BATCH_07_DEFINITIONS) {
      const numericField = Object.entries(definition.defaults)
        .find(([, value]) => typeof value === "number")?.[0];
      expect(numericField, definition.toolName).toBeDefined();
      for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        expect(() => validateAndNormalizeEffectEnvelope(
          definition,
          definition.toolName,
          { type: definition.toolName, data: { [numericField!]: value } }
        ), `${definition.toolName}:${String(value)}`).toThrow(
          expect.objectContaining({ code: "PARAMETER_INVALID" })
        );
      }
    }
  });

  it("rejects resource-bearing names, IDs, URLs, and paths before Schema handling", () => {
    const definition = definitionFor("fractal");
    expect(() => validateAndNormalizeEffectEnvelope(
      definition,
      "fractal",
      { type: "fractal", data: { audio_analysis: { bins: [0.1] } } }
    )).toThrow(expect.objectContaining({ code: "PARAMETER_INVALID" }));

    const injections = [
      { note: "asset_0123456789abcdef01234567" },
      { note: "https://media.example.test/audio.wav" },
      { note: "D:\\tenant\\audio.wav" },
      { note: "../private/audio.wav" }
    ];
    for (const data of injections) {
      expect(() => validateAndNormalizeEffectEnvelope(
        definition,
        "fractal",
        { type: "fractal", data }
      )).toThrow(expect.objectContaining({ code: "RESOURCE_INJECTION" }));
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

  it("returns consumable finite field or geometry data under an exact output contract", async () => {
    const contracts: ReadonlyArray<readonly [string, readonly string[], readonly string[], string]> = [
      ["noise_field", ["algorithm", "colors", "height", "seed", "values", "width"], ["values"], "values"],
      ["fractal", ["algorithm", "colors", "escape", "height", "levels", "recursionScale", "rotationStep", "speed", "strength", "width"], ["escape"], "escape"],
      ["l_system", ["algorithm", "pattern", "segments", "strokeColor"], ["segments"], "segments"],
      ["voronoi", ["algorithm", "cells", "colors", "edges", "height", "seed", "sites", "width"], ["sites", "cells", "edges"], "cells"],
      ["metaballs", ["algorithm", "colors", "field", "height", "seed", "threshold", "width"], ["field"], "field"],
      ["spiral_tunnel", ["algorithm", "colors", "points"], ["points"], "points"],
      ["wave_surface", ["algorithm", "colors", "height", "heights", "mode", "slopes", "width"], ["heights", "slopes"], "heights"],
      ["sacred_geometry", ["algorithm", "circles", "colors", "lines", "pattern"], ["circles", "lines"], "circles"]
    ];
    for (const [toolName, keys, arrayKeys, nonEmptyKey] of contracts) {
      const result = await render(definitionFor(toolName));
      expect(result).toMatchObject({
        kind: "metadata",
        backendId: "effect-functions-server-cpu-v1",
        degraded: false,
        warnings: []
      });
      const output = outputRecord(result.output);
      expect(Object.keys(output).sort(), toolName).toEqual([...keys].sort());
      for (const arrayKey of arrayKeys) {
        expect(output[arrayKey], `${toolName}.${arrayKey}`).toBeInstanceOf(Array);
      }
      expect((output[nonEmptyKey] as unknown[]).length).toBeGreaterThan(0);
      expectFiniteTree(output);
    }
  });

  it("depends only on validated params plus allowed time and seed context", async () => {
    for (const definition of BATCH_07_DEFINITIONS.slice(0, 8)) {
      const baseContext = context(definition);
      const changedServerMetadata: ServerEffectRenderContext = {
        ...baseContext,
        requestId: "another-request",
        tenantId: "another-tenant",
        userId: "another-user",
        frame: 999,
        width: 640,
        height: 360,
        quality: "final"
      };
      expect(await render(definition, {}, changedServerMetadata))
        .toEqual(await render(definition, {}, baseContext));

      const unauthorizedInput = {
        injected_data: {
          slot: "injected_data",
          kind: "data",
          tenantId: "tenant-07",
          userId: "user-07",
          locked: true,
          binding: { value: 1 }
        }
      } as AuthorizedEffectInputs;
      await expect(render(definition, {}, context(definition, unauthorizedInput)))
        .rejects.toMatchObject({ code: "INPUT_AUTHORIZATION_INVALID" });
    }
  });

  it("uses seed and time deterministically without collapsing animated outputs", async () => {
    for (const toolName of ["noise_field", "voronoi", "metaballs"]) {
      const definition = definitionFor(toolName);
      const first = await render(definition, {}, context(definition, {}, 0.75, 101));
      const repeat = await render(definition, {}, context(definition, {}, 0.75, 101));
      const reseeded = await render(definition, {}, context(definition, {}, 0.75, 102));
      expect(repeat, toolName).toEqual(first);
      expect(reseeded, toolName).not.toEqual(first);
    }

    for (const definition of BATCH_07_DEFINITIONS.slice(0, 8)) {
      const data = definition.toolName === "fractal" ? { speed: 1 } : {};
      const earlier = await render(definition, data, context(definition, {}, 0.25));
      const later = await render(definition, data, context(definition, {}, 1.25));
      expect(later, definition.toolName).not.toEqual(earlier);
    }
  });

  it("makes a metaball pair merge into one body and separate back into two bodies", async () => {
    const definition = definitionFor("metaballs");
    const componentCounts = new Set<number>();
    for (let sample = 0; sample <= 32; sample += 1) {
      const result = await render(definition, {
        ballCount: 2,
        gridSize: 64,
        radius: 0.1,
        threshold: 1.1,
        speed: 1
      }, context(definition, {}, sample / 8, 401));
      const output = outputRecord(result.output);
      componentCounts.add(thresholdComponentCount(output.field as number[], output.width as number, 1));
    }

    expect(componentCounts.has(1)).toBe(true);
    expect(componentCounts.has(2)).toBe(true);
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
    expect(Object.keys(bars).sort()).toEqual([
      "algorithm", "bars", "colors", "logarithmic"
    ]);
    expect(waveform.algorithm).toBe("time_domain_linear_resampling");
    expect(waveform.points).toHaveLength(waveformDefinition.defaults.sampleCount);
    expect(Object.keys(waveform).sort()).toEqual([
      "algorithm", "colors", "mirrored", "points", "thickness"
    ]);
    expect(waveform).not.toHaveProperty("bars");
    expectFiniteTree(bars);
    expectFiniteTree(waveform);
  });

  it("rejects model-side audio identities and missing server analysis before rendering", async () => {
    for (const definition of [spectrumBarsDefinition, waveformDefinition]) {
      expect(() => validateAndNormalizeEffectEnvelope(
        definition,
        definition.toolName,
        { type: definition.toolName, data: { audio: "asset_0123456789abcdef01234567" } }
      )).toThrow(expect.objectContaining({ code: "RESOURCE_INJECTION" }));

      await expect(render(definition, {}, context(definition)))
        .rejects.toMatchObject({ code: "INPUT_AUTHORIZATION_INVALID" });
    }
  });

  it("rejects wrong input kind, owner, and lock state", async () => {
    const binding = {
      slot: "audio_analysis",
      kind: "audio",
      tenantId: "tenant-07",
      userId: "user-07",
      locked: true,
      binding: { version: "audio-analysis-v1", waveformSamples: [0, 0.5, -0.5] }
    };
    const invalidBindings = [
      { ...binding, kind: "data" },
      { ...binding, tenantId: "other-tenant" },
      { ...binding, userId: "other-user" },
      { ...binding, locked: false }
    ];
    for (const invalidBinding of invalidBindings) {
      const inputs = { audio_analysis: invalidBinding } as unknown as AuthorizedEffectInputs;
      await expect(render(waveformDefinition, {}, context(waveformDefinition, inputs)))
        .rejects.toMatchObject({ code: "INPUT_AUTHORIZATION_INVALID" });
    }
  });

  it("rejects unversioned, malformed, unknown-field, and oversized analysis instead of inventing audio", async () => {
    const invalidBindings: ReadonlyArray<readonly [Record<string, unknown>, string]> = [
      [{ waveformSamples: [0, 0.5] }, "exact versioned"],
      [{ version: "audio-analysis-v2", waveformSamples: [0, 0.5] }, "exact versioned"],
      [{ version: "audio-analysis-v1", waveformSamples: [0, Number.NaN] }, "finite normalized samples"],
      [{ version: "audio-analysis-v1", waveformSamples: [0, 1.1] }, "finite normalized samples"],
      [{ version: "audio-analysis-v1", waveformSamples: [], syntheticFallback: [0, 0] }, "exact versioned"],
      [{ version: "audio-analysis-v1" }, "waveformSamples"],
      [{ version: "audio-analysis-v1", waveformSamples: Array.from({ length: 65_537 }, () => 0) }, "1-65536"]
    ];
    for (const [binding, message] of invalidBindings) {
      await expect(render(
        waveformDefinition,
        {},
        context(waveformDefinition, authorizedRawAnalysis(binding))
      )).rejects.toThrow(message);
    }

    await expect(render(
      spectrumBarsDefinition,
      {},
      context(spectrumBarsDefinition, authorizedAnalysis({ waveformSamples: [0, 0.5] }))
    )).rejects.toThrow("frequencyBins");
    await expect(render(
      spectrumBarsDefinition,
      {},
      context(spectrumBarsDefinition, authorizedAnalysis({
        frequencyBins: Array.from({ length: 8_193 }, () => 0.5)
      }))
    )).rejects.toThrow("1-8192");
  });
});

describe("batch-07 Chinese field specifications", () => {
  it("independently loads one complete, executable model instruction for every tool", async () => {
    for (const [, toolName] of expectedIdentities) {
      const descriptor = getEffectFieldSpec(toolName);
      expect(descriptor?.relativePath).toBe(`tools/${toolName}.md`);
      const markdown = await loadEffectFieldSpec(toolName);
      expect(markdown).toContain(`\`${toolName}\``);
      expect(markdown).toContain("合法 JSON 示例");
      expect(markdown).toContain("参数表");
      expect(markdown).toContain("推荐档位");
      expect(markdown).toContain("默认值与中性行为");
      expect(markdown).toContain("不能处理的内容");
      expect(markdown).toContain(`\"type\":\"${toolName}\"`);
      expect(markdown).not.toMatch(/(?:asset|resource|file)[-_][a-z0-9]{12,}/iu);

      const blocks = [...markdown.matchAll(/```json\s*([\s\S]*?)```/gu)];
      expect(blocks, toolName).toHaveLength(1);
      const example = JSON.parse(blocks[0]![1]!) as {
        type: string;
        data: Record<string, unknown>;
      };
      const definition = definitionFor(toolName);
      expect(() => validateAndNormalizeEffectEnvelope(
        definition,
        toolName,
        example
      ), toolName).not.toThrow();
      expect(Object.keys(example.data).sort(), toolName)
        .toEqual(Object.keys(definition.defaults).sort());
      expect(example.data).not.toHaveProperty("audio_analysis");
      for (const parameterName of Object.keys(definition.defaults)) {
        expect(markdown, `${toolName}.${parameterName}`).toContain(`\`${parameterName}\``);
      }
    }
  });
});
