/// <reference lib="dom" />

import { WebGLRendererAdapter } from "../../renderer-webgl/src/index.js";
import type {
  DualInputTextures,
  LayerRasterizationInput,
  LayerRasterizationOutput,
  TextureHandle
} from "../../renderer-api/src/index.js";
import {
  GROUP_2_BLUEPRINTS,
  GROUP_2_P0_EFFECTS,
  makeBrushCoverage,
  makeEffectTimeSample,
  makeRealInputFixture,
  type ParameterSpec,
  type P0EffectDefinition
} from "../src/index.js";

const WIDTH = 64;
const HEIGHT = 36;
const PROGRESSES = [0, 0.25, 0.5, 0.75, 1] as const;
const SEMANTIC_PROGRESSES = [0.23, 0.51, 0.77] as const;
const RANDOM_SOURCE_IDS = new Set(["M08", "T06", "T07", "D02", "D04", "L01"]);
const RANDOM_PARAMS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  M08: { intensity: 0.5, frequency: 13, decay: 0, seedOffset: 0 },
  T06: { speed: 31, lockChance: 0, charset: "ALPHA中文", progress: 0.37 },
  T07: { distance: 0.6, angle: 37, gravity: 0.2, grouping: "word" },
  D02: {
    brushTexture: "builtin://brush/round",
    size: 0.12,
    roughness: 1,
    progress: 0.37
  },
  D04: { grain: 0.8, scatter: 0.9, opacity: 1, progress: 0.37 },
  L01: { color: "#42C8FF", radius: 0.08, intensity: 2, flicker: 1 }
};
const canvasElement = document.querySelector<HTMLCanvasElement>("#qa");
const statusElement = document.querySelector<HTMLElement>("#status");
if (!canvasElement || !statusElement) throw new Error("QA DOM is incomplete.");
const canvas = canvasElement;
const status = statusElement;

interface QaResult {
  readonly runtime: {
    readonly userAgent: string;
    readonly webglVersion: string;
    readonly renderer: string;
    readonly width: number;
    readonly height: number;
  };
  readonly goldens: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly perturbations: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly performance: Readonly<Record<string, {
    readonly medianMs: number;
    readonly fps: number;
    readonly onePercentLowFps: number;
    readonly gpuMedianMs: number;
    readonly drawCalls: number;
    readonly textureAllocations: number;
    readonly estimatedVramBytes: number;
    readonly peakHeapBytes: number;
    readonly firstFrameMs: number;
    readonly shaderCompileMs: number;
    readonly budgetMs: number;
  }>>;
  readonly quality: Readonly<Record<string, readonly [string, string, string]>>;
  readonly alpha: {
    readonly checked: number;
    readonly maxStraightPremultipliedDelta: number;
    readonly premultipliedInvariant: boolean;
  };
  readonly masks: {
    readonly checked: number;
    readonly allZero: boolean;
  };
  readonly deterministic: {
    readonly checked: number;
    readonly allEqual: boolean;
  };
  readonly instanceRandom: {
    readonly checked: number;
    readonly threeRunDeterministic: boolean;
    readonly streamsDistinct: boolean;
  };
  readonly colorSpaces: {
    readonly srgbChecks: number;
    readonly linearSrgbChecks: number;
    readonly displayP3FallbackRequired: boolean;
  };
  readonly resources: Readonly<Record<string, {
    readonly created: number;
    readonly deleted: number;
    readonly duplicateDeletes: number;
  }>>;
  readonly semanticDistinctFrames: number;
  readonly failures: readonly string[];
}

declare global {
  interface Window {
    __CMFX_WEBGL_QA__?: QaResult;
    __CMFX_WEBGL_QA_ERROR__?: string;
  }
}

function hashPixels(data: Uint8Array | Uint8ClampedArray): string {
  let value = 0x811c9dc5;
  for (const byte of data) {
    value ^= byte;
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(16).padStart(8, "0");
}

function premultiply(data: Uint8ClampedArray): Uint8Array {
  const output = new Uint8Array(data.length);
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3]! / 255;
    output[offset] = Math.round(data[offset]! * alpha);
    output[offset + 1] = Math.round(data[offset + 1]! * alpha);
    output[offset + 2] = Math.round(data[offset + 2]! * alpha);
    output[offset + 3] = data[offset + 3]!;
  }
  return output;
}

function candidates(spec: ParameterSpec): readonly unknown[] {
  if (spec.kind === "number") {
    const span = spec.max - spec.min;
    return [spec.min, spec.max, spec.min + span * 0.25, spec.min + span * 0.73]
      .filter((value) => Math.abs(value - spec.default) > Number.EPSILON);
  }
  if (spec.kind === "enum") return spec.options.filter((value) => value !== spec.default);
  if (spec.kind === "boolean") return [!spec.default];
  if (spec.kind === "text") {
    if (spec.name === "path" || spec.name === "fromPath" || spec.name === "toPath") {
      return [
        "M0.05,0.2 C0.25,0.95 0.7,0.05 0.95,0.8",
        "M0.1,0.1 L0.9,0.2 L0.6,0.9 Z"
      ];
    }
    if (spec.name === "beatMap" || spec.name === "scaleMap") {
      return ["0.15,0.9,0.2,1", "1.4,0.6,1.1"];
    }
    if (spec.name === "sourceText" || spec.name === "targetText") return ["动效A", "Motion中"];
    if (spec.name === "charset") return ["中文AB12", "△○□◇"];
    if (spec.name === "mask" || spec.name === "matteLayer" || spec.name === "map") {
      return ["missing.layer"];
    }
    if (spec.name === "brushTexture") return ["asset://brush/missing"];
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

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function kindFor(effect: P0EffectDefinition): "text" | "vector" | "media" {
  return effect.category === "text" ? "text"
    : effect.category === "vector" || effect.category === "draw" ? "vector"
      : "media";
}

function rasterOutput(
  input: LayerRasterizationInput,
  texture: TextureHandle
): LayerRasterizationOutput {
  return {
    texture,
    sourceKind: input.source.kind,
    contentBounds: { x: 0, y: 0, width: input.target.width, height: input.target.height },
    coveredPixelCount: input.target.width * input.target.height,
    contentDigest: `${input.layerId}:${input.source.kind}`,
    alphaMode: "premultiplied",
    usedSolidFallback: false
  };
}

async function run(): Promise<QaResult> {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    depth: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
    stencil: false
  });
  if (!gl) throw new Error("Microsoft Edge did not provide a WebGL2 context.");
  const webgl = gl;
  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  const rendererName = debugInfo
    ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
    : String(gl.getParameter(gl.RENDERER));
  const resourceMethods = {
    createTexture: "deleteTexture",
    createFramebuffer: "deleteFramebuffer",
    createProgram: "deleteProgram",
    createShader: "deleteShader",
    createVertexArray: "deleteVertexArray"
  } as const;
  const resourceState = Object.fromEntries(Object.keys(resourceMethods).map((name) => [
    name,
    { objects: new Set<object>(), deleted: new Set<object>(), duplicateDeletes: 0 }
  ])) as Record<string, {
    objects: Set<object>;
    deleted: Set<object>;
    duplicateDeletes: number;
  }>;
  const deleteToCreate = Object.fromEntries(
    Object.entries(resourceMethods).map(([create, remove]) => [remove, create])
  ) as Record<string, string>;
  let drawCallCount = 0;
  let shaderCompileMs = 0;
  const shaderCompileStarted = new WeakMap<object, number>();
  const trackedGl = new Proxy(gl, {
    get(target, property) {
      if (property === "drawArrays") {
        return (...args: unknown[]) => {
          drawCallCount += 1;
          return (target.drawArrays as (...input: unknown[]) => void).apply(target, args);
        };
      }
      if (property === "compileShader") {
        return (shader: WebGLShader) => {
          shaderCompileStarted.set(shader, performance.now());
          return target.compileShader(shader);
        };
      }
      if (property === "getShaderParameter") {
        return (shader: WebGLShader, parameter: number) => {
          const result = target.getShaderParameter(shader, parameter);
          const started = shaderCompileStarted.get(shader);
          if (parameter === target.COMPILE_STATUS && started !== undefined) {
            shaderCompileMs += performance.now() - started;
            shaderCompileStarted.delete(shader);
          }
          return result;
        };
      }
      if (typeof property === "string" && property in resourceMethods) {
        return (...args: unknown[]) => {
          const resource = (target[property as keyof WebGL2RenderingContext] as (...input: unknown[]) => object | null)
            .apply(target, args);
          if (resource) resourceState[property]!.objects.add(resource);
          return resource;
        };
      }
      if (typeof property === "string" && property in deleteToCreate) {
        return (resource: object | null) => {
          if (resource) {
            const state = resourceState[deleteToCreate[property]!]!;
            if (state.deleted.has(resource)) state.duplicateDeletes += 1;
            state.deleted.add(resource);
          }
          return (target[property as keyof WebGL2RenderingContext] as (input: object | null) => void)
            .call(target, resource);
        };
      }
      const value = target[property as keyof WebGL2RenderingContext];
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const adapter = new WebGLRendererAdapter({ contextFactory: () => trackedGl as never });
  adapter.initialize({ width: WIDTH, height: HEIGHT, colorSpace: "srgb", quality: "final" });

  const descriptor = {
    width: WIDTH,
    height: HEIGHT,
    format: "rgba8" as const,
    colorSpace: "srgb" as const,
    samples: 1,
    usage: "input" as const
  };
  const fixtureEffects = {
    media: GROUP_2_P0_EFFECTS.find((effect) => effect.sourceId === "M01")!,
    text: GROUP_2_P0_EFFECTS.find((effect) => effect.sourceId === "T01")!,
    vector: GROUP_2_P0_EFFECTS.find((effect) => effect.sourceId === "V01")!,
    secondary: GROUP_2_P0_EFFECTS.find((effect) => effect.sourceId === "C01")!
  } as const;
  const textureFixtures = Object.fromEntries((["media", "text", "vector"] as const).map((kind) => [
    kind,
    makeRealInputFixture(
      fixtureEffects[kind].effectId,
      kind,
      WIDTH,
      HEIGHT,
      false,
      "srgb",
      makeEffectTimeSample(
        fixtureEffects[kind].effectId,
        `qa.texture.srgb.${fixtureEffects[kind].sourceId}`,
        0.5
      )
    )
  ]));
  const secondaryFixture = makeRealInputFixture(
    fixtureEffects.secondary.effectId,
    "media",
    WIDTH,
    HEIGHT,
    true,
    "srgb",
    makeEffectTimeSample(
      fixtureEffects.secondary.effectId,
      `qa.texture.srgb.${fixtureEffects.secondary.sourceId}.secondary`,
      0.5
    )
  );
  const straightTextures = Object.fromEntries((["media", "text", "vector"] as const).map((kind) => {
    const texture = adapter.createTexture(descriptor);
    adapter.uploadTexture(texture, textureFixtures[kind]!.surface.data, "straight");
    return [kind, texture];
  })) as Record<"media" | "text" | "vector", TextureHandle>;
  const premultipliedTextures = Object.fromEntries((["media", "text", "vector"] as const).map((kind) => {
    const texture = adapter.createTexture(descriptor);
    adapter.uploadTexture(texture, premultiply(textureFixtures[kind]!.surface.data), "premultiplied");
    return [kind, texture];
  })) as Record<"media" | "text" | "vector", TextureHandle>;
  const bStraight = adapter.createTexture(descriptor);
  const bPremultiplied = adapter.createTexture(descriptor);
  adapter.uploadTexture(bStraight, secondaryFixture.surface.data, "straight");
  adapter.uploadTexture(bPremultiplied, premultiply(secondaryFixture.surface.data), "premultiplied");
  const linearDescriptor = { ...descriptor, colorSpace: "linear-srgb" as const };
  const linearFixtures = Object.fromEntries((["media", "text", "vector"] as const).map((kind) => [
    kind,
    makeRealInputFixture(
      fixtureEffects[kind].effectId,
      kind,
      WIDTH,
      HEIGHT,
      false,
      "linear-srgb",
      makeEffectTimeSample(
        fixtureEffects[kind].effectId,
        `qa.texture.linear.${fixtureEffects[kind].sourceId}`,
        0.5
      )
    )
  ]));
  const linearTextures = Object.fromEntries((["media", "text", "vector"] as const).map((kind) => {
    const texture = adapter.createTexture(linearDescriptor);
    adapter.uploadTexture(texture, linearFixtures[kind]!.surface.data, "straight");
    return [kind, texture];
  })) as Record<"media" | "text" | "vector", TextureHandle>;
  const linearSecondaryFixture = makeRealInputFixture(
    fixtureEffects.secondary.effectId,
    "media",
    WIDTH,
    HEIGHT,
    true,
    "linear-srgb",
    makeEffectTimeSample(
      fixtureEffects.secondary.effectId,
      `qa.texture.linear.${fixtureEffects.secondary.sourceId}.secondary`,
      0.5
    )
  );
  const linearSecondary = adapter.createTexture(linearDescriptor);
  adapter.uploadTexture(linearSecondary, linearSecondaryFixture.surface.data, "straight");

  const zeroMask = adapter.createTexture({ ...descriptor, format: "alpha8", usage: "mask" });
  adapter.uploadTexture(zeroMask, new Uint8Array(WIDTH * HEIGHT), "straight");
  const timerExtension = webgl.getExtension("EXT_disjoint_timer_query_webgl2");
  if (!timerExtension) throw new Error("EXT_disjoint_timer_query_webgl2 is required for real GPU timing.");

  async function render(
    effect: P0EffectDefinition,
    effectInstanceId: string,
    params: Readonly<Record<string, unknown>>,
    progress: number,
    quality: "draft" | "preview" | "final" = "final",
    alphaInput: "straight" | "premultiplied" = "straight",
    mask?: typeof zeroMask,
    measureGpu = false,
    renderColorSpace: "srgb" | "linear-srgb" = "srgb"
  ): Promise<{
    readonly pixels: Uint8Array;
    readonly elapsedMs: number;
    readonly gpuMs: number;
    readonly drawCalls: number;
    readonly textureAllocations: number;
    readonly compileMs: number;
    readonly heapBytes: number;
  }> {
    const time = makeEffectTimeSample(
      effect.effectId,
      effectInstanceId,
      progress,
      1,
      23.75,
      60,
      1 / 60
    );
    const sourceFixture = makeRealInputFixture(
      effect.effectId,
      kindFor(effect),
      WIDTH,
      HEIGHT,
      false,
      renderColorSpace,
      time
    );
    const secondary = makeRealInputFixture(
      effect.effectId,
      "media",
      WIDTH,
      HEIGHT,
      true,
      renderColorSpace,
      time
    );
    const sourceTexture = renderColorSpace === "linear-srgb"
      ? linearTextures[kindFor(effect)]
      : alphaInput === "straight"
        ? straightTextures[kindFor(effect)] : premultipliedTextures[kindFor(effect)];
    const secondaryTexture = renderColorSpace === "linear-srgb"
      ? linearSecondary
      : alphaInput === "straight" ? bStraight : bPremultiplied;
    const inputs = [sourceTexture, secondaryTexture];
    const dual: DualInputTextures = {
      source: rasterOutput(sourceFixture.input, sourceTexture),
      secondary: rasterOutput(secondary.input, secondaryTexture)
    };
    const frame = {
      time: time.projectTime,
      projectTime: time.projectTime,
      deltaTime: time.deltaTime,
      frame: time.frame,
      fps: time.fps,
      width: WIDTH,
      height: HEIGHT,
      seed: 20260728,
      quality,
      colorSpace: renderColorSpace
    };
    const context = {
      ...frame,
      inputTextures: inputs,
      params,
      renderer: adapter,
      timing: {
        frame,
        layerTime: sourceFixture.input.time,
        effectTime: time
      },
      data: {
        rasterInput: sourceFixture.input,
        secondaryRasterInput: secondary.input,
        dualInputTextures: dual,
        brushCoverage: makeBrushCoverage(),
        brushAssetId: "builtin://brush/round"
      },
      ...(mask ? { mask } : {})
    };
    const query = measureGpu ? webgl.createQuery() : null;
    if (measureGpu && !query) throw new Error("GPU timing query allocation failed.");
    const drawsBefore = drawCallCount;
    const texturesBefore = resourceState.createTexture!.objects.size;
    const compileBefore = shaderCompileMs;
    if (query) webgl.beginQuery(timerExtension.TIME_ELAPSED_EXT, query);
    adapter.beginFrame(context);
    let output;
    const started = performance.now();
    try {
      output = await effect.render(context);
      if (output.type !== "texture") throw new Error(`${effect.effectId} returned ${output.type}.`);
      if (query) webgl.endQuery(timerExtension.TIME_ELAPSED_EXT);
      const pixels = adapter.readTexturePixels(output.texture);
      const elapsedMs = performance.now() - started;
      let gpuNanoseconds = 0;
      if (query) {
        for (let attempt = 0; attempt < 120; attempt += 1) {
          if (webgl.getQueryParameter(query, webgl.QUERY_RESULT_AVAILABLE)) break;
          await new Promise<void>((resolveWait) => requestAnimationFrame(() => resolveWait()));
        }
        if (!webgl.getQueryParameter(query, webgl.QUERY_RESULT_AVAILABLE)
          || webgl.getParameter(timerExtension.GPU_DISJOINT_EXT)) {
          throw new Error(`${effect.effectId} GPU timer query did not resolve cleanly.`);
        }
        gpuNanoseconds = Number(webgl.getQueryParameter(query, webgl.QUERY_RESULT));
      }
      adapter.endFrame(context);
      adapter.releaseTexture(output.texture);
      if (query) webgl.deleteQuery(query);
      const heapBytes = "memory" in performance
        ? Number((performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory?.usedJSHeapSize ?? 0)
        : 0;
      return {
        pixels,
        elapsedMs,
        gpuMs: gpuNanoseconds / 1_000_000,
        drawCalls: drawCallCount - drawsBefore,
        textureAllocations: resourceState.createTexture!.objects.size - texturesBefore,
        compileMs: shaderCompileMs - compileBefore,
        heapBytes
      };
    } catch (error) {
      if (query) {
        try { webgl.endQuery(timerExtension.TIME_ELAPSED_EXT); } catch {}
        webgl.deleteQuery(query);
      }
      try { adapter.endFrame(context); } catch {}
      if (output?.type === "texture") adapter.releaseTexture(output.texture);
      throw error;
    }
  }

  const failures: string[] = [];
  const goldens: Record<string, Record<string, string>> = {};
  const perturbations: Record<string, Record<string, string>> = {};
  const performanceReport: Record<string, {
    medianMs: number;
    fps: number;
    onePercentLowFps: number;
    gpuMedianMs: number;
    drawCalls: number;
    textureAllocations: number;
    estimatedVramBytes: number;
    peakHeapBytes: number;
    firstFrameMs: number;
    shaderCompileMs: number;
    budgetMs: number;
  }> = {};
  const qualityReport: Record<string, [string, string, string]> = {};
  let alphaChecked = 0;
  let maxAlphaDelta = 0;
  let premultipliedInvariant = true;
  let maskChecked = 0;
  let masksAllZero = true;
  let deterministicChecked = 0;
  let deterministicAllEqual = true;
  let instanceRandomChecked = 0;
  let instanceRandomDeterministic = true;
  let instanceRandomDistinct = true;
  let linearSrgbChecks = 0;

  function cpuFixture(
    effect: P0EffectDefinition,
    effectInstanceId: string,
    progress: number
  ) {
    const time = makeEffectTimeSample(
      effect.effectId,
      effectInstanceId,
      progress,
      1,
      23.75,
      60,
      1 / 60
    );
    const source = makeRealInputFixture(
      effect.effectId,
      kindFor(effect),
      WIDTH,
      HEIGHT,
      false,
      "srgb",
      time
    );
    const secondary = makeRealInputFixture(
      effect.effectId,
      "media",
      WIDTH,
      HEIGHT,
      true,
      "srgb",
      time
    );
    return {
      source,
      options: {
        time,
        seed: 20260728,
        quality: "final" as const,
        rasterInput: source.input,
        secondaryRasterInput: secondary.input,
        secondary: secondary.surface,
        brushCoverage: makeBrushCoverage(),
        brushAssetId: "builtin://brush/round"
      }
    };
  }

  for (const effect of GROUP_2_P0_EFFECTS) {
    const effectInstanceId = `qa.webgl.${effect.sourceId}.primary`;
    const blueprint = GROUP_2_BLUEPRINTS.find((entry) => entry.effectId === effect.effectId)!;
    const firstFrame = await render(
      effect,
      effectInstanceId,
      effect.defaultPreset,
      0.51,
      "final",
      "straight",
      undefined,
      true
    );
    goldens[effect.effectId] = {};
    for (const progress of PROGRESSES) {
      goldens[effect.effectId]![String(progress)] = hashPixels(
        (await render(
          effect,
          effectInstanceId,
          { ...effect.defaultPreset, progress },
          progress
        )).pixels
      );
    }

    perturbations[effect.effectId] = {};
    for (const parameter of blueprint.parameters) {
      let observed: string | undefined;
      const attempts: string[] = [];
      for (const progress of SEMANTIC_PROGRESSES) {
        const baseline = await render(effect, effectInstanceId, effect.defaultPreset, progress);
        const baselineHash = hashPixels(baseline.pixels);
        const cpu = cpuFixture(effect, effectInstanceId, progress);
        const cpuBaselineHash = hashPixels(effect.renderPixels(
          cpu.source.surface,
          effect.defaultPreset,
          cpu.options
        ).data);
        for (const value of candidates(parameter)) {
          const candidateParams = {
            ...effect.defaultPreset,
            [parameter.name]: value
          };
          let candidateHash: string | undefined;
          let cpuCandidateHash: string | undefined;
          let gpuRejected = false;
          let cpuRejected = false;
          try {
            candidateHash = hashPixels(
              (await render(effect, effectInstanceId, candidateParams, progress)).pixels
            );
          } catch {
            gpuRejected = true;
          }
          try {
            cpuCandidateHash = hashPixels(effect.renderPixels(
              cpu.source.surface,
              candidateParams,
              cpu.options
            ).data);
          } catch {
            cpuRejected = true;
          }
          attempts.push(
            `${JSON.stringify(value)}:gpu=${gpuRejected ? "rejected" : `${baselineHash}->${candidateHash}`},`
              + `cpu=${cpuRejected ? "rejected" : `${cpuBaselineHash}->${cpuCandidateHash}`}@${progress}`
          );
          if ((gpuRejected && cpuRejected)
            || (candidateHash !== undefined && cpuCandidateHash !== undefined
              && candidateHash !== baselineHash && cpuCandidateHash !== cpuBaselineHash)) {
            observed = gpuRejected
              ? `gpu=explicit-rejection,cpu=explicit-rejection@${progress}`
              : `gpu=${baselineHash}->${candidateHash},cpu=${cpuBaselineHash}->${cpuCandidateHash}@${progress}`;
            break;
          }
        }
        if (observed) break;
      }
      if (!observed) {
        failures.push(
          `${effect.sourceId} ${effect.effectId}.${parameter.name}: no shared CPU/WebGL semantic perturbation (${attempts.join(",")})`
        );
      }
      else perturbations[effect.effectId]![parameter.name] = observed;
    }

    const straight = await render(
      effect,
      effectInstanceId,
      effect.defaultPreset,
      0.51,
      "final",
      "straight"
    );
    const premultiplied = await render(
      effect,
      effectInstanceId,
      effect.defaultPreset,
      0.51,
      "final",
      "premultiplied"
    );
    alphaChecked += 1;
    for (let offset = 0; offset < straight.pixels.length; offset += 1) {
      maxAlphaDelta = Math.max(
        maxAlphaDelta,
        Math.abs(straight.pixels[offset]! - premultiplied.pixels[offset]!)
      );
    }
    for (let offset = 0; offset < straight.pixels.length; offset += 4) {
      const alpha = straight.pixels[offset + 3]!;
      if (straight.pixels[offset]! > alpha
        || straight.pixels[offset + 1]! > alpha
        || straight.pixels[offset + 2]! > alpha) premultipliedInvariant = false;
      if (alpha === 0 && (straight.pixels[offset] !== 0
        || straight.pixels[offset + 1] !== 0
        || straight.pixels[offset + 2] !== 0)) premultipliedInvariant = false;
    }
    if (maxAlphaDelta > 1) failures.push(`${effect.sourceId} ${effect.effectId}: straight/premultiplied mismatch`);

    const masked = await render(
      effect,
      effectInstanceId,
      effect.defaultPreset,
      0.51,
      "final",
      "straight",
      zeroMask
    );
    maskChecked += 1;
    if (masked.pixels.some((byte) => byte !== 0)) {
      masksAllZero = false;
      failures.push(`${effect.sourceId} ${effect.effectId}: zero external mask leaked pixels`);
    }

    const deterministicA = await render(effect, effectInstanceId, effect.defaultPreset, 0.51);
    const deterministicB = await render(effect, effectInstanceId, effect.defaultPreset, 0.51);
    deterministicChecked += 1;
    if (hashPixels(deterministicA.pixels) !== hashPixels(deterministicB.pixels)) {
      deterministicAllEqual = false;
      failures.push(`${effect.sourceId} ${effect.effectId}: nondeterministic WebGL output`);
    }
    if (RANDOM_SOURCE_IDS.has(effect.sourceId)) {
      const params = { ...effect.defaultPreset, ...RANDOM_PARAMS[effect.sourceId] };
      const hashesFor = async (instanceId: string): Promise<string[]> => {
        const hashes: string[] = [];
        for (let runIndex = 0; runIndex < 3; runIndex += 1) {
          hashes.push(hashPixels((await render(effect, instanceId, params, 0.371)).pixels));
        }
        return hashes;
      };
      const firstHashes = await hashesFor(`qa.webgl.${effect.sourceId}.instance-a`);
      const secondHashes = await hashesFor(`qa.webgl.${effect.sourceId}.instance-b`);
      instanceRandomChecked += 1;
      if (new Set(firstHashes).size !== 1 || new Set(secondHashes).size !== 1) {
        instanceRandomDeterministic = false;
        failures.push(`${effect.sourceId} ${effect.effectId}: instance random stream is not three-run deterministic`);
      }
      if (firstHashes[0] === secondHashes[0]) {
        instanceRandomDistinct = false;
        failures.push(`${effect.sourceId} ${effect.effectId}: instance random streams are not isolated`);
      }
    }

    qualityReport[effect.effectId] = [
      hashPixels((await render(effect, effectInstanceId, effect.defaultPreset, 0.51, "draft")).pixels),
      hashPixels((await render(effect, effectInstanceId, effect.defaultPreset, 0.51, "preview")).pixels),
      hashPixels((await render(effect, effectInstanceId, effect.defaultPreset, 0.51, "final")).pixels)
    ];

    const linearOutput = await render(
      effect,
      effectInstanceId,
      effect.defaultPreset,
      0.51,
      "final",
      "straight",
      undefined,
      false,
      "linear-srgb"
    );
    if (!linearOutput.pixels.some((byte, index) => index % 4 === 3 && byte !== 0)) {
      failures.push(`${effect.sourceId} ${effect.effectId}: empty linear-sRGB WebGL output`);
    }
    linearSrgbChecks += 1;

    const samples: Array<Awaited<ReturnType<typeof render>>> = [];
    for (let index = 0; index < 100; index += 1) {
      samples.push(await render(
        effect,
        effectInstanceId,
        effect.defaultPreset,
        0.51,
        "final",
        "straight",
        undefined,
        index < 7
      ));
    }
    const elapsedSamples = samples.map((sample) => sample.elapsedMs);
    const gpuSamples = samples.map((sample) => sample.gpuMs).filter((value) => value > 0);
    const medianMs = median(elapsedSamples);
    const sortedFrameMs = [...elapsedSamples].sort((left, right) => left - right);
    const onePercentFrameMs = sortedFrameMs[Math.max(0, Math.ceil(sortedFrameMs.length * 0.99) - 1)]!;
    performanceReport[effect.effectId] = {
      medianMs: Number(medianMs.toFixed(3)),
      fps: Number((1000 / Math.max(0.001, medianMs)).toFixed(2)),
      onePercentLowFps: Number((1000 / Math.max(0.001, onePercentFrameMs)).toFixed(2)),
      gpuMedianMs: Number(median(gpuSamples).toFixed(3)),
      drawCalls: Math.max(...samples.map((sample) => sample.drawCalls)),
      textureAllocations: Math.max(...samples.map((sample) => sample.textureAllocations)),
      estimatedVramBytes: WIDTH * HEIGHT * 4 * 6,
      peakHeapBytes: Math.max(...samples.map((sample) => sample.heapBytes)),
      firstFrameMs: Number(firstFrame.elapsedMs.toFixed(3)),
      shaderCompileMs: Number(firstFrame.compileMs.toFixed(3)),
      budgetMs: effect.benchmarkBudgetMs
    };
    if (medianMs > effect.benchmarkBudgetMs) {
      failures.push(`${effect.sourceId} ${effect.effectId}: ${medianMs.toFixed(3)}ms > ${effect.benchmarkBudgetMs}ms`);
    }
  }

  const distinct = new Set(Object.values(goldens).map((frames) =>
    PROGRESSES.map((progress) => frames[String(progress)]).join(":"))).size;
  if (distinct !== 39) {
    const idsByHash = new Map<string, string[]>();
    for (const [effectId, frames] of Object.entries(goldens)) {
      const hash = PROGRESSES.map((progress) => frames[String(progress)]).join(":");
      idsByHash.set(hash, [...(idsByHash.get(hash) ?? []), effectId]);
    }
    const collisions = [...idsByHash.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([hash, ids]) => `${hash}:${ids.join(",")}`)
      .join(";");
    failures.push(`WebGL Golden sequences are only ${distinct}/39 distinct (${collisions})`);
  }
  if (!premultipliedInvariant) failures.push("premultiplied output invariant failed");

  for (const texture of Object.values(straightTextures)) adapter.releaseTexture(texture);
  adapter.releaseTexture(bStraight);
  for (const texture of Object.values(premultipliedTextures)) adapter.releaseTexture(texture);
  adapter.releaseTexture(bPremultiplied);
  for (const texture of Object.values(linearTextures)) adapter.releaseTexture(texture);
  adapter.releaseTexture(linearSecondary);
  adapter.releaseTexture(zeroMask);
  adapter.dispose();
  const resources = Object.fromEntries(Object.entries(resourceState).map(([name, state]) => [
    name,
    {
      created: state.objects.size,
      deleted: state.deleted.size,
      duplicateDeletes: state.duplicateDeletes
    }
  ]));
  for (const [name, counts] of Object.entries(resources)) {
    if (counts.created !== counts.deleted || counts.duplicateDeletes !== 0) {
      failures.push(
        `${name}: created=${counts.created}, deleted=${counts.deleted}, duplicateDeletes=${counts.duplicateDeletes}`
      );
    }
  }

  return {
    runtime: {
      userAgent: navigator.userAgent,
      webglVersion: String(gl.getParameter(gl.VERSION)),
      renderer: rendererName,
      width: WIDTH,
      height: HEIGHT
    },
    goldens,
    perturbations,
    performance: performanceReport,
    quality: qualityReport,
    alpha: {
      checked: alphaChecked,
      maxStraightPremultipliedDelta: maxAlphaDelta,
      premultipliedInvariant
    },
    masks: { checked: maskChecked, allZero: masksAllZero },
    deterministic: { checked: deterministicChecked, allEqual: deterministicAllEqual },
    instanceRandom: {
      checked: instanceRandomChecked,
      threeRunDeterministic: instanceRandomDeterministic,
      streamsDistinct: instanceRandomDistinct
    },
    colorSpaces: {
      srgbChecks: GROUP_2_P0_EFFECTS.length,
      linearSrgbChecks,
      displayP3FallbackRequired: !adapter.capabilities.supportedColorSpaces.includes("display-p3")
    },
    resources,
    semanticDistinctFrames: distinct,
    failures
  };
}

run().then((result) => {
  window.__CMFX_WEBGL_QA__ = result;
  status.textContent = JSON.stringify(result, null, 2);
}).catch((error: unknown) => {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  window.__CMFX_WEBGL_QA_ERROR__ = message;
  status.textContent = message;
});
