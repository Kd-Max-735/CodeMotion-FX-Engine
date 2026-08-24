import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { createCanvas, GlobalFonts, loadImage, type SKRSContext2D } from "@napi-rs/canvas";

const execFileAsync = promisify(execFile);
const CONTACT_SHEET_ID = "keyframe_contact_sheet";
const EVIDENCE_FONT_FAMILY = "CMFX CJK";
const MAX_REQUEST_LENGTH = 4_000;
const ANALYSIS_WIDTH = 160;
const ANALYSIS_HEIGHT = 90;
let evidenceFontReady: boolean | undefined;

export type ListedSelfCheckToolName = "datamosh" | "glitch_slice" | "pixel_sort"
  | "pixel_dissolve" | "video_freeze_frame" | "echo_trail" | "zoom_tunnel"
  | "portal" | "page_turn" | "wipe";

export interface EffectSelfCheckSamplingItem {
  readonly evidenceId: string;
  readonly role: string;
  readonly label: string;
  readonly frame: number;
  readonly time: number;
}

export interface EffectSelfCheckFrameObservation extends EffectSelfCheckSamplingItem {
  readonly meanLuminance: number;
  readonly darkPixelRatio: number;
  readonly horizontalDifference: number;
  readonly verticalDifference: number;
  readonly colorSpread: number;
  readonly pixels: Uint8ClampedArray;
}

export interface EffectSelfCheckDescription {
  readonly description: string;
  readonly effectPassed: boolean;
  readonly keyInformation: readonly Readonly<{ label: string; value: string }>[];
  readonly observation: Readonly<Record<string, string | number | boolean>>;
  readonly missingInformation?: readonly string[];
}

export interface EffectSelfCheckJson {
  readonly file_name: string;
  readonly original_request: string;
  readonly summary: Readonly<{
    description: string;
    key_information: readonly Readonly<{ label: string; value: string }>[];
    missing_information: readonly string[];
  }>;
  readonly metadata: Readonly<{
    media: Readonly<Record<string, string | number | boolean>>;
    quality: Readonly<Record<string, string | number | boolean>>;
    effect_observation: Readonly<Record<string, string | number | boolean>>;
    keyframe_evidence: Readonly<{
      coverage: "sufficient" | "insufficient";
      image_count: number;
      contact_sheet?: "keyframe_contact_sheet";
      keyframes: readonly Readonly<{ image_id: string; time_seconds: number; role: string }>[];
    }>;
  }>;
}

export interface EffectSelfCheckArtifacts {
  readonly json: EffectSelfCheckJson;
  readonly evidenceFiles: ReadonlyMap<"keyframe_contact_sheet", string>;
  readonly evidenceImage?: Readonly<{
    evidenceId: "keyframe_contact_sheet";
    label: string;
    mime: "image/png";
    width: number;
    height: number;
  }>;
}

export interface EffectSelfCheckPlanRequest<Params extends Readonly<Record<string, unknown>>> {
  readonly durationSeconds: number;
  readonly fps: number;
  readonly params: Params;
}

export interface EffectSelfCheckRunRequest<Params extends Readonly<Record<string, unknown>>>
  extends EffectSelfCheckPlanRequest<Params> {
  readonly userRequest: string;
  readonly videoPath: string;
  readonly fileName?: string;
  readonly outputDirectory: string;
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
  readonly bytes: number;
  readonly ffmpegPath?: string;
  readonly signal?: AbortSignal;
  readonly frameExtractor?: (
    inputPath: string,
    outputPath: string,
    width: number,
    height: number,
    time: number,
    signal?: AbortSignal
  ) => Promise<void>;
  readonly videoValidator?: (inputPath: string, signal?: AbortSignal) => Promise<void>;
}

export interface EffectSelfCheckConfig<Params extends Readonly<Record<string, unknown>>> {
  readonly toolName: ListedSelfCheckToolName;
  readonly displayName: string;
  readonly samplingPlan: (request: EffectSelfCheckPlanRequest<Params>) => readonly EffectSelfCheckSamplingItem[];
  readonly describe: (
    request: EffectSelfCheckRunRequest<Params>,
    observations: readonly EffectSelfCheckFrameObservation[],
    technicalIntegrity: boolean
  ) => EffectSelfCheckDescription;
}

function evidenceFont(): string {
  if (evidenceFontReady === undefined) {
    const candidates = [
      "C:/Windows/Fonts/msyh.ttc",
      "C:/Windows/Fonts/msyh.ttf",
      "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
      "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"
    ];
    evidenceFontReady = candidates.some((path) => existsSync(path)
      && Boolean(GlobalFonts.registerFromPath(path, EVIDENCE_FONT_FAMILY)));
  }
  return evidenceFontReady ? `"${EVIDENCE_FONT_FAMILY}", sans-serif` : "sans-serif";
}

function rounded(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function numericParam(params: Readonly<Record<string, unknown>>, name: string, fallback: number): number {
  return finite(params[name], fallback);
}

export function stringParam(params: Readonly<Record<string, unknown>>, name: string, fallback: string): string {
  return typeof params[name] === "string" ? params[name] as string : fallback;
}

export function samplingPlanAtTimes(
  durationSeconds: number,
  fps: number,
  checkpoints: readonly Readonly<{ evidenceId: string; role: string; label: string; time: number }>[]
): readonly EffectSelfCheckSamplingItem[] {
  const safeFps = Math.max(1, Math.round(fps));
  const frameCount = Math.max(1, Math.round(Math.max(0, durationSeconds) * safeFps));
  const latestFrame = frameCount - 1;
  const byFrame = new Map<number, EffectSelfCheckSamplingItem>();
  for (const checkpoint of checkpoints) {
    const frame = Math.max(0, Math.min(latestFrame, Math.round(Math.max(0, checkpoint.time) * safeFps)));
    byFrame.set(frame, Object.freeze({
      evidenceId: checkpoint.evidenceId,
      role: checkpoint.role,
      label: checkpoint.label,
      frame,
      time: rounded(frame / safeFps, 6)
    }));
  }
  return Object.freeze([...byFrame.values()].sort((left, right) => left.frame - right.frame));
}

export function samplingPlanAtFractions(
  durationSeconds: number,
  fps: number,
  checkpoints: readonly Readonly<{ evidenceId: string; role: string; label: string; fraction: number }>[]
): readonly EffectSelfCheckSamplingItem[] {
  return samplingPlanAtTimes(durationSeconds, fps, checkpoints.map((checkpoint) => ({
    ...checkpoint,
    time: Math.max(0, Math.min(1, checkpoint.fraction)) * Math.max(0, durationSeconds - 1 / Math.max(1, fps))
  })));
}

async function runFfmpeg(
  ffmpegPath: string | undefined,
  args: readonly string[],
  signal?: AbortSignal
): Promise<void> {
  await execFileAsync(ffmpegPath ?? "ffmpeg", [...args], {
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 2 * 1024 * 1024,
    ...(signal === undefined ? {} : { signal })
  });
}

async function validateFinalVideo(
  ffmpegPath: string | undefined,
  inputPath: string,
  signal?: AbortSignal
): Promise<void> {
  await runFfmpeg(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-xerror", "-i", inputPath,
    "-map", "0:v:0", "-an", "-f", "null", "-"
  ], signal);
}

async function extractFinalFrame(
  ffmpegPath: string | undefined,
  inputPath: string,
  outputPath: string,
  width: number,
  height: number,
  time: number,
  signal?: AbortSignal
): Promise<void> {
  await runFfmpeg(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-y", "-ss", time.toFixed(6), "-i", inputPath,
    "-frames:v", "1", "-vf",
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    outputPath
  ], signal);
}

function drawFitted(
  context: SKRSContext2D,
  image: Awaited<ReturnType<typeof loadImage>>,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const scale = Math.min(width / image.width, height / image.height);
  const targetWidth = image.width * scale;
  const targetHeight = image.height * scale;
  context.fillStyle = "#080b10";
  context.fillRect(x, y, width, height);
  context.drawImage(image, x + (width - targetWidth) / 2, y + (height - targetHeight) / 2,
    targetWidth, targetHeight);
}

async function observeFrame(
  path: string,
  sample: EffectSelfCheckSamplingItem
): Promise<EffectSelfCheckFrameObservation> {
  const image = await loadImage(path);
  const canvas = createCanvas(ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
  const context = canvas.getContext("2d");
  drawFitted(context, image, 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
  const pixels = context.getImageData(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT).data;
  let luminanceTotal = 0;
  let luminanceSquareTotal = 0;
  let darkPixels = 0;
  let horizontalDifference = 0;
  let horizontalSamples = 0;
  let verticalDifference = 0;
  let verticalSamples = 0;
  const luminanceAt = (pixel: number): number => {
    const offset = pixel * 4;
    return (pixels[offset]! * 0.2126 + pixels[offset + 1]! * 0.7152 + pixels[offset + 2]! * 0.0722) / 255;
  };
  for (let y = 0; y < ANALYSIS_HEIGHT; y += 1) {
    for (let x = 0; x < ANALYSIS_WIDTH; x += 1) {
      const pixel = y * ANALYSIS_WIDTH + x;
      const luminance = luminanceAt(pixel);
      luminanceTotal += luminance;
      luminanceSquareTotal += luminance * luminance;
      if (luminance < 0.02) darkPixels += 1;
      if (x > 0) {
        horizontalDifference += Math.abs(luminance - luminanceAt(pixel - 1));
        horizontalSamples += 1;
      }
      if (y > 0) {
        verticalDifference += Math.abs(luminance - luminanceAt(pixel - ANALYSIS_WIDTH));
        verticalSamples += 1;
      }
    }
  }
  const pixelCount = ANALYSIS_WIDTH * ANALYSIS_HEIGHT;
  const mean = luminanceTotal / pixelCount;
  return Object.freeze({
    ...sample,
    meanLuminance: rounded(mean, 6),
    darkPixelRatio: rounded(darkPixels / pixelCount, 6),
    horizontalDifference: rounded(horizontalDifference / Math.max(1, horizontalSamples), 6),
    verticalDifference: rounded(verticalDifference / Math.max(1, verticalSamples), 6),
    colorSpread: rounded(Math.sqrt(Math.max(0, luminanceSquareTotal / pixelCount - mean * mean)), 6),
    pixels
  });
}

export function frameDifference(
  left: EffectSelfCheckFrameObservation | undefined,
  right: EffectSelfCheckFrameObservation | undefined
): number {
  if (left === undefined || right === undefined || left.pixels.length !== right.pixels.length) return 0;
  let total = 0;
  let samples = 0;
  for (let offset = 0; offset < left.pixels.length; offset += 4) {
    total += Math.abs(left.pixels[offset]! - right.pixels[offset]!);
    total += Math.abs(left.pixels[offset + 1]! - right.pixels[offset + 1]!);
    total += Math.abs(left.pixels[offset + 2]! - right.pixels[offset + 2]!);
    samples += 3;
  }
  return rounded(total / Math.max(1, samples) / 255, 6);
}

export function averageFrameChange(observations: readonly EffectSelfCheckFrameObservation[]): number {
  if (observations.length < 2) return 0;
  const differences = observations.slice(1).map((observation, index) =>
    frameDifference(observations[index], observation));
  return rounded(differences.reduce((sum, value) => sum + value, 0) / differences.length, 6);
}

export function visualStrength(score: number): "轻微" | "清晰" | "强烈" {
  return score < 0.025 ? "轻微" : score < 0.09 ? "清晰" : "强烈";
}

export function dominantOrientation(
  observations: readonly EffectSelfCheckFrameObservation[]
): "横向" | "纵向" | "均衡" {
  if (observations.length === 0) return "均衡";
  const horizontal = observations.reduce((sum, item) => sum + item.horizontalDifference, 0) / observations.length;
  const vertical = observations.reduce((sum, item) => sum + item.verticalDifference, 0) / observations.length;
  if (Math.abs(horizontal - vertical) <= Math.max(horizontal, vertical) * 0.12) return "均衡";
  return horizontal < vertical ? "横向" : "纵向";
}

async function createContactSheet(
  samples: readonly EffectSelfCheckSamplingItem[],
  paths: ReadonlyMap<string, string>,
  outputPath: string
): Promise<Readonly<{ width: number; height: number }>> {
  const panels = await Promise.all(samples.flatMap((sample) => {
    const path = paths.get(sample.evidenceId);
    return path === undefined ? [] : [{ sample, image: loadImage(path) }];
  }).map(async (panel) => ({ sample: panel.sample, image: await panel.image })));
  if (panels.length === 0) throw new Error("No decoded keyframes are available for the contact sheet.");
  const panelWidth = 256;
  const panelHeight = 144;
  const gap = 14;
  const top = 68;
  const labelHeight = 54;
  const width = gap + panels.length * (panelWidth + gap);
  const height = top + panelHeight + labelHeight + gap;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#f2f0ea";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#17201c";
  context.font = `bold 22px ${evidenceFont()}`;
  context.fillText("关键帧合成图", gap, 29);
  context.fillStyle = "#59625d";
  context.font = `13px ${evidenceFont()}`;
  context.fillText("仅来自最终 MP4 · 按时间从左到右", gap, 53);
  for (let index = 0; index < panels.length; index += 1) {
    const panel = panels[index]!;
    const x = gap + index * (panelWidth + gap);
    drawFitted(context, panel.image, x, top, panelWidth, panelHeight);
    context.strokeStyle = "#a9aea9";
    context.lineWidth = 1;
    context.strokeRect(x, top, panelWidth, panelHeight);
    context.fillStyle = "#26312b";
    context.font = `bold 13px ${evidenceFont()}`;
    context.fillText(`第 ${index + 1} 帧 · ${panel.sample.label}`, x, top + panelHeight + 21);
    context.fillStyle = "#69726d";
    context.font = `11px ${evidenceFont()}`;
    context.fillText(`时间 ${panel.sample.time.toFixed(3)} 秒`, x, top + panelHeight + 42);
  }
  await writeFile(outputPath, canvas.toBuffer("image/png"));
  return Object.freeze({ width, height });
}

function evidenceDimensions(width: number, height: number): Readonly<{ width: number; height: number }> {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const scale = Math.min(1, 640 / safeWidth, 360 / safeHeight);
  return Object.freeze({
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale))
  });
}

export async function runEffectVideoSelfCheck<Params extends Readonly<Record<string, unknown>>>(
  config: EffectSelfCheckConfig<Params>,
  request: EffectSelfCheckRunRequest<Params>
): Promise<EffectSelfCheckArtifacts> {
  const samples = config.samplingPlan(request);
  if (samples.length === 0) throw new Error(`${config.toolName} self-check produced no keyframe plan.`);
  const directory = join(request.outputDirectory, `self-check-${config.toolName}`);
  await mkdir(directory, { recursive: true });
  let fullDecodePassed = true;
  try {
    const validator = request.videoValidator ?? ((inputPath: string, signal?: AbortSignal) =>
      validateFinalVideo(request.ffmpegPath, inputPath, signal));
    await validator(request.videoPath, request.signal);
  } catch {
    fullDecodePassed = false;
  }
  const size = evidenceDimensions(request.width, request.height);
  const extract = request.frameExtractor ?? ((inputPath, outputPath, width, height, time, signal) =>
    extractFinalFrame(request.ffmpegPath, inputPath, outputPath, width, height, time, signal));
  const paths = new Map<string, string>();
  const observations: EffectSelfCheckFrameObservation[] = [];
  for (const sample of samples) {
    const path = join(directory, `${sample.evidenceId}.png`);
    try {
      await extract(request.videoPath, path, size.width, size.height, sample.time, request.signal);
      observations.push(await observeFrame(path, sample));
      paths.set(sample.evidenceId, path);
    } catch {
      // Missing evidence is recorded in the JSON. Intentional visual disruption is never treated as this error.
    }
  }
  const technicalIntegrity = fullDecodePassed && observations.length === samples.length;
  const coverage = observations.length === samples.length ? "sufficient" as const : "insufficient" as const;
  const description = config.describe(request, Object.freeze(observations), technicalIntegrity);
  const deliveryPassed = technicalIntegrity && coverage === "sufficient" && description.effectPassed;
  const evidenceFiles = new Map<"keyframe_contact_sheet", string>();
  let evidenceImage: EffectSelfCheckArtifacts["evidenceImage"];
  if (observations.length > 0) {
    const boardPath = join(directory, `${CONTACT_SHEET_ID}.png`);
    const board = await createContactSheet(samples, paths, boardPath);
    evidenceFiles.set(CONTACT_SHEET_ID, boardPath);
    evidenceImage = Object.freeze({
      evidenceId: CONTACT_SHEET_ID,
      label: "最终 MP4 关键帧合成图",
      mime: "image/png",
      width: board.width,
      height: board.height
    });
  }
  const keyframes = observations.map((observation) => Object.freeze({
    image_id: observation.evidenceId,
    time_seconds: rounded(observation.time, 3),
    role: observation.label
  }));
  const json: EffectSelfCheckJson = Object.freeze({
    file_name: request.fileName ?? basename(request.videoPath),
    original_request: request.userRequest.slice(0, MAX_REQUEST_LENGTH),
    summary: Object.freeze({
      description: description.description,
      key_information: Object.freeze([
        Object.freeze({ label: "特效类型", value: config.displayName }),
        ...description.keyInformation,
        Object.freeze({ label: "交付状态", value: deliveryPassed ? "自检通过" : "需要返修" })
      ]),
      missing_information: Object.freeze([
        ...(description.missingInformation ?? []),
        ...(coverage === "insufficient" ? ["部分关键时刻未能从最终视频取得画面"] : [])
      ])
    }),
    metadata: Object.freeze({
      media: Object.freeze({
        media_type: "video/mp4",
        width_px: request.width,
        height_px: request.height,
        fps: request.fps,
        duration_seconds: rounded(request.durationSeconds, 3),
        frame_count: request.frameCount,
        file_size_bytes: request.bytes,
        full_video_decodable: fullDecodePassed
      }),
      quality: Object.freeze({
        delivery_status: deliveryPassed ? "pass" : "repair",
        effect_requirements_passed: description.effectPassed,
        full_decode_passed: fullDecodePassed,
        sampled_frames_decoded: observations.length,
        sampled_frames_expected: samples.length,
        intentional_effects_excluded_from_damage_detection: true,
        damage_basis: "完整视频解码和关键帧读取"
      }),
      effect_observation: Object.freeze({ ...description.observation }),
      keyframe_evidence: Object.freeze({
        coverage,
        image_count: keyframes.length,
        ...(evidenceImage === undefined ? {} : { contact_sheet: "keyframe_contact_sheet" as const }),
        keyframes: Object.freeze(keyframes)
      })
    })
  });
  return Object.freeze({
    json,
    evidenceFiles,
    ...(evidenceImage === undefined ? {} : { evidenceImage })
  });
}
