/// <reference lib="dom" />

import { WebGLRendererAdapter } from "../../renderer-webgl/src/index.js";
import {
  GROUP_2_BLUEPRINTS,
  GROUP_2_P0_EFFECTS,
  makePreviewInput,
  type ParameterSpec,
  type P0EffectDefinition
} from "../src/index.js";

const WIDTH = 64;
const HEIGHT = 36;
const PROGRESSES = [0, 0.25, 0.5, 0.75, 1] as const;
const SEMANTIC_PROGRESSES = [0.23, 0.51, 0.77] as const;
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
  const trackedGl = new Proxy(gl, {
    get(target, property) {
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
  const aSurface = makePreviewInput(WIDTH, HEIGHT);
  const bSurface = makePreviewInput(WIDTH, HEIGHT, true);
  const aStraight = adapter.createTexture(descriptor);
  const bStraight = adapter.createTexture(descriptor);
  const aPremultiplied = adapter.createTexture(descriptor);
  const bPremultiplied = adapter.createTexture(descriptor);
  adapter.uploadTexture(aStraight, aSurface.data, "straight");
  adapter.uploadTexture(bStraight, bSurface.data, "straight");
  adapter.uploadTexture(aPremultiplied, premultiply(aSurface.data), "premultiplied");
  adapter.uploadTexture(bPremultiplied, premultiply(bSurface.data), "premultiplied");

  const zeroMask = adapter.createTexture({ ...descriptor, format: "alpha8", usage: "mask" });
  adapter.uploadTexture(zeroMask, new Uint8Array(WIDTH * HEIGHT), "straight");

  async function render(
    effect: P0EffectDefinition,
    params: Readonly<Record<string, unknown>>,
    progress: number,
    quality: "draft" | "preview" | "final" = "final",
    alphaInput: "straight" | "premultiplied" = "straight",
    mask?: typeof zeroMask
  ): Promise<{ readonly pixels: Uint8Array; readonly elapsedMs: number }> {
    const inputs = alphaInput === "straight"
      ? [aStraight, bStraight] : [aPremultiplied, bPremultiplied];
    const context = {
      time: progress,
      deltaTime: 1 / 30,
      frame: Math.round(progress * 30),
      fps: 30,
      width: WIDTH,
      height: HEIGHT,
      seed: 20260728,
      quality,
      colorSpace: "srgb" as const,
      inputTextures: inputs,
      params,
      renderer: adapter,
      ...(mask ? { mask } : {})
    };
    adapter.beginFrame(context);
    let output;
    const started = performance.now();
    try {
      output = await effect.render(context);
      if (output.type !== "texture") throw new Error(`${effect.effectId} returned ${output.type}.`);
      const pixels = adapter.readTexturePixels(output.texture);
      const elapsedMs = performance.now() - started;
      adapter.endFrame(context);
      adapter.releaseTexture(output.texture);
      return { pixels, elapsedMs };
    } catch (error) {
      try { adapter.endFrame(context); } catch {}
      if (output?.type === "texture") adapter.releaseTexture(output.texture);
      throw error;
    }
  }

  const failures: string[] = [];
  const goldens: Record<string, Record<string, string>> = {};
  const perturbations: Record<string, Record<string, string>> = {};
  const performanceReport: Record<string, { medianMs: number; budgetMs: number }> = {};
  const qualityReport: Record<string, [string, string, string]> = {};
  let alphaChecked = 0;
  let maxAlphaDelta = 0;
  let premultipliedInvariant = true;
  let maskChecked = 0;
  let masksAllZero = true;
  let deterministicChecked = 0;
  let deterministicAllEqual = true;

  for (const effect of GROUP_2_P0_EFFECTS) {
    const blueprint = GROUP_2_BLUEPRINTS.find((entry) => entry.effectId === effect.effectId)!;
    goldens[effect.effectId] = {};
    for (const progress of PROGRESSES) {
      goldens[effect.effectId]![String(progress)] = hashPixels(
        (await render(effect, { ...effect.defaultPreset, progress }, progress)).pixels
      );
    }

    perturbations[effect.effectId] = {};
    for (const parameter of blueprint.parameters) {
      let observed: string | undefined;
      const attempts: string[] = [];
      for (const progress of SEMANTIC_PROGRESSES) {
        const baseline = await render(effect, effect.defaultPreset, progress);
        const baselineHash = hashPixels(baseline.pixels);
        const cpuBaselineHash = hashPixels(effect.renderPixels(
          aSurface,
          effect.defaultPreset,
          { progress, seed: 20260728, quality: "final", secondary: bSurface }
        ).data);
        for (const value of candidates(parameter)) {
          const candidateParams = {
            ...effect.defaultPreset,
            [parameter.name]: value
          };
          const candidate = await render(effect, {
            ...candidateParams
          }, progress);
          const candidateHash = hashPixels(candidate.pixels);
          const cpuCandidateHash = hashPixels(effect.renderPixels(
            aSurface,
            candidateParams,
            { progress, seed: 20260728, quality: "final", secondary: bSurface }
          ).data);
          attempts.push(
            `${JSON.stringify(value)}:gpu=${baselineHash}->${candidateHash},cpu=${cpuBaselineHash}->${cpuCandidateHash}@${progress}`
          );
          if (candidateHash !== baselineHash && cpuCandidateHash !== cpuBaselineHash) {
            observed = `gpu=${baselineHash}->${candidateHash},cpu=${cpuBaselineHash}->${cpuCandidateHash}@${progress}`;
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

    const straight = await render(effect, effect.defaultPreset, 0.51, "final", "straight");
    const premultiplied = await render(effect, effect.defaultPreset, 0.51, "final", "premultiplied");
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

    const masked = await render(effect, effect.defaultPreset, 0.51, "final", "straight", zeroMask);
    maskChecked += 1;
    if (masked.pixels.some((byte) => byte !== 0)) {
      masksAllZero = false;
      failures.push(`${effect.sourceId} ${effect.effectId}: zero external mask leaked pixels`);
    }

    const deterministicA = await render(effect, effect.defaultPreset, 0.51);
    const deterministicB = await render(effect, effect.defaultPreset, 0.51);
    deterministicChecked += 1;
    if (hashPixels(deterministicA.pixels) !== hashPixels(deterministicB.pixels)) {
      deterministicAllEqual = false;
      failures.push(`${effect.sourceId} ${effect.effectId}: nondeterministic WebGL output`);
    }

    qualityReport[effect.effectId] = [
      hashPixels((await render(effect, effect.defaultPreset, 0.51, "draft")).pixels),
      hashPixels((await render(effect, effect.defaultPreset, 0.51, "preview")).pixels),
      hashPixels((await render(effect, effect.defaultPreset, 0.51, "final")).pixels)
    ];

    await render(effect, effect.defaultPreset, 0.51);
    const samples: number[] = [];
    for (let index = 0; index < 7; index += 1) {
      samples.push((await render(effect, effect.defaultPreset, 0.51)).elapsedMs);
    }
    const medianMs = median(samples);
    performanceReport[effect.effectId] = {
      medianMs: Number(medianMs.toFixed(3)),
      budgetMs: effect.benchmarkBudgetMs
    };
    if (medianMs > effect.benchmarkBudgetMs) {
      failures.push(`${effect.sourceId} ${effect.effectId}: ${medianMs.toFixed(3)}ms > ${effect.benchmarkBudgetMs}ms`);
    }
  }

  const distinct = new Set(Object.values(goldens).map((frames) => frames["0.5"])).size;
  if (distinct !== 39) {
    const idsByHash = new Map<string, string[]>();
    for (const [effectId, frames] of Object.entries(goldens)) {
      const hash = frames["0.5"]!;
      idsByHash.set(hash, [...(idsByHash.get(hash) ?? []), effectId]);
    }
    const collisions = [...idsByHash.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([hash, ids]) => `${hash}:${ids.join(",")}`)
      .join(";");
    failures.push(`default WebGL semantic frames are only ${distinct}/39 distinct (${collisions})`);
  }
  if (!premultipliedInvariant) failures.push("premultiplied output invariant failed");

  adapter.releaseTexture(aStraight);
  adapter.releaseTexture(bStraight);
  adapter.releaseTexture(aPremultiplied);
  adapter.releaseTexture(bPremultiplied);
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
