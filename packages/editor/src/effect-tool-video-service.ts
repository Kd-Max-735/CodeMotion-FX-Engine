import { constants as fsConstants, type ReadStream } from "node:fs";
import { mkdir, open, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  executeSelectedEffectTool,
  type AuthorizedEffectInputs,
  type EffectParameterEnvelope,
  type EffectRenderResult,
  type EffectToolDefinition,
  type ServerEffectRenderContext
} from "@codemotion/effect-functions";
import {
  decodeMediaFrame,
  exportFixedFrames,
  validateExportPreset,
  type OwnerContext,
  type TenantMediaStore,
  type VerifiedStoredMedia
} from "@codemotion/exporter";
import { composeEffectToolFrame } from "./effect-tool-frame-compositor.js";
import {
  captureWavePathSnapshot,
  queuedWavePathSelfCheck,
  runWavePathSelfCheck,
  wavePathSamplingPlan,
  type EffectToolSelfCheckView,
  type WavePathRenderSnapshot,
  type WavePathSelfCheckReviewer
} from "./wave-path-self-check.js";
import {
  DEDICATED_SELF_CHECK_TOOL_NAMES,
  queuedDedicatedSelfCheck,
  type DedicatedEffectToolSelfCheckView,
  type DedicatedSelfCheckReviewer,
  type DedicatedSelfCheckRunner,
  type DedicatedSelfCheckToolName
} from "./dedicated-effect-self-check-common.js";
import { runBackgroundRemoveComposeSelfCheck } from "./background-remove-compose-self-check.js";
import { runBlendSelfCheck } from "./blend-self-check.js";
import { runBlobMorphSelfCheck } from "./blob-morph-self-check.js";
import { runChartRevealSelfCheck } from "./chart-reveal-self-check.js";
import { runCharacterCascadeSelfCheck } from "./character-cascade-self-check.js";
import { runHandwritingSelfCheck } from "./handwriting-self-check.js";
import { runBrushRevealSelfCheck } from "./brush-reveal-self-check.js";
import { runMaskRevealSelfCheck } from "./mask-reveal-self-check.js";
import { runPaintOnSelfCheck } from "./paint-on-self-check.js";
import {
  isVisualSelfCheckTool,
  queuedVisualEffectSelfCheck,
  runVisualEffectSelfCheck,
  type VisualEffectSelfCheckView,
  type VisualSelfCheckReviewer
} from "./visual-effect-self-check.js";
import {
  isListedSelfCheckTool,
  queuedListedToolSelfCheck,
  runListedToolSelfCheck
} from "./self-check/listed-tool-self-check.js";
import type { ObservedEffectSelfCheckView } from "./self-check/observed-video-self-check.js";
import {
  hasObservedMotionSelfCheck,
  queuedObservedMotionSelfCheck,
  type ObservedMotionSelfCheckArtifacts,
  type ObservedMotionSelfCheckRequest,
  type ObservedMotionSelfCheckReviewer,
  type ObservedMotionSelfCheckTool,
  type ObservedMotionSelfCheckView
} from "./observed-motion-self-check.js";
import { runHandheldSelfCheck } from "./self-checks/handheld-self-check.js";
import { runBounceSelfCheck } from "./self-checks/bounce-self-check.js";
import { runElasticSelfCheck } from "./self-checks/elastic-self-check.js";
import { runFloatSelfCheck } from "./self-checks/float-self-check.js";
import { runFadeSelfCheck } from "./self-checks/fade-self-check.js";
import { runRotateInSelfCheck } from "./self-checks/rotate-in-self-check.js";
import { runScalePopSelfCheck } from "./self-checks/scale-pop-self-check.js";
import { runSlideSelfCheck } from "./self-checks/slide-self-check.js";
import { runKenBurnsSelfCheck } from "./self-checks/ken-burns-self-check.js";
import { runDollySelfCheck } from "./self-checks/dolly-self-check.js";
import {
  NOISE_FIELD_SELF_CHECK,
  PARTICLE_DISSOLVE_SELF_CHECK,
  PARTICLE_EMITTER_SELF_CHECK,
  PARTICLE_FLOW_FIELD_SELF_CHECK,
  PARTICLE_LOGO_ASSEMBLE_SELF_CHECK,
  PARTICLE_ORBIT_FIELD_SELF_CHECK,
  PARTICLE_SNOW_RAIN_SELF_CHECK,
  PARTICLE_SPARK_SELF_CHECK,
  PARTICLE_TRAIL_SELF_CHECK,
  SIM_COLLISION_SHATTER_SELF_CHECK,
  queuedObservableSelfCheck,
  runNoiseFieldSelfCheck,
  runParticleDissolveSelfCheck,
  runParticleEmitterSelfCheck,
  runParticleFlowFieldSelfCheck,
  runParticleLogoAssembleSelfCheck,
  runParticleOrbitFieldSelfCheck,
  runParticleSnowRainSelfCheck,
  runParticleSparkSelfCheck,
  runParticleTrailSelfCheck,
  runSimCollisionShatterSelfCheck,
  type ObservableFrameObservation,
  type ObservableSelfCheckDefinition,
  type ObservableSelfCheckRequest,
  type ObservableSelfCheckReviewer,
  type ObservableSelfCheckToolName,
  type ObservableSelfCheckView
} from "./self-checks/index.js";
import {
  FINAL_VIDEO_SELF_CHECK_TOOLS,
  queuedFinalVideoSelfCheck,
  type FinalVideoSelfCheckArtifacts,
  type FinalVideoSelfCheckRequest,
  type FinalVideoSelfCheckToolName,
  type FinalVideoSelfCheckView
} from "./final-video-self-check.js";
import { runAuraFieldSelfCheck } from "./aura-field-self-check.js";
import { runGradientFlowSelfCheck } from "./gradient-flow-self-check.js";
import { runNeonGlowSelfCheck } from "./neon-glow-self-check.js";
import { runEnergyPulseSelfCheck } from "./energy-pulse-self-check.js";
import { runLensFlareSelfCheck } from "./lens-flare-self-check.js";
import { runNeonTraceSelfCheck } from "./neon-trace-self-check.js";
import { runSacredGeometrySelfCheck } from "./sacred-geometry-self-check.js";
import { runScanBeamSelfCheck } from "./scan-beam-self-check.js";
import { runVolumetricRaySelfCheck } from "./volumetric-ray-self-check.js";
import { runHologramSelfCheck } from "./hologram-self-check.js";
import { type EffectSelfCheckRequest, type EffectSelfCheckView } from "./visual-quality-self-check-common.js";
import { queuedChromaticAberrationSelfCheck, runChromaticAberrationSelfCheck } from "./chromatic-aberration-self-check.js";
import { queuedColorGradeSelfCheck, runColorGradeSelfCheck } from "./color-grade-self-check.js";
import { queuedFilmGrainSelfCheck, runFilmGrainSelfCheck } from "./film-grain-self-check.js";
import { queuedGaussianBlurSelfCheck, runGaussianBlurSelfCheck } from "./gaussian-blur-self-check.js";
import { queuedDirectionalBlurSelfCheck, runDirectionalBlurSelfCheck } from "./directional-blur-self-check.js";
import { queuedMotionBlurSelfCheck, runMotionBlurSelfCheck } from "./motion-blur-self-check.js";
import { queuedRadialBlurSelfCheck, runRadialBlurSelfCheck } from "./radial-blur-self-check.js";
import { queuedRgbSplitSelfCheck, runRgbSplitSelfCheck } from "./rgb-split-self-check.js";
import { queuedTextureOverlaySelfCheck, runTextureOverlaySelfCheck } from "./texture-overlay-self-check.js";
import { queuedTrackMatteSelfCheck, runTrackMatteSelfCheck } from "./track-matte-self-check.js";

const DEFAULT_VIDEO_DURATION_SECONDS = 5;
const DEFAULT_VIDEO_FPS = 30;
const MAX_VIDEO_DURATION_SECONDS = 3_600;
const MAX_EFFECT_DIMENSION = 4_096;
const DEFAULT_GPU_SAMPLE_INTERVAL_MS = 1_000;
const GPU_QUERY_TIMEOUT_MS = 2_000;
const MAX_HISTORY_FRAME_CACHE_BYTES = 192 * 1024 * 1024;
const DEDICATED_SELF_CHECK_TOOLS = new Set<string>(DEDICATED_SELF_CHECK_TOOL_NAMES);
const DEFAULT_DEDICATED_SELF_CHECK_RUNNERS: Readonly<Record<DedicatedSelfCheckToolName, DedicatedSelfCheckRunner>> = Object.freeze({
  background_remove_compose: runBackgroundRemoveComposeSelfCheck,
  blend: runBlendSelfCheck,
  blob_morph: runBlobMorphSelfCheck,
  chart_reveal: runChartRevealSelfCheck,
  character_cascade: runCharacterCascadeSelfCheck,
  handwriting: runHandwritingSelfCheck,
  brush_reveal: runBrushRevealSelfCheck,
  mask_reveal: runMaskRevealSelfCheck,
  paint_on: runPaintOnSelfCheck
});
type FinalVideoSelfCheckRunner = (request: FinalVideoSelfCheckRequest) => Promise<FinalVideoSelfCheckArtifacts>;
const FINAL_VIDEO_SELF_CHECK_TOOL_SET = new Set<string>(FINAL_VIDEO_SELF_CHECK_TOOLS);
const DEFAULT_FINAL_VIDEO_SELF_CHECK_RUNNERS: Readonly<Record<FinalVideoSelfCheckToolName, FinalVideoSelfCheckRunner>> = Object.freeze({
  aura_field: runAuraFieldSelfCheck,
  gradient_flow: runGradientFlowSelfCheck,
  neon_glow: runNeonGlowSelfCheck,
  energy_pulse: runEnergyPulseSelfCheck,
  lens_flare: runLensFlareSelfCheck,
  neon_trace: runNeonTraceSelfCheck,
  sacred_geometry: runSacredGeometrySelfCheck,
  scan_beam: runScanBeamSelfCheck,
  volumetric_ray: runVolumetricRaySelfCheck,
  hologram: runHologramSelfCheck
});

const REQUESTED_SELF_CHECK_TOOL_NAMES = Object.freeze([
  "chromatic_aberration", "color_grade", "film_grain", "gaussian_blur", "directional_blur",
  "motion_blur", "radial_blur", "rgb_split", "texture_overlay", "track_matte"
] as const);
type RequestedSelfCheckToolName = typeof REQUESTED_SELF_CHECK_TOOL_NAMES[number];
type RequestedSelfCheckRequest = Omit<EffectSelfCheckRequest<string>, "toolName" | "reviewer">;
type RequestedSelfCheckArtifacts = Readonly<{
  view: EffectSelfCheckView<RequestedSelfCheckToolName>;
  evidenceFiles: ReadonlyMap<string, string>;
}>;
type RequestedSelfCheckRunner = (
  toolName: RequestedSelfCheckToolName,
  request: RequestedSelfCheckRequest
) => Promise<RequestedSelfCheckArtifacts>;
const REQUESTED_SELF_CHECK_TOOLS = new Set<string>(REQUESTED_SELF_CHECK_TOOL_NAMES);

function requestedSelfCheckTool(toolName: string): toolName is RequestedSelfCheckToolName {
  return REQUESTED_SELF_CHECK_TOOLS.has(toolName);
}

function queuedRequestedSelfCheck(toolName: RequestedSelfCheckToolName): EffectSelfCheckView<RequestedSelfCheckToolName> {
  switch (toolName) {
    case "chromatic_aberration": return queuedChromaticAberrationSelfCheck();
    case "color_grade": return queuedColorGradeSelfCheck();
    case "film_grain": return queuedFilmGrainSelfCheck();
    case "gaussian_blur": return queuedGaussianBlurSelfCheck();
    case "directional_blur": return queuedDirectionalBlurSelfCheck();
    case "motion_blur": return queuedMotionBlurSelfCheck();
    case "radial_blur": return queuedRadialBlurSelfCheck();
    case "rgb_split": return queuedRgbSplitSelfCheck();
    case "texture_overlay": return queuedTextureOverlaySelfCheck();
    case "track_matte": return queuedTrackMatteSelfCheck();
  }
}

async function runRequestedSelfCheck(
  toolName: RequestedSelfCheckToolName,
  request: RequestedSelfCheckRequest
): Promise<RequestedSelfCheckArtifacts> {
  switch (toolName) {
    case "chromatic_aberration": return runChromaticAberrationSelfCheck(request);
    case "color_grade": return runColorGradeSelfCheck(request);
    case "film_grain": return runFilmGrainSelfCheck(request);
    case "gaussian_blur": return runGaussianBlurSelfCheck(request);
    case "directional_blur": return runDirectionalBlurSelfCheck(request);
    case "motion_blur": return runMotionBlurSelfCheck(request);
    case "radial_blur": return runRadialBlurSelfCheck(request);
    case "rgb_split": return runRgbSplitSelfCheck(request);
    case "texture_overlay": return runTextureOverlaySelfCheck(request);
    case "track_matte": return runTrackMatteSelfCheck(request);
  }
}

function finalVideoSelfCheckTool(toolName: string): toolName is FinalVideoSelfCheckToolName {
  return FINAL_VIDEO_SELF_CHECK_TOOL_SET.has(toolName);
}

function dedicatedSelfCheckTool(toolName: string): toolName is DedicatedSelfCheckToolName {
  return DEDICATED_SELF_CHECK_TOOLS.has(toolName);
}

type ObservableSelfCheckRunner = (request: ObservableSelfCheckRequest) => ReturnType<typeof runParticleDissolveSelfCheck>;
type ObservableSelfCheckHandler = Readonly<{
  definition: ObservableSelfCheckDefinition;
  run: ObservableSelfCheckRunner;
}>;

const OBSERVABLE_SELF_CHECK_HANDLERS: ReadonlyMap<string, ObservableSelfCheckHandler> = new Map([
  ["particle_dissolve", { definition: PARTICLE_DISSOLVE_SELF_CHECK, run: runParticleDissolveSelfCheck }],
  ["particle_flow_field", { definition: PARTICLE_FLOW_FIELD_SELF_CHECK, run: runParticleFlowFieldSelfCheck }],
  ["particle_orbit_field", { definition: PARTICLE_ORBIT_FIELD_SELF_CHECK, run: runParticleOrbitFieldSelfCheck }],
  ["particle_snow_rain", { definition: PARTICLE_SNOW_RAIN_SELF_CHECK, run: runParticleSnowRainSelfCheck }],
  ["particle_spark", { definition: PARTICLE_SPARK_SELF_CHECK, run: runParticleSparkSelfCheck }],
  ["particle_emitter", { definition: PARTICLE_EMITTER_SELF_CHECK, run: runParticleEmitterSelfCheck }],
  ["particle_logo_assemble", { definition: PARTICLE_LOGO_ASSEMBLE_SELF_CHECK, run: runParticleLogoAssembleSelfCheck }],
  ["particle_trail", { definition: PARTICLE_TRAIL_SELF_CHECK, run: runParticleTrailSelfCheck }],
  ["noise_field", { definition: NOISE_FIELD_SELF_CHECK, run: runNoiseFieldSelfCheck }],
  ["sim_collision_shatter", { definition: SIM_COLLISION_SHATTER_SELF_CHECK, run: runSimCollisionShatterSelfCheck }]
]);

function observableSelfCheckHandler(toolName: string): ObservableSelfCheckHandler | undefined {
  return OBSERVABLE_SELF_CHECK_HANDLERS.get(toolName);
}

type ObservedMotionSelfCheckRunner = (
  request: ObservedMotionSelfCheckRequest
) => Promise<ObservedMotionSelfCheckArtifacts>;

const OBSERVED_MOTION_SELF_CHECK_RUNNERS: Readonly<Record<ObservedMotionSelfCheckTool, ObservedMotionSelfCheckRunner>> =
  Object.freeze({
    handheld: runHandheldSelfCheck,
    bounce: runBounceSelfCheck,
    elastic: runElasticSelfCheck,
    float: runFloatSelfCheck,
    fade: runFadeSelfCheck,
    rotate_in: runRotateInSelfCheck,
    scale_pop: runScalePopSelfCheck,
    slide: runSlideSelfCheck,
    ken_burns: runKenBurnsSelfCheck,
    dolly: runDollySelfCheck
  });

export type EffectToolVideoTaskStatus = "queued" | "running" | "completed" | "failed";

export interface NvidiaGpuSample {
  readonly name: string;
  readonly memoryUsedMiB: number;
  readonly memoryTotalMiB: number;
  readonly utilizationPercent: number;
}

export interface EffectToolGpuTelemetryView {
  readonly available: boolean;
  readonly name?: string;
  readonly memoryUsedMiB?: number;
  readonly memoryTotalMiB?: number;
  readonly utilizationPercent?: number;
  readonly peakMemoryUsedMiB?: number;
  readonly sampledAt?: string;
  readonly message?: string;
}

export interface EffectToolVideoExecutionView {
  readonly id: string;
  readonly status: EffectToolVideoTaskStatus;
  readonly toolName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly source?: {
    readonly kind: "image";
    readonly assetId: string;
  };
  readonly video: {
    readonly format: "mp4";
    readonly mime: "video/mp4";
    readonly width: number;
    readonly height: number;
    readonly fps: number;
    readonly durationSeconds: number;
    readonly frameCount: number;
    readonly completedFrames: number;
    readonly progress: number;
    readonly audio: boolean;
    readonly bytes?: number;
    readonly downloadName?: string;
  };
  readonly gpu: EffectToolGpuTelemetryView;
  readonly selfCheck?: EffectToolSelfCheckView | DedicatedEffectToolSelfCheckView | VisualEffectSelfCheckView
    | ObservedEffectSelfCheckView | ObservableSelfCheckView | FinalVideoSelfCheckView | ObservedMotionSelfCheckView
    | EffectSelfCheckView<RequestedSelfCheckToolName>;
  readonly failure?: {
    readonly code: "VIDEO_RENDER_FAILED";
    readonly message: string;
  };
}

export interface EffectToolVideoFile {
  readonly stream: ReadStream;
  readonly bytes: number;
  readonly name: string;
  readonly close: () => Promise<void>;
}

interface StoredVideoTask {
  readonly owner: OwnerContext;
  readonly sourceAssetIds: readonly string[];
  readonly outputPath: string;
  readonly controller: AbortController;
  readonly selfCheckPrompt?: string;
  readonly selfCheckEvidenceFiles: Map<string, string>;
  readonly prepared?: {
    readonly inputs: AuthorizedEffectInputs;
    readonly inputIds?: Readonly<Record<string, string | readonly string[]>>;
    readonly width: number;
    readonly height: number;
  };
  view: EffectToolVideoExecutionView;
}

export interface EffectToolVideoServiceOptions {
  readonly media: Pick<TenantMediaStore, "resolve">;
  readonly outputRoot: string;
  readonly ffmpegPath?: string;
  readonly exportFrames?: typeof exportFixedFrames;
  readonly decodeFrame?: typeof decodeMediaFrame;
  readonly durationSeconds?: number;
  readonly fps?: number;
  readonly gpuSampler?: () => Promise<NvidiaGpuSample>;
  readonly gpuSampleIntervalMs?: number;
  readonly wavePathSelfCheckReviewer?: WavePathSelfCheckReviewer;
  readonly wavePathSelfCheckRunner?: typeof runWavePathSelfCheck;
  readonly visualSelfCheckReviewer?: VisualSelfCheckReviewer;
  readonly visualSelfCheckRunner?: typeof runVisualEffectSelfCheck;
  readonly listedToolSelfCheckRunner?: typeof runListedToolSelfCheck;
  readonly observableSelfCheckReviewer?: ObservableSelfCheckReviewer;
  readonly observedMotionSelfCheckReviewer?: ObservedMotionSelfCheckReviewer;
  readonly dedicatedSelfCheckReviewer?: DedicatedSelfCheckReviewer;
  readonly dedicatedSelfCheckRunners?: Partial<Record<DedicatedSelfCheckToolName, DedicatedSelfCheckRunner>>;
  readonly finalVideoSelfCheckRunners?: Partial<Record<FinalVideoSelfCheckToolName, FinalVideoSelfCheckRunner>>;
  readonly requestedSelfCheckRunner?: RequestedSelfCheckRunner;
  readonly requestedSelfCheckApiKey?: string;
  readonly requestedSelfCheckFetchImpl?: typeof fetch;
}

export interface EffectToolEvidenceFile {
  readonly stream: ReadStream;
  readonly bytes: number;
  readonly name: string;
  readonly mime: "image/png";
  readonly close: () => Promise<void>;
}

function taskKey(owner: OwnerContext, id: string): string {
  return JSON.stringify([owner.tenantId, owner.userId, id]);
}

function safeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} is invalid.`);
  }
  return value;
}

function integratedRampEase(value: number, curve: unknown): number {
  const t = Math.max(0, Math.min(1, value));
  if (curve === "ease_in") return t ** 3 / 3;
  if (curve === "ease_out") return t * t - t ** 3 / 3;
  if (curve === "ease_in_out") return t < 0.5
    ? 2 * t ** 3 / 3 : -t + 2 * t * t - 2 * t ** 3 / 3 + 1 / 6;
  return t * t / 2;
}

function speedRampSourceTime(outputTime: number, params: Readonly<Record<string, unknown>>): number {
  const time = Math.max(0, outputTime);
  const rampStart = Number(params.rampStart ?? 1);
  const rampDuration = Math.max(0.001, Number(params.rampDuration ?? 2));
  const speedBefore = Number(params.speedBefore ?? 1);
  const speedAfter = Number(params.speedAfter ?? 2);
  if (time <= rampStart) return time * speedBefore;
  const rampElapsed = Math.min(rampDuration, time - rampStart);
  const x = rampElapsed / rampDuration;
  const rampSource = rampDuration * (speedBefore * x
    + (speedAfter - speedBefore) * integratedRampEase(x, params.curve));
  return rampStart * speedBefore + rampSource
    + Math.max(0, time - rampStart - rampDuration) * speedAfter;
}

function foregroundMatte(pixels: Uint8Array, width: number, height: number): number[] {
  let red = 0; let green = 0; let blue = 0; let count = 0;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (x !== 0 && y !== 0 && x !== width - 1 && y !== height - 1) continue;
    const offset = (y * width + x) * 4;
    red += pixels[offset]!; green += pixels[offset + 1]!; blue += pixels[offset + 2]!; count += 1;
  }
  const edge = [red / count, green / count, blue / count];
  return Array.from({ length: width * height }, (_, index) => {
    const offset = index * 4;
    return Math.max(0, Math.min(1, (Math.hypot(
      pixels[offset]! - edge[0]!, pixels[offset + 1]! - edge[1]!, pixels[offset + 2]! - edge[2]!
    ) - 18) * 4.2 / 255));
  });
}

function subjectCenter(pixels: Uint8Array, width: number, height: number): readonly [number, number] {
  const matte = foregroundMatte(pixels, width, height);
  let weightedX = 0; let weightedY = 0; let weight = 0;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const value = matte[y * width + x]!;
    weightedX += x * value; weightedY += y * value; weight += value;
  }
  return weight < 1e-6 ? [0.5, 0.5] : [
    weightedX / weight / Math.max(1, width - 1),
    weightedY / weight / Math.max(1, height - 1)
  ];
}

function parseGpuNumber(value: string, label: string): number {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`NVIDIA ${label} is invalid.`);
  return parsed;
}

export function sampleNvidiaGpu(): Promise<NvidiaGpuSample> {
  return new Promise((resolveSample, rejectSample) => {
    execFile("nvidia-smi", [
      "--query-gpu=name,memory.used,memory.total,utilization.gpu",
      "--format=csv,noheader,nounits"
    ], {
      encoding: "utf8",
      timeout: GPU_QUERY_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 16 * 1024
    }, (error, stdout) => {
      if (error !== null) {
        rejectSample(new Error("NVIDIA GPU telemetry is unavailable."));
        return;
      }
      try {
        const devices = stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map((line) => {
          const columns = line.split(",").map((column) => column.trim());
          if (columns.length !== 4 || columns[0]!.length === 0) throw new Error("NVIDIA GPU output is invalid.");
          return {
            name: columns[0]!,
            memoryUsedMiB: parseGpuNumber(columns[1]!, "memory usage"),
            memoryTotalMiB: parseGpuNumber(columns[2]!, "memory total"),
            utilizationPercent: parseGpuNumber(columns[3]!, "utilization")
          };
        });
        if (devices.length === 0) throw new Error("No NVIDIA GPU was reported.");
        resolveSample(Object.freeze({
          name: devices.map((device) => device.name).join(" + "),
          memoryUsedMiB: devices.reduce((total, device) => total + device.memoryUsedMiB, 0),
          memoryTotalMiB: devices.reduce((total, device) => total + device.memoryTotalMiB, 0),
          utilizationPercent: Math.max(...devices.map((device) => device.utilizationPercent))
        }));
      } catch (cause) {
        rejectSample(cause);
      }
    });
  });
}

function outputMetadata(media: VerifiedStoredMedia, durationSeconds: number, fps: number) {
  if (media.asset.type !== "image" && media.asset.type !== "svg") {
    throw new TypeError("source_image requires an authorized image asset.");
  }
  const sourceWidth = safeNumber(media.asset.metadata.width, "Image width");
  const sourceHeight = safeNumber(media.asset.metadata.height, "Image height");
  if (!Number.isInteger(sourceWidth) || !Number.isInteger(sourceHeight)
    || sourceWidth > MAX_EFFECT_DIMENSION || sourceHeight > MAX_EFFECT_DIMENSION) {
    throw new RangeError("Image dimensions exceed the effect render limit.");
  }
  if (durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
    throw new RangeError("Video duration exceeds the effect render limit.");
  }
  // H.264 yuv420p requires even dimensions; trim at most one decoded edge pixel.
  const width = sourceWidth - sourceWidth % 2;
  const height = sourceHeight - sourceHeight % 2;
  if (width < 2 || height < 2) throw new RangeError("Video dimensions are too small to encode as MP4.");
  return {
    width,
    height,
    durationSeconds,
    fps,
    frameCount: Math.ceil(durationSeconds * fps),
    audio: false
  };
}

function preparedOutputMetadata(width: number, height: number, durationSeconds: number, fps: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2
    || width > MAX_EFFECT_DIMENSION || height > MAX_EFFECT_DIMENSION) {
    throw new RangeError("Video dimensions exceed the effect render limit.");
  }
  if (durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
    throw new RangeError("Video duration exceeds the effect render limit.");
  }
  const encodedWidth = width - width % 2;
  const encodedHeight = height - height % 2;
  return {
    width: encodedWidth,
    height: encodedHeight,
    durationSeconds,
    fps,
    frameCount: Math.ceil(durationSeconds * fps),
    audio: false
  };
}

function oneInputId(
  inputIds: Readonly<Record<string, string | readonly string[]>> | undefined,
  slotName: string
): string | undefined {
  const value = inputIds?.[slotName];
  return typeof value === "string" ? value : value?.[0];
}

function sourceDuration(media: VerifiedStoredMedia, slotName: string): number {
  if (media.asset.type !== "video") throw new TypeError(`${slotName} requires an authorized video asset.`);
  const duration = Number(media.asset.metadata.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new TypeError(`${slotName} requires finite positive video duration metadata.`);
  }
  return duration;
}

function safeFailureMessage(error: unknown): string {
  const value = error instanceof Error ? error.message : "Video rendering failed.";
  return value.replace(/[\r\n\t]+/g, " ").slice(0, 240);
}

function mayUsePreviewFallback(error: unknown): boolean {
  if (error instanceof TypeError || error instanceof RangeError) return true;
  if (typeof error !== "object" || error === null) return false;
  const value = error as { code?: unknown; name?: unknown };
  return value.code === "BATCH_06_ADAPTER_REQUIRED" || value.name === "Batch06AdapterRequiredError";
}

function authorizedInputFrameData(inputs: AuthorizedEffectInputs): Readonly<Record<string, Uint8Array>> {
  const frames: Record<string, Uint8Array> = {};
  for (const [slot, value] of Object.entries(inputs)) {
    const input = Array.isArray(value) ? value[0] : value;
    if (input === undefined || typeof input.binding !== "object" || input.binding === null) continue;
    const data = (input.binding as { readonly data?: unknown }).data;
    if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) {
      frames[slot] = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } else if (Array.isArray(data) && data.every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
      const normalized = data.every((entry) => entry >= 0 && entry <= 1);
      frames[slot] = Uint8Array.from(data, (entry) => Math.max(0, Math.min(255,
        Math.round(normalized ? entry * 255 : entry))));
    }
  }
  return Object.freeze(frames);
}

function selfCheckReferenceFrames(inputs: AuthorizedEffectInputs | undefined): Readonly<Record<string, Uint8Array>> {
  if (inputs === undefined) return Object.freeze({});
  const references: Record<string, Uint8Array> = {};
  for (const [slot, value] of Object.entries(inputs)) {
    const input = Array.isArray(value) ? value[0] : value;
    if (input === undefined || typeof input.binding !== "object" || input.binding === null) continue;
    const binding = input.binding as Record<string, unknown>;
    const surface = typeof binding.surface === "object" && binding.surface !== null
      ? binding.surface as Record<string, unknown> : undefined;
    const pixels = typeof binding.pixels === "object" && binding.pixels !== null
      ? binding.pixels as Record<string, unknown> : undefined;
    const data = binding.data ?? surface?.data ?? pixels?.data;
    if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) {
      references[slot] = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
  }
  return Object.freeze(references);
}

function finalVideoSelfCheckBaseline(
  toolName: FinalVideoSelfCheckToolName,
  sourcePixels: Uint8Array | undefined,
  inputs: AuthorizedEffectInputs | undefined,
  width: number,
  height: number
): Uint8Array {
  const expectedBytes = width * height * 4;
  if (sourcePixels?.byteLength === expectedBytes) return sourcePixels;
  const references = selfCheckReferenceFrames(inputs);
  const preferredSlots = toolName === "sacred_geometry"
    ? ["background_image", "source_image", "source_frame"]
    : ["source_image", "source_frame", "background_image"];
  for (const slot of preferredSlots) {
    const pixels = references[slot];
    if (pixels?.byteLength === expectedBytes) return pixels;
  }
  const black = new Uint8Array(expectedBytes);
  for (let offset = 3; offset < expectedBytes; offset += 4) black[offset] = 255;
  return black;
}

export class EffectToolVideoService {
  private readonly tasks = new Map<string, StoredVideoTask>();
  private queue: Promise<void> = Promise.resolve();
  private closing = false;
  private readonly outputRoot: string;
  private readonly exportFrames: typeof exportFixedFrames;
  private readonly decodeFrame: typeof decodeMediaFrame;
  private readonly durationSeconds: number;
  private readonly fps: number;
  private readonly gpuSampler: () => Promise<NvidiaGpuSample>;
  private readonly gpuSampleIntervalMs: number;
  private readonly wavePathSelfCheckRunner: typeof runWavePathSelfCheck;
  private readonly visualSelfCheckRunner: typeof runVisualEffectSelfCheck;
  private readonly listedToolSelfCheckRunner: typeof runListedToolSelfCheck;
  private readonly dedicatedSelfCheckRunners: Readonly<Record<DedicatedSelfCheckToolName, DedicatedSelfCheckRunner>>;
  private readonly finalVideoSelfCheckRunners: Readonly<Record<FinalVideoSelfCheckToolName, FinalVideoSelfCheckRunner>>;
  private readonly requestedSelfCheckRunner: RequestedSelfCheckRunner;

  constructor(private readonly options: EffectToolVideoServiceOptions) {
    this.outputRoot = resolve(options.outputRoot);
    this.exportFrames = options.exportFrames ?? exportFixedFrames;
    this.decodeFrame = options.decodeFrame ?? decodeMediaFrame;
    this.durationSeconds = safeNumber(options.durationSeconds ?? DEFAULT_VIDEO_DURATION_SECONDS, "Video duration");
    this.fps = safeNumber(options.fps ?? DEFAULT_VIDEO_FPS, "Video frame rate");
    this.gpuSampler = options.gpuSampler ?? sampleNvidiaGpu;
    this.gpuSampleIntervalMs = safeNumber(
      options.gpuSampleIntervalMs ?? DEFAULT_GPU_SAMPLE_INTERVAL_MS,
      "GPU sample interval"
    );
    this.wavePathSelfCheckRunner = options.wavePathSelfCheckRunner ?? runWavePathSelfCheck;
    this.visualSelfCheckRunner = options.visualSelfCheckRunner ?? runVisualEffectSelfCheck;
    this.listedToolSelfCheckRunner = options.listedToolSelfCheckRunner ?? runListedToolSelfCheck;
    this.dedicatedSelfCheckRunners = Object.freeze({
      ...DEFAULT_DEDICATED_SELF_CHECK_RUNNERS,
      ...options.dedicatedSelfCheckRunners
    });
    this.finalVideoSelfCheckRunners = Object.freeze({
      ...DEFAULT_FINAL_VIDEO_SELF_CHECK_RUNNERS,
      ...options.finalVideoSelfCheckRunners
    });
    this.requestedSelfCheckRunner = options.requestedSelfCheckRunner ?? runRequestedSelfCheck;
    if (this.durationSeconds > MAX_VIDEO_DURATION_SECONDS || !Number.isInteger(this.fps) || this.fps > 120) {
      throw new RangeError("Video output settings exceed the effect render limit.");
    }
  }

  async create(
    owner: OwnerContext,
    sourceAssetId: string,
    definition: EffectToolDefinition,
    envelope: EffectParameterEnvelope,
    seed: number,
    durationSeconds = this.durationSeconds,
    fps = this.fps,
    selfCheckPrompt?: string
  ): Promise<EffectToolVideoExecutionView> {
    if (this.closing) throw new Error("Effect video service is closing.");
    safeNumber(durationSeconds, "Video duration");
    if (durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
      throw new RangeError("Video duration exceeds the effect render limit.");
    }
    safeNumber(fps, "Video frame rate");
    if (!Number.isInteger(fps) || fps > 120) throw new RangeError("Video frame rate exceeds the render limit.");
    const media = await this.options.media.resolve(owner, sourceAssetId);
    const metadata = outputMetadata(media, durationSeconds, fps);
    const id = randomUUID();
    const directory = join(this.outputRoot, id);
    const outputPath = join(directory, "output.mp4");
    const now = new Date().toISOString();
    const task: StoredVideoTask = {
      owner: { ...owner },
      sourceAssetIds: Object.freeze([sourceAssetId]),
      outputPath,
      controller: new AbortController(),
      ...(requestedSelfCheckTool(definition.toolName) && selfCheckPrompt !== undefined
        ? { selfCheckPrompt: selfCheckPrompt.slice(0, 4_000) } : {}),
      selfCheckEvidenceFiles: new Map(),
      view: {
        id,
        status: "queued",
        toolName: definition.toolName,
        createdAt: now,
        updatedAt: now,
        source: { kind: "image", assetId: sourceAssetId },
        video: {
          format: "mp4",
          mime: "video/mp4",
          ...metadata,
          completedFrames: 0,
          progress: 0
        },
        gpu: { available: false, message: "等待视频任务开始后采样。" },
        ...(requestedSelfCheckTool(definition.toolName)
          ? { selfCheck: queuedRequestedSelfCheck(definition.toolName) }
          : finalVideoSelfCheckTool(definition.toolName)
          ? { selfCheck: queuedFinalVideoSelfCheck(definition.toolName) }
          : observableSelfCheckHandler(definition.toolName) === undefined ? {}
            : { selfCheck: queuedObservableSelfCheck(definition.toolName as ObservableSelfCheckToolName) })
      }
    };
    this.tasks.set(taskKey(owner, id), task);
    this.queue = this.queue.then(() => this.run(task, media, definition, envelope, seed), () => this.run(task, media, definition, envelope, seed));
    return structuredClone(task.view);
  }

  async createPrepared(
    owner: OwnerContext,
    definition: EffectToolDefinition,
    envelope: EffectParameterEnvelope,
    inputs: AuthorizedEffectInputs,
    sourceAssetIds: readonly string[],
    seed: number,
    durationSeconds = this.durationSeconds,
    width = 640,
    height = 360,
    sourceImageId?: string,
    fps = this.fps,
    inputIds?: Readonly<Record<string, string | readonly string[]>>,
    adaptToSourceDuration = false,
    selfCheckPrompt?: string
  ): Promise<EffectToolVideoExecutionView> {
    if (this.closing) throw new Error("Effect video service is closing.");
    safeNumber(durationSeconds, "Video duration");
    safeNumber(fps, "Video frame rate");
    if (!Number.isInteger(fps) || fps > 120) throw new RangeError("Video frame rate exceeds the render limit.");
    let effectiveDuration = durationSeconds;
    if (adaptToSourceDuration && definition.toolName === "video_freeze_frame") {
      const sourceId = oneInputId(inputIds, "source_video");
      if (sourceId === undefined) throw new TypeError("source_video is required for adaptive freeze duration.");
      const source = await this.options.media.resolve(owner, sourceId);
      effectiveDuration = sourceDuration(source, "source_video") + Number(envelope.data.freezeDuration ?? 1.5);
    } else if (adaptToSourceDuration && definition.toolName === "zoom_tunnel") {
      const fromId = oneInputId(inputIds, "from_video");
      const toId = oneInputId(inputIds, "to_video");
      if (fromId === undefined || toId === undefined) {
        throw new TypeError("from_video and to_video are required for adaptive transition duration.");
      }
      const [fromMedia, toMedia] = await Promise.all([
        this.options.media.resolve(owner, fromId),
        this.options.media.resolve(owner, toId)
      ]);
      sourceDuration(fromMedia, "from_video");
      const incomingDuration = sourceDuration(toMedia, "to_video");
      const transitionStart = Number(envelope.data.transitionStart ?? 1);
      const transitionDuration = Number(envelope.data.duration ?? 0.9);
      effectiveDuration = transitionStart + Math.max(incomingDuration, transitionDuration);
    }
    safeNumber(effectiveDuration, "Video duration");
    effectiveDuration = Math.ceil(effectiveDuration * fps) / fps;
    const metadata = preparedOutputMetadata(width, height, effectiveDuration, fps);
    const id = randomUUID();
    const directory = join(this.outputRoot, id);
    const outputPath = join(directory, "output.mp4");
    const now = new Date().toISOString();
    const task: StoredVideoTask = {
      owner: { ...owner },
      sourceAssetIds: Object.freeze([...sourceAssetIds]),
      outputPath,
      controller: new AbortController(),
      ...((definition.toolName === "wave_path" || hasObservedMotionSelfCheck(definition.toolName)
        || finalVideoSelfCheckTool(definition.toolName)
        || requestedSelfCheckTool(definition.toolName)
        || dedicatedSelfCheckTool(definition.toolName)
        || isVisualSelfCheckTool(definition.toolName)
        || isListedSelfCheckTool(definition.toolName) || observableSelfCheckHandler(definition.toolName) !== undefined)
        && selfCheckPrompt !== undefined
        ? { selfCheckPrompt: selfCheckPrompt.slice(0, 4_000) } : {}),
      selfCheckEvidenceFiles: new Map(),
      prepared: Object.freeze({ inputs, width: metadata.width, height: metadata.height, ...(inputIds === undefined ? {} : { inputIds }) }),
      view: {
        id,
        status: "queued",
        toolName: definition.toolName,
        createdAt: now,
        updatedAt: now,
        ...(sourceImageId === undefined ? {} : {
          source: { kind: "image" as const, assetId: sourceImageId }
        }),
        video: {
          format: "mp4",
          mime: "video/mp4",
          ...metadata,
          completedFrames: 0,
          progress: 0
        },
        gpu: { available: false, message: "等待视频任务开始后采样。" },
        ...(definition.toolName === "wave_path" ? { selfCheck: queuedWavePathSelfCheck() }
          : requestedSelfCheckTool(definition.toolName)
            ? { selfCheck: queuedRequestedSelfCheck(definition.toolName) }
          : selfCheckPrompt !== undefined && hasObservedMotionSelfCheck(definition.toolName)
            ? { selfCheck: queuedObservedMotionSelfCheck(definition.toolName) }
          : finalVideoSelfCheckTool(definition.toolName)
            ? { selfCheck: queuedFinalVideoSelfCheck(definition.toolName) }
          : dedicatedSelfCheckTool(definition.toolName)
            ? { selfCheck: queuedDedicatedSelfCheck(definition.toolName) }
          : isVisualSelfCheckTool(definition.toolName)
            ? { selfCheck: queuedVisualEffectSelfCheck(definition.toolName) }
            : isListedSelfCheckTool(definition.toolName)
              ? { selfCheck: queuedListedToolSelfCheck(definition.toolName) }
              : observableSelfCheckHandler(definition.toolName) !== undefined
                ? { selfCheck: queuedObservableSelfCheck(definition.toolName as ObservableSelfCheckToolName) } : {})
      }
    };
    this.tasks.set(taskKey(owner, id), task);
    this.queue = this.queue.then(
      () => this.run(task, undefined, definition, envelope, seed),
      () => this.run(task, undefined, definition, envelope, seed)
    );
    return structuredClone(task.view);
  }

  get(owner: OwnerContext, id: string): EffectToolVideoExecutionView {
    const task = this.tasks.get(taskKey(owner, id));
    if (task === undefined) throw new Error("Task not found or access denied.");
    return structuredClone(task.view);
  }

  usesAsset(owner: OwnerContext, assetId: string): boolean {
    return [...this.tasks.values()].some((task) => task.owner.tenantId === owner.tenantId
      && task.owner.userId === owner.userId && task.sourceAssetIds.includes(assetId)
      && (task.view.status === "queued" || task.view.status === "running"));
  }

  async open(owner: OwnerContext, id: string, range?: { start: number; end: number }): Promise<EffectToolVideoFile> {
    const task = this.tasks.get(taskKey(owner, id));
    if (task === undefined || task.view.status !== "completed" || task.view.video.bytes === undefined
      || task.view.video.downloadName === undefined) {
      throw new Error("Task not found or access denied.");
    }
    const handle = await open(task.outputPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const info = await handle.stat();
    if (!info.isFile() || info.size !== task.view.video.bytes) {
      await handle.close();
      throw new Error("Task not found or access denied.");
    }
    const stream = handle.createReadStream({
      autoClose: true,
      ...(range === undefined ? {} : { start: range.start, end: range.end })
    });
    return {
      stream,
      bytes: info.size,
      name: task.view.video.downloadName,
      close: async () => {
        if (!stream.closed) {
          const closed = new Promise<void>((resolveClose) => stream.once("close", resolveClose));
          stream.destroy();
          await closed;
        }
      }
    };
  }

  async openSelfCheckEvidence(
    owner: OwnerContext,
    id: string,
    evidenceId: string
  ): Promise<EffectToolEvidenceFile> {
    if (!/^[a-z][a-z0-9_]{2,63}$/u.test(evidenceId)) {
      throw new Error("Task not found or access denied.");
    }
    const task = this.tasks.get(taskKey(owner, id));
    const evidencePath = task?.selfCheckEvidenceFiles.get(evidenceId);
    const evidence = task?.view.selfCheck?.evidenceImages.find((item) => item.evidenceId === evidenceId);
    if (task === undefined || task.view.status !== "completed"
      || task.view.selfCheck?.evidenceStatus !== "sufficient"
      || evidencePath === undefined || evidence === undefined) {
      throw new Error("Task not found or access denied.");
    }
    const handle = await open(evidencePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const info = await handle.stat();
    if (!info.isFile()) {
      await handle.close();
      throw new Error("Task not found or access denied.");
    }
    const stream = handle.createReadStream({ autoClose: true });
    return {
      stream,
      bytes: info.size,
      name: `${evidenceId}.png`,
      mime: evidence.mime,
      close: async () => {
        if (!stream.closed) {
          const closed = new Promise<void>((resolveClose) => stream.once("close", resolveClose));
          stream.destroy();
          await closed;
        }
      }
    };
  }

  async close(): Promise<void> {
    this.closing = true;
    for (const task of this.tasks.values()) task.controller.abort();
    await this.queue.catch(() => undefined);
  }

  private startGpuSampling(task: StoredVideoTask): () => void {
    let stopped = false;
    let inFlight = false;
    let unavailableLogged = false;
    const collect = async (): Promise<void> => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const sample = await this.gpuSampler();
        if (stopped) return;
        const sampledAt = new Date().toISOString();
        const peakMemoryUsedMiB = Math.max(task.view.gpu.peakMemoryUsedMiB ?? 0, sample.memoryUsedMiB);
        task.view = Object.freeze({
          ...task.view,
          updatedAt: sampledAt,
          gpu: Object.freeze({
            available: true,
            ...sample,
            peakMemoryUsedMiB,
            sampledAt
          })
        });
        console.info(
          `[AE Agent GPU] task=${task.view.id} used=${sample.memoryUsedMiB}MiB `
          + `peak=${peakMemoryUsedMiB}MiB total=${sample.memoryTotalMiB}MiB utilization=${sample.utilizationPercent}%`
        );
      } catch {
        if (stopped) return;
        const sampledAt = new Date().toISOString();
        const previous = task.view.gpu;
        task.view = Object.freeze({
          ...task.view,
          updatedAt: sampledAt,
          gpu: previous.available ? previous : Object.freeze({
            available: false,
            sampledAt,
            message: "无法读取 NVIDIA 显存信息。"
          })
        });
        if (!unavailableLogged) {
          console.info(`[AE Agent GPU] task=${task.view.id} telemetry=unavailable`);
          unavailableLogged = true;
        }
      } finally {
        inFlight = false;
      }
    };
    void collect();
    const timer = setInterval(() => void collect(), this.gpuSampleIntervalMs);
    timer.unref();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  private async run(
    task: StoredVideoTask,
    initialMedia: VerifiedStoredMedia | undefined,
    definition: EffectToolDefinition,
    envelope: EffectParameterEnvelope,
    seed: number
  ): Promise<void> {
    if (this.closing || task.controller.signal.aborted) return;
    const update = (view: EffectToolVideoExecutionView): void => { task.view = Object.freeze(view); };
    update({ ...task.view, status: "running", updatedAt: new Date().toISOString() });
    const stopGpuSampling = this.startGpuSampling(task);
    try {
      await mkdir(join(this.outputRoot, task.view.id), { recursive: true });
      let metadata = preparedOutputMetadata(
        task.prepared?.width ?? task.view.video.width,
        task.prepared?.height ?? task.view.video.height,
        task.view.video.durationSeconds,
        task.view.video.fps
      );
      let sourcePixels: Uint8Array | undefined;
      const preparedMedia = new Map<string, VerifiedStoredMedia>();
      const historicalFrameCache = new Map<string, Uint8Array>();
      let historicalFrameCacheBytes = 0;
      const cachedFrame = (key: string): Uint8Array | undefined => {
        const pixels = historicalFrameCache.get(key);
        if (pixels === undefined) return undefined;
        historicalFrameCache.delete(key);
        historicalFrameCache.set(key, pixels);
        return pixels;
      };
      const cacheFrame = (key: string, pixels: Uint8Array): void => {
        const existing = historicalFrameCache.get(key);
        if (existing !== undefined) historicalFrameCacheBytes -= existing.byteLength;
        historicalFrameCache.delete(key);
        historicalFrameCache.set(key, pixels);
        historicalFrameCacheBytes += pixels.byteLength;
        while (historicalFrameCacheBytes > MAX_HISTORY_FRAME_CACHE_BYTES) {
          const oldestKey = historicalFrameCache.keys().next().value as string | undefined;
          if (oldestKey === undefined || oldestKey === key && historicalFrameCache.size === 1) break;
          const oldest = historicalFrameCache.get(oldestKey)!;
          historicalFrameCache.delete(oldestKey);
          historicalFrameCacheBytes -= oldest.byteLength;
        }
      };
      if (task.prepared === undefined) {
        if (initialMedia === undefined || task.sourceAssetIds.length !== 1) {
          throw new Error("The source image binding is unavailable.");
        }
        const media = await this.options.media.resolve(task.owner, task.sourceAssetIds[0]!, task.controller.signal);
        if (media.asset.hash !== initialMedia.asset.hash || media.trustedBytes !== initialMedia.trustedBytes) {
          throw new Error("The source image changed before rendering.");
        }
        metadata = outputMetadata(media, task.view.video.durationSeconds, task.view.video.fps);
        sourcePixels = await this.decodeFrame(media, {
          frame: 0,
          time: 0,
          deltaTime: 1 / metadata.fps,
          fps: metadata.fps,
          width: metadata.width,
          height: metadata.height
        }, { signal: task.controller.signal });
      } else if (task.view.source !== undefined) {
        const media = await this.options.media.resolve(
          task.owner,
          task.view.source.assetId,
          task.controller.signal
        );
        const videoInImageSlot = ["live_binding", "particle_emitter", "particle_flow_field", "particle_orbit_field",
          "particle_snow_rain", "particle_spark", "particle_trail", "object_match_cut"].includes(definition.toolName);
        if (media.asset.type !== "image" && media.asset.type !== "svg"
          && !(videoInImageSlot && media.asset.type === "video")) {
          throw new TypeError("The preview source must remain an authorized image.");
        }
        if (media.asset.type !== "video") {
          sourcePixels = await this.decodeFrame(media, {
            frame: 0,
            time: 0,
            deltaTime: 1 / metadata.fps,
            fps: metadata.fps,
            width: metadata.width,
            height: metadata.height
          }, { signal: task.controller.signal });
        }
      }
      const preset = validateExportPreset({
        id: "ae-agent-mp4",
        name: "AE Agent MP4",
        format: "mp4",
        quality: "final",
        settings: {
          width: metadata.width,
          height: metadata.height,
          fps: metadata.fps,
          alpha: false,
          audio: false,
          videoCodec: "libx264",
          crf: 18
        }
      });
      const samplingPlan = definition.toolName === "wave_path"
        ? wavePathSamplingPlan(metadata.durationSeconds, metadata.fps, envelope.data)
        : Object.freeze([]);
      const samplingByFrame = new Map(samplingPlan.map((item) => [item.frame, item]));
      const wavePathSnapshots: WavePathRenderSnapshot[] = [];
      const observableHandler = observableSelfCheckHandler(definition.toolName);
      const observableObservations: ObservableFrameObservation[] = [];
      const observableStride = Math.max(1, Math.ceil(metadata.frameCount / 900));
      await this.exportFrames({
        preset,
        duration: metadata.durationSeconds,
        outputPath: task.outputPath,
        ...(this.options.ffmpegPath === undefined ? {} : { ffmpegPath: this.options.ffmpegPath }),
        signal: task.controller.signal,
        renderFrame: async (request, signal) => {
          let frameInputs = task.prepared?.inputs;
          let frameSource = sourcePixels;
          const supplementalFrames: Record<string, Uint8Array> = {};
          if (task.prepared?.inputIds !== undefined) {
            const mutableInputs: Record<string, AuthorizedEffectInputs[string]> = { ...task.prepared.inputs };
            for (const slot of definition.inputSlots.filter((item) => item.kind === "video"
              || definition.toolName === "glass" && item.name === "source_image"
              || ["live_binding", "particle_emitter", "particle_flow_field", "particle_orbit_field",
                "particle_snow_rain", "particle_spark", "particle_trail"].includes(definition.toolName)
                && item.kind === "image"
              || definition.toolName === "mask_reveal"
                && (item.name === "source_frame" || item.name === "target_frame"))) {
              const rawId = task.prepared.inputIds[slot.name];
              const assetId = typeof rawId === "string" ? rawId : rawId?.[0];
              if (assetId === undefined) continue;
              let media = preparedMedia.get(assetId);
              if (media === undefined) {
                media = await this.options.media.resolve(task.owner, assetId, signal);
                const staticForeground = definition.toolName === "background_remove_compose"
                  && slot.name === "foreground_video"
                  && (media.asset.type === "image" || media.asset.type === "svg");
                if (media.asset.type !== "video"
                  && !staticForeground
                  && definition.toolName !== "glass" && definition.toolName !== "mask_reveal"
                  && !["live_binding", "particle_emitter", "particle_flow_field", "particle_orbit_field",
                    "particle_snow_rain", "particle_spark", "particle_trail"].includes(definition.toolName)) {
                  throw new TypeError(`${slot.name} requires an authorized video asset.`);
                }
                preparedMedia.set(assetId, media);
              }
              if (media.asset.type !== "video") continue;
              const params = envelope.data as Readonly<Record<string, unknown>>;
              let sampleTime = request.time;
              if (definition.toolName === "video_freeze_frame") {
                const freezeAt = Number(params.freezeAt ?? 2);
                const freezeDuration = Number(params.freezeDuration ?? 1.5);
                sampleTime = request.time < freezeAt ? request.time
                  : request.time < freezeAt + freezeDuration ? freezeAt : request.time - freezeDuration;
              } else if (definition.toolName === "zoom_tunnel" && slot.name === "to_video") {
                sampleTime = Math.max(0, request.time - Number(params.transitionStart ?? 1));
              } else if (definition.toolName === "speed_ramp") {
                sampleTime = speedRampSourceTime(request.time, params);
              }
              const duration = Number(media.asset.metadata.duration ?? 0);
              if (duration > 0) sampleTime = Math.min(Math.max(0, duration - 1 / request.fps), sampleTime);
              const pixels = await this.decodeFrame(media, { ...request, time: sampleTime, frame: Math.floor(sampleTime * request.fps) },
                signal === undefined ? {} : { signal });
              const currentFrameNumber = Math.floor(sampleTime * request.fps);
              cacheFrame(`${assetId}:${currentFrameNumber}`, pixels);
              if (definition.toolName === "echo_trail" && slot.name === "source_video") {
                const trailCount = Math.max(2, Math.min(32, Math.trunc(Number(params.trailCount ?? 10))));
                const spacing = Math.max(1 / request.fps, Math.min(2, Number(params.spacing ?? 0.12)));
                for (let historyIndex = 1; historyIndex <= trailCount; historyIndex += 1) {
                  const historyTime = request.time - historyIndex * spacing;
                  if (historyTime < 0) continue;
                  const historyFrameNumber = Math.floor(historyTime * request.fps);
                  const cacheKey = `${assetId}:${historyFrameNumber}`;
                  let historyPixels = cachedFrame(cacheKey);
                  if (historyPixels === undefined) {
                    historyPixels = await this.decodeFrame(media, {
                      ...request,
                      time: historyFrameNumber / request.fps,
                      frame: historyFrameNumber
                    }, signal === undefined ? {} : { signal });
                    cacheFrame(cacheKey, historyPixels);
                  }
                  supplementalFrames[`echo_history_${historyIndex}`] = historyPixels;
                }
              }
              const original = task.prepared.inputs[slot.name];
              const authorized = Array.isArray(original) ? original[0] : original;
              if (authorized !== undefined) {
                mutableInputs[slot.name] = Object.freeze({
                  ...authorized,
                  binding: { version: "rgba8-frame-v1", width: request.width, height: request.height, data: pixels }
                });
                if (definition.toolName === "background_remove_compose" && slot.name === "foreground_video") {
                  const matteInput = task.prepared.inputs.foreground_matte;
                  const matteAuthorized = Array.isArray(matteInput) ? matteInput[0] : matteInput;
                  if (matteAuthorized !== undefined) {
                    const values = foregroundMatte(pixels, request.width, request.height);
                    mutableInputs.foreground_matte = Object.freeze({
                      ...matteAuthorized,
                      binding: { width: request.width, height: request.height, data: values, values }
                    });
                  }
                }
                if (definition.toolName === "smart_crop_animate" && slot.name === "source_video") {
                  const tracksInput = task.prepared.inputs.subject_tracks;
                  const tracksAuthorized = Array.isArray(tracksInput) ? tracksInput[0] : tracksInput;
                  if (tracksAuthorized !== undefined) {
                    const [centerX, centerY] = subjectCenter(pixels, request.width, request.height);
                    mutableInputs.subject_tracks = Object.freeze({
                      ...tracksAuthorized,
                      binding: { subjects: [{ samples: [{
                        time: request.time, centerX, centerY, width: 0.28, height: 0.46
                      }] }] }
                    });
                  }
                }
                frameSource = pixels;
              }
            }
            frameInputs = Object.freeze(mutableInputs);
          }
          const context: ServerEffectRenderContext = {
            environment: "server",
            requestId: `${task.view.id}:${request.frame}`,
            tenantId: task.owner.tenantId,
            userId: task.owner.userId,
            time: request.time,
            deltaTime: request.deltaTime,
            frame: request.frame,
            fps: request.fps,
            width: request.width,
            height: request.height,
            seed,
            quality: "final",
            backend: definition.primaryBackend,
            inputs: frameInputs ?? {
              source_frame: {
                slot: "source_frame",
                kind: "image",
                tenantId: task.owner.tenantId,
                userId: task.owner.userId,
                locked: true,
                binding: { width: request.width, height: request.height, data: sourcePixels! }
              }
            },
            ...(signal === undefined ? {} : { signal })
          };
          let result: EffectRenderResult | undefined;
          try {
            result = await executeSelectedEffectTool(definition, definition.toolName, envelope, context);
          } catch (error) {
            if (!mayUsePreviewFallback(error)) throw error;
          }
          const samplingItem = samplingByFrame.get(request.frame);
          if (samplingItem !== undefined) {
            const snapshot = captureWavePathSnapshot(result, samplingItem);
            if (snapshot !== undefined) wavePathSnapshots.push(snapshot);
          }
          if (observableHandler !== undefined
            && (request.frame % observableStride === 0 || request.frame === metadata.frameCount - 1)) {
            const observation = observableHandler.definition.capture(
              result, request.frame, request.time, request.width, request.height
            );
            if (observation !== undefined) observableObservations.push(observation);
          }
          const completedFrames = request.frame + 1;
          update({
            ...task.view,
            updatedAt: new Date().toISOString(),
            video: {
              ...task.view.video,
              completedFrames,
              progress: Math.min(1, completedFrames / metadata.frameCount)
            }
          });
          const resolvedInputFrames = frameInputs === undefined
            ? supplementalFrames
            : { ...authorizedInputFrameData(frameInputs), ...supplementalFrames };
          return composeEffectToolFrame(
            result,
            request,
            definition.toolName,
            frameSource,
            Object.keys(resolvedInputFrames).length === 0 ? undefined : Object.freeze(resolvedInputFrames)
          );
        }
      });
      const bytes = (await stat(task.outputPath)).size;
      const completedVideo = Object.freeze({
        ...task.view.video,
        completedFrames: metadata.frameCount,
        progress: 1,
        bytes,
        downloadName: `ae-agent-${definition.toolName}-${task.view.id}.mp4`
      });
      if (definition.toolName === "wave_path") {
        update({
          ...task.view,
          updatedAt: new Date().toISOString(),
          video: completedVideo,
          selfCheck: Object.freeze({ ...queuedWavePathSelfCheck(), status: "running" as const })
        });
        if (sourcePixels === undefined) throw new Error("wave_path self-check requires its authorized source pixels.");
        const baselinePixels = sourcePixels;
        const baselineVideoPath = join(this.outputRoot, task.view.id, "self-check-codec-baseline.mp4");
        await this.exportFrames({
          preset,
          duration: metadata.durationSeconds,
          outputPath: baselineVideoPath,
          ...(this.options.ffmpegPath === undefined ? {} : { ffmpegPath: this.options.ffmpegPath }),
          signal: task.controller.signal,
          renderFrame: async () => baselinePixels
        });
        const artifacts = await this.wavePathSelfCheckRunner({
          requestId: task.view.id,
          tenantId: task.owner.tenantId,
          userId: task.owner.userId,
          userRequest: task.selfCheckPrompt ?? "",
          envelope,
          videoPath: task.outputPath,
          fileName: completedVideo.downloadName,
          baselineVideoPath,
          outputDirectory: join(this.outputRoot, task.view.id),
          width: metadata.width,
          height: metadata.height,
          fps: metadata.fps,
          durationSeconds: metadata.durationSeconds,
          frameCount: metadata.frameCount,
          bytes,
          backendId: definition.primaryBackend.backendId,
          snapshots: Object.freeze([...wavePathSnapshots].sort((a, b) => a.frame - b.frame)),
          ...(this.options.wavePathSelfCheckReviewer === undefined
            ? {} : { reviewer: this.options.wavePathSelfCheckReviewer }),
          ...(this.options.ffmpegPath === undefined ? {} : { ffmpegPath: this.options.ffmpegPath }),
          signal: task.controller.signal
        });
        for (const [evidenceId, evidencePath] of artifacts.evidenceFiles) {
          task.selfCheckEvidenceFiles.set(evidenceId, evidencePath);
        }
        update({
          ...task.view,
          status: "completed",
          updatedAt: new Date().toISOString(),
          video: completedVideo,
          selfCheck: artifacts.view
        });
        return;
      }
      if (requestedSelfCheckTool(definition.toolName)) {
        update({
          ...task.view,
          updatedAt: new Date().toISOString(),
          video: completedVideo,
          selfCheck: Object.freeze({ ...queuedRequestedSelfCheck(definition.toolName), status: "running" as const })
        });
        const expectedBytes = metadata.width * metadata.height * 4;
        const referenceFrames = selfCheckReferenceFrames(task.prepared?.inputs);
        const preferredSlots = definition.toolName === "texture_overlay" ? ["base_image", "source_image", "source_frame"]
          : ["source_image", "source_frame", "base_image"];
        const baselinePixels = sourcePixels?.byteLength === expectedBytes ? sourcePixels
          : preferredSlots.map((slot) => referenceFrames[slot]).find((pixels) => pixels?.byteLength === expectedBytes);
        if (baselinePixels === undefined) throw new Error(`${definition.toolName} self-check requires authorized source pixels.`);
        const baselineVideoPath = join(this.outputRoot, task.view.id, `${definition.toolName}-self-check-baseline.mp4`);
        await this.exportFrames({
          preset,
          duration: metadata.durationSeconds,
          outputPath: baselineVideoPath,
          ...(this.options.ffmpegPath === undefined ? {} : { ffmpegPath: this.options.ffmpegPath }),
          signal: task.controller.signal,
          renderFrame: async () => baselinePixels
        });
        const artifacts = await this.requestedSelfCheckRunner(definition.toolName, {
          requestId: task.view.id,
          tenantId: task.owner.tenantId,
          userId: task.owner.userId,
          userRequest: task.selfCheckPrompt ?? "",
          videoPath: task.outputPath,
          fileName: completedVideo.downloadName,
          baselineVideoPath,
          outputDirectory: join(this.outputRoot, task.view.id),
          width: metadata.width,
          height: metadata.height,
          fps: metadata.fps,
          durationSeconds: metadata.durationSeconds,
          frameCount: metadata.frameCount,
          bytes,
          ...(this.options.requestedSelfCheckApiKey === undefined
            ? {} : { apiKey: this.options.requestedSelfCheckApiKey }),
          ...(this.options.requestedSelfCheckFetchImpl === undefined
            ? {} : { fetchImpl: this.options.requestedSelfCheckFetchImpl }),
          ...(this.options.ffmpegPath === undefined ? {} : { ffmpegPath: this.options.ffmpegPath }),
          signal: task.controller.signal
        });
        for (const [evidenceId, evidencePath] of artifacts.evidenceFiles) {
          task.selfCheckEvidenceFiles.set(evidenceId, evidencePath);
        }
        update({
          ...task.view,
          status: "completed",
          updatedAt: new Date().toISOString(),
          video: completedVideo,
          selfCheck: artifacts.view
        });
        return;
      }
      if (task.prepared !== undefined && task.selfCheckPrompt !== undefined
        && hasObservedMotionSelfCheck(definition.toolName)) {
        update({
          ...task.view,
          updatedAt: new Date().toISOString(),
          video: completedVideo,
          selfCheck: Object.freeze({
            ...queuedObservedMotionSelfCheck(definition.toolName),
            status: "running" as const
          })
        });
        const artifacts = await OBSERVED_MOTION_SELF_CHECK_RUNNERS[definition.toolName]({
          requestId: task.view.id,
          tenantId: task.owner.tenantId,
          userId: task.owner.userId,
          userRequest: task.selfCheckPrompt ?? "",
          videoPath: task.outputPath,
          fileName: completedVideo.downloadName,
          outputDirectory: join(this.outputRoot, task.view.id),
          width: metadata.width,
          height: metadata.height,
          fps: metadata.fps,
          durationSeconds: metadata.durationSeconds,
          frameCount: metadata.frameCount,
          bytes,
          ...(this.options.observedMotionSelfCheckReviewer === undefined
            ? {} : { reviewer: this.options.observedMotionSelfCheckReviewer }),
          ...(this.options.ffmpegPath === undefined ? {} : { ffmpegPath: this.options.ffmpegPath }),
          signal: task.controller.signal
        });
        for (const [evidenceId, evidencePath] of artifacts.evidenceFiles) {
          task.selfCheckEvidenceFiles.set(evidenceId, evidencePath);
        }
        update({
          ...task.view,
          status: "completed",
          updatedAt: new Date().toISOString(),
          video: completedVideo,
          selfCheck: artifacts.view
        });
        return;
      }
      if (finalVideoSelfCheckTool(definition.toolName)) {
        update({
          ...task.view,
          updatedAt: new Date().toISOString(),
          video: completedVideo,
          selfCheck: Object.freeze({ ...queuedFinalVideoSelfCheck(definition.toolName), status: "running" as const })
        });
        const baselineVideoPath = join(this.outputRoot, task.view.id, `${definition.toolName}-self-check-baseline.mp4`);
        const baselinePixels = finalVideoSelfCheckBaseline(
          definition.toolName,
          sourcePixels,
          task.prepared?.inputs,
          metadata.width,
          metadata.height
        );
        await this.exportFrames({
          preset,
          duration: metadata.durationSeconds,
          outputPath: baselineVideoPath,
          ...(this.options.ffmpegPath === undefined ? {} : { ffmpegPath: this.options.ffmpegPath }),
          signal: task.controller.signal,
          renderFrame: async () => baselinePixels
        });
        const artifacts = await this.finalVideoSelfCheckRunners[definition.toolName]({
          userRequest: task.selfCheckPrompt ?? "",
          envelope,
          videoPath: task.outputPath,
          fileName: completedVideo.downloadName,
          baselineVideoPath,
          outputDirectory: join(this.outputRoot, task.view.id),
          width: metadata.width,
          height: metadata.height,
          fps: metadata.fps,
          durationSeconds: metadata.durationSeconds,
          frameCount: metadata.frameCount,
          bytes,
          ...(this.options.ffmpegPath === undefined ? {} : { ffmpegPath: this.options.ffmpegPath }),
          signal: task.controller.signal
        });
        for (const [evidenceId, evidencePath] of artifacts.evidenceFiles) {
          task.selfCheckEvidenceFiles.set(evidenceId, evidencePath);
        }
        update({
          ...task.view,
          status: "completed",
          updatedAt: new Date().toISOString(),
          video: completedVideo,
          selfCheck: artifacts.view
        });
        return;
      }
      if (dedicatedSelfCheckTool(definition.toolName)) {
        update({
          ...task.view,
          updatedAt: new Date().toISOString(),
          video: completedVideo,
          selfCheck: Object.freeze({
            ...queuedDedicatedSelfCheck(definition.toolName),
            status: "running" as const
          })
        });
        const artifacts = await this.dedicatedSelfCheckRunners[definition.toolName]({
          requestId: task.view.id,
          tenantId: task.owner.tenantId,
          userId: task.owner.userId,
          userRequest: task.selfCheckPrompt ?? "",
          envelope,
          videoPath: task.outputPath,
          fileName: completedVideo.downloadName,
          outputDirectory: join(this.outputRoot, task.view.id),
          width: metadata.width,
          height: metadata.height,
          fps: metadata.fps,
          durationSeconds: metadata.durationSeconds,
          frameCount: metadata.frameCount,
          bytes,
          references: selfCheckReferenceFrames(task.prepared?.inputs),
          ...(this.options.dedicatedSelfCheckReviewer === undefined
            ? {} : { reviewer: this.options.dedicatedSelfCheckReviewer }),
          ...(this.options.ffmpegPath === undefined ? {} : { ffmpegPath: this.options.ffmpegPath }),
          signal: task.controller.signal
        });
        for (const [evidenceId, evidencePath] of artifacts.evidenceFiles) {
          task.selfCheckEvidenceFiles.set(evidenceId, evidencePath);
        }
        update({
          ...task.view,
          status: "completed",
          updatedAt: new Date().toISOString(),
          video: completedVideo,
          selfCheck: artifacts.view
        });
        return;
      }
      if (observableHandler !== undefined) {
        update({
          ...task.view,
          updatedAt: new Date().toISOString(),
          video: completedVideo,
          selfCheck: Object.freeze({
            ...queuedObservableSelfCheck(observableHandler.definition.toolName),
            status: "running" as const
          })
        });
        const artifacts = await observableHandler.run({
          requestId: task.view.id,
          tenantId: task.owner.tenantId,
          userId: task.owner.userId,
          userRequest: task.selfCheckPrompt ?? "",
          videoPath: task.outputPath,
          fileName: completedVideo.downloadName,
          outputDirectory: join(this.outputRoot, task.view.id),
          width: metadata.width,
          height: metadata.height,
          fps: metadata.fps,
          durationSeconds: metadata.durationSeconds,
          frameCount: metadata.frameCount,
          bytes,
          observations: Object.freeze([...observableObservations].sort((a, b) => a.frame - b.frame)),
          ...(this.options.observableSelfCheckReviewer === undefined
            ? {} : { reviewer: this.options.observableSelfCheckReviewer }),
          ...(this.options.ffmpegPath === undefined ? {} : { ffmpegPath: this.options.ffmpegPath }),
          signal: task.controller.signal
        });
        for (const [evidenceId, evidencePath] of artifacts.evidenceFiles) {
          task.selfCheckEvidenceFiles.set(evidenceId, evidencePath);
        }
        update({
          ...task.view,
          status: "completed",
          updatedAt: new Date().toISOString(),
          video: completedVideo,
          selfCheck: artifacts.view
        });
        return;
      }
      if (isVisualSelfCheckTool(definition.toolName)) {
        update({
          ...task.view,
          updatedAt: new Date().toISOString(),
          video: completedVideo,
          selfCheck: Object.freeze({ ...queuedVisualEffectSelfCheck(definition.toolName), status: "running" as const })
        });
        const artifacts = await this.visualSelfCheckRunner({
          requestId: task.view.id,
          tenantId: task.owner.tenantId,
          userId: task.owner.userId,
          toolName: definition.toolName,
          userRequest: task.selfCheckPrompt ?? "",
          videoPath: task.outputPath,
          fileName: completedVideo.downloadName,
          outputDirectory: join(this.outputRoot, task.view.id),
          width: metadata.width,
          height: metadata.height,
          fps: metadata.fps,
          durationSeconds: metadata.durationSeconds,
          frameCount: metadata.frameCount,
          bytes,
          ...(this.options.visualSelfCheckReviewer === undefined
            ? {} : { reviewer: this.options.visualSelfCheckReviewer }),
          ...(this.options.ffmpegPath === undefined ? {} : { ffmpegPath: this.options.ffmpegPath }),
          signal: task.controller.signal
        });
        for (const [evidenceId, evidencePath] of artifacts.evidenceFiles) {
          task.selfCheckEvidenceFiles.set(evidenceId, evidencePath);
        }
        update({
          ...task.view,
          status: "completed",
          updatedAt: new Date().toISOString(),
          video: completedVideo,
          selfCheck: artifacts.view
        });
        return;
      }
      if (isListedSelfCheckTool(definition.toolName)) {
        update({
          ...task.view,
          updatedAt: new Date().toISOString(),
          video: completedVideo,
          selfCheck: Object.freeze({ ...queuedListedToolSelfCheck(definition.toolName), status: "running" as const })
        });
        const artifacts = await this.listedToolSelfCheckRunner(definition.toolName, {
          userRequest: task.selfCheckPrompt ?? "",
          videoPath: task.outputPath,
          fileName: completedVideo.downloadName,
          outputDirectory: join(this.outputRoot, task.view.id),
          width: metadata.width,
          height: metadata.height,
          fps: metadata.fps,
          durationSeconds: metadata.durationSeconds,
          frameCount: metadata.frameCount,
          bytes,
          effectParams: envelope.data,
          ...(this.options.ffmpegPath === undefined ? {} : { ffmpegPath: this.options.ffmpegPath }),
          signal: task.controller.signal
        });
        for (const [evidenceId, evidencePath] of artifacts.evidenceFiles) {
          task.selfCheckEvidenceFiles.set(evidenceId, evidencePath);
        }
        update({
          ...task.view,
          status: "completed",
          updatedAt: new Date().toISOString(),
          video: completedVideo,
          selfCheck: artifacts.view
        });
        return;
      }
      update({
        ...task.view,
        status: "completed",
        updatedAt: new Date().toISOString(),
        video: completedVideo
      });
    } catch (error) {
      if (task.controller.signal.aborted && this.closing) return;
      update({
        ...task.view,
        status: "failed",
        updatedAt: new Date().toISOString(),
        failure: { code: "VIDEO_RENDER_FAILED", message: safeFailureMessage(error) }
      });
    } finally {
      stopGpuSampling();
    }
  }
}
