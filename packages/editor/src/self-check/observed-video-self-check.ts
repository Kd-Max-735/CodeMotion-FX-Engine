import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { createCanvas, GlobalFonts, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { observedEffectInformation, selfCheckParameterInformation } from "../self-check-parameter-summary.js";

const execFileAsync = promisify(execFile);
const CONTACT_SHEET_ID = "keyframe_contact_sheet";
const FONT_FAMILY = "CMFX Self Check CJK";
const MAX_REQUEST_LENGTH = 4_000;
const RULE_VERSION = "1.0.0";
const EVIDENCE_CONTRACT_VERSION = "1.0.0";
let fontReady: boolean | undefined;

export const OBSERVED_SELF_CHECK_TOOL_NAMES = Object.freeze([
  "beat_pulse",
  "onset_trigger",
  "spectrum_bars",
  "vocal_reactive_text",
  "waveform",
  "number_counter",
  "typewriter",
  "text_morph",
  "kinetic_typography",
  "path_trim"
] as const);

export type ObservedSelfCheckToolName = typeof OBSERVED_SELF_CHECK_TOOL_NAMES[number];

export interface ObservedFrameHint {
  readonly frame: number;
  readonly role: string;
}

export interface ObservedFrameMetrics {
  readonly frame: number;
  readonly time: number;
  readonly role: string;
  readonly imagePath: string;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly meanLuminance: number;
  readonly nonDarkRatio: number;
  readonly brightRatio: number;
  readonly saturatedRatio: number;
  readonly horizontalSpread: number;
  readonly verticalSpread: number;
  readonly upperActivity: number;
  readonly lowerActivity: number;
  readonly columnGroupCount: number;
  readonly differenceFromFirst: number;
  readonly differenceFromPrevious: number;
}

export interface ObservedEffectEvaluation {
  readonly passed: boolean;
  readonly description: string;
  readonly verdict: string;
  readonly keyInformation: readonly Readonly<{ label: string; value: string }>[];
  readonly observedFacts: Readonly<Record<string, unknown>>;
  readonly missingInformation?: readonly string[];
  readonly issues?: readonly string[];
}

export interface ObservedSelfCheckProfile {
  readonly toolName: ObservedSelfCheckToolName;
  readonly displayName: string;
  readonly expectedMotion: boolean;
  hintFrames(request: ObservedVideoSelfCheckRequest): readonly ObservedFrameHint[];
  selectFrames(frames: readonly ObservedFrameMetrics[]): readonly ObservedFrameMetrics[];
  evaluate(
    frames: readonly ObservedFrameMetrics[],
    selected: readonly ObservedFrameMetrics[],
    params: Readonly<Record<string, unknown>>
  ): ObservedEffectEvaluation;
}

export interface ObservedVideoSelfCheckRequest {
  readonly userRequest: string;
  readonly videoPath: string;
  readonly fileName?: string;
  readonly outputDirectory: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationSeconds: number;
  readonly frameCount: number;
  readonly bytes: number;
  readonly effectParams: Readonly<Record<string, unknown>>;
  readonly ffmpegPath?: string;
  readonly frameExtractor?: (
    inputPath: string,
    outputPath: string,
    time: number,
    signal?: AbortSignal
  ) => Promise<void>;
  readonly signal?: AbortSignal;
}

export interface ObservedEffectSelfCheckResult {
  readonly status: "pass" | "fail";
  readonly summary: string;
  readonly checks: readonly Readonly<{
    readonly name: "final_video" | "visible_effect" | "temporal_behavior" | "technical_quality";
    readonly status: "pass" | "fail";
    readonly reason: string;
  }>[];
  readonly issues: readonly string[];
}

export interface ObservedEffectSelfCheckView {
  readonly status: "queued" | "running" | "pass" | "fail";
  readonly automatic: true;
  readonly toolName: ObservedSelfCheckToolName;
  readonly ruleVersion: typeof RULE_VERSION;
  readonly evidenceContractVersion: typeof EVIDENCE_CONTRACT_VERSION;
  readonly evidenceStatus: "pending" | "sufficient";
  readonly macroView?: Readonly<Record<string, unknown>>;
  readonly evidenceImages: readonly Readonly<{
    readonly evidenceId: "keyframe_contact_sheet";
    readonly label: string;
    readonly mime: "image/png";
    readonly width: number;
    readonly height: number;
  }>[];
  readonly result?: ObservedEffectSelfCheckResult;
  readonly failure?: Readonly<{ code: "SELF_CHECK_FAILED"; message: string }>;
}

export interface ObservedSelfCheckArtifacts {
  readonly view: ObservedEffectSelfCheckView;
  readonly evidenceFiles: ReadonlyMap<string, string>;
  readonly jsonPath?: string;
}

function selfCheckFont(): string {
  if (fontReady === undefined) {
    const candidates = [
      "C:/Windows/Fonts/msyh.ttc",
      "C:/Windows/Fonts/msyh.ttf",
      "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
      "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"
    ];
    fontReady = candidates.some((path) => existsSync(path)
      && Boolean(GlobalFonts.registerFromPath(path, FONT_FAMILY)));
  }
  return fontReady ? `"${FONT_FAMILY}", sans-serif` : "sans-serif";
}

function rounded(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function publicText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.normalize("NFC").slice(0, 160) : fallback;
}

export function level(value: number, low: number, high: number): "轻微" | "中等" | "明显" {
  return value <= low ? "轻微" : value <= high ? "中等" : "明显";
}

export function queuedObservedSelfCheck(toolName: ObservedSelfCheckToolName): ObservedEffectSelfCheckView {
  return Object.freeze({
    status: "queued",
    automatic: true,
    toolName,
    ruleVersion: RULE_VERSION,
    evidenceContractVersion: EVIDENCE_CONTRACT_VERSION,
    evidenceStatus: "pending",
    evidenceImages: Object.freeze([])
  });
}

export function frameAt(fraction: number, frameCount: number): number {
  return Math.max(0, Math.min(Math.max(0, frameCount - 1), Math.round((frameCount - 1) * fraction)));
}

export function frameAtTime(time: number, request: Pick<ObservedVideoSelfCheckRequest, "fps" | "frameCount">): number {
  return Math.max(0, Math.min(Math.max(0, request.frameCount - 1), Math.round(Math.max(0, time) * request.fps)));
}

export function temporalHints(
  request: ObservedVideoSelfCheckRequest,
  times: readonly Readonly<{ time: number; role: string }>[]
): readonly ObservedFrameHint[] {
  return Object.freeze(times.map((item) => Object.freeze({
    frame: frameAtTime(item.time, request),
    role: item.role
  })));
}

function scanHints(request: ObservedVideoSelfCheckRequest): readonly ObservedFrameHint[] {
  const count = Math.max(7, Math.min(121,
    Math.ceil(request.durationSeconds * Math.min(12, request.fps)) + 1));
  return Object.freeze(Array.from({ length: count }, (_, index) => Object.freeze({
    frame: frameAt(index / Math.max(1, count - 1), request.frameCount),
    role: index === 0 ? "开始状态" : index === count - 1 ? "结束状态" : "变化扫描"
  })));
}

function mergedHints(
  request: ObservedVideoSelfCheckRequest,
  hints: readonly ObservedFrameHint[]
): readonly ObservedFrameHint[] {
  const byFrame = new Map<number, ObservedFrameHint>();
  for (const hint of [...scanHints(request), ...hints]) {
    const frame = Math.max(0, Math.min(Math.max(0, request.frameCount - 1), Math.round(hint.frame)));
    const existing = byFrame.get(frame);
    if (existing === undefined || existing.role === "变化扫描") byFrame.set(frame, Object.freeze({ ...hint, frame }));
  }
  return Object.freeze([...byFrame.values()].sort((a, b) => a.frame - b.frame));
}

async function extractFrame(
  ffmpegPath: string | undefined,
  inputPath: string,
  outputPath: string,
  time: number,
  signal?: AbortSignal
): Promise<void> {
  await execFileAsync(ffmpegPath ?? "ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-ss", time.toFixed(6),
    "-i", inputPath, "-frames:v", "1", "-an", outputPath
  ], { windowsHide: true, maxBuffer: 4 * 1024 * 1024, ...(signal === undefined ? {} : { signal }) });
}

interface RawFrame {
  readonly hint: ObservedFrameHint;
  readonly imagePath: string;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly pixels: Uint8ClampedArray;
}

function luminance(red: number, green: number, blue: number): number {
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function colorDistance(pixels: Uint8ClampedArray, other: Uint8ClampedArray): number {
  const length = Math.min(pixels.length, other.length);
  if (length === 0) return 0;
  let changed = 0;
  for (let offset = 0; offset < length; offset += 4) {
    const difference = Math.abs(pixels[offset]! - other[offset]!)
      + Math.abs(pixels[offset + 1]! - other[offset + 1]!)
      + Math.abs(pixels[offset + 2]! - other[offset + 2]!);
    if (difference >= 48) changed += 1;
  }
  return rounded(changed / Math.max(1, length / 4), 6);
}

function runs(values: readonly boolean[]): number {
  let count = 0;
  let active = false;
  for (const value of values) {
    if (value && !active) count += 1;
    active = value;
  }
  return count;
}

function rawMetrics(raw: RawFrame, request: ObservedVideoSelfCheckRequest): Omit<ObservedFrameMetrics,
  "differenceFromFirst" | "differenceFromPrevious"> {
  const pixels = raw.pixels;
  const width = request.width;
  const height = request.height;
  let luminanceSum = 0;
  let nonDark = 0;
  let bright = 0;
  let saturated = 0;
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  let upper = 0;
  let lower = 0;
  const activeByColumn = Array.from({ length: width }, () => 0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const red = pixels[offset]!;
      const green = pixels[offset + 1]!;
      const blue = pixels[offset + 2]!;
      const value = luminance(red, green, blue);
      luminanceSum += value;
      if (value > 14) nonDark += 1;
      if (value > 170) bright += 1;
      const colorful = Math.max(red, green, blue) - Math.min(red, green, blue) > 46 && value > 28;
      if (colorful) saturated += 1;
      if (value > 96 || colorful) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        activeByColumn[x] = activeByColumn[x]! + 1;
        if (y < height / 2) upper += 1;
        else lower += 1;
      }
    }
  }
  const pixelCount = Math.max(1, width * height);
  const columnThreshold = Math.max(1, Math.floor(height * 0.018));
  return {
    frame: raw.hint.frame,
    time: rounded(raw.hint.frame / request.fps, 3),
    role: raw.hint.role,
    imagePath: raw.imagePath,
    sourceWidth: raw.sourceWidth,
    sourceHeight: raw.sourceHeight,
    meanLuminance: rounded(luminanceSum / pixelCount, 2),
    nonDarkRatio: rounded(nonDark / pixelCount, 6),
    brightRatio: rounded(bright / pixelCount, 6),
    saturatedRatio: rounded(saturated / pixelCount, 6),
    horizontalSpread: maxX < minX ? 0 : rounded((maxX - minX + 1) / width, 4),
    verticalSpread: maxY < minY ? 0 : rounded((maxY - minY + 1) / height, 4),
    upperActivity: rounded(upper / pixelCount, 6),
    lowerActivity: rounded(lower / pixelCount, 6),
    columnGroupCount: runs(activeByColumn.map((value) => value >= columnThreshold))
  };
}

async function readRawFrame(
  hint: ObservedFrameHint,
  path: string,
  request: ObservedVideoSelfCheckRequest
): Promise<RawFrame> {
  const image = await loadImage(path);
  const canvas = createCanvas(request.width, request.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, request.width, request.height);
  return Object.freeze({
    hint,
    imagePath: path,
    sourceWidth: image.width,
    sourceHeight: image.height,
    pixels: context.getImageData(0, 0, request.width, request.height).data
  });
}

function withDifferences(rawFrames: readonly RawFrame[], request: ObservedVideoSelfCheckRequest): readonly ObservedFrameMetrics[] {
  const first = rawFrames[0];
  if (first === undefined) return Object.freeze([]);
  return Object.freeze(rawFrames.map((raw, index) => Object.freeze({
    ...rawMetrics(raw, request),
    differenceFromFirst: colorDistance(raw.pixels, first.pixels),
    differenceFromPrevious: index === 0 ? 0 : colorDistance(raw.pixels, rawFrames[index - 1]!.pixels)
  })));
}

export function distinctFrames(frames: readonly ObservedFrameMetrics[]): readonly ObservedFrameMetrics[] {
  const byFrame = new Map<number, ObservedFrameMetrics>();
  for (const frame of frames) byFrame.set(frame.frame, frame);
  return Object.freeze([...byFrame.values()].sort((a, b) => a.frame - b.frame));
}

export function extremaFrames(
  frames: readonly ObservedFrameMetrics[],
  metric: (frame: ObservedFrameMetrics) => number,
  maximumCount = 2
): readonly ObservedFrameMetrics[] {
  if (frames.length === 0) return Object.freeze([]);
  const local = frames.filter((frame, index) => {
    const value = metric(frame);
    return value >= metric(frames[Math.max(0, index - 1)]!)
      && value >= metric(frames[Math.min(frames.length - 1, index + 1)]!);
  }).sort((a, b) => metric(b) - metric(a));
  const chosen: ObservedFrameMetrics[] = [];
  for (const frame of local) {
    if (chosen.every((existing) => Math.abs(existing.frame - frame.frame) > 1)) chosen.push(frame);
    if (chosen.length >= maximumCount) break;
  }
  return Object.freeze(chosen);
}

export function variationRange(
  frames: readonly ObservedFrameMetrics[],
  metric: (frame: ObservedFrameMetrics) => number
): number {
  if (frames.length === 0) return 0;
  const values = frames.map(metric);
  return rounded(Math.max(...values) - Math.min(...values), 6);
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
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  context.fillStyle = "#080b10";
  context.fillRect(x, y, width, height);
  context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

async function contactSheet(
  frames: readonly ObservedFrameMetrics[],
  outputPath: string,
  width: number,
  height: number
): Promise<Readonly<{ width: number; height: number }>> {
  const ordered = [...frames].sort((a, b) => a.frame - b.frame);
  const images = await Promise.all(ordered.map(async (frame) => Object.freeze({
    frame,
    image: await loadImage(frame.imagePath)
  })));
  const panelWidth = 272;
  const panelHeight = Math.max(153, Math.round(panelWidth * height / width));
  const columns = Math.min(4, Math.max(1, images.length));
  const rows = Math.ceil(images.length / columns);
  const gap = 14;
  const headerHeight = 66;
  const labelHeight = 52;
  const boardWidth = columns * panelWidth + (columns + 1) * gap;
  const boardHeight = headerHeight + rows * (panelHeight + labelHeight + gap) + gap;
  const canvas = createCanvas(boardWidth, boardHeight);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, boardWidth, boardHeight);
  context.fillStyle = "#18211d";
  context.font = `bold 21px ${selfCheckFont()}`;
  context.fillText("关键帧合成图", gap, 28);
  context.fillStyle = "#65706a";
  context.font = `12px ${selfCheckFont()}`;
  context.fillText("仅从最终 MP4 抽取 · 按时间从左到右、从上到下", gap, 51);
  images.forEach((item, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = gap + column * (panelWidth + gap);
    const y = headerHeight + row * (panelHeight + labelHeight + gap);
    drawFitted(context, item.image, x, y, panelWidth, panelHeight);
    context.strokeStyle = "#d7ddd9";
    context.strokeRect(x, y, panelWidth, panelHeight);
    context.fillStyle = "#27312c";
    context.font = `bold 12px ${selfCheckFont()}`;
    context.fillText(`第 ${index + 1} 帧 · ${item.frame.role}`, x, y + panelHeight + 20);
    context.fillStyle = "#6d7872";
    context.font = `11px ${selfCheckFont()}`;
    context.fillText(`时间 ${item.frame.time.toFixed(3)} 秒`, x, y + panelHeight + 40);
  });
  await writeFile(outputPath, canvas.toBuffer("image/png"));
  return Object.freeze({ width: boardWidth, height: boardHeight });
}

function qualityFacts(frames: readonly ObservedFrameMetrics[], request: ObservedVideoSelfCheckRequest): Readonly<Record<string, unknown>> {
  const blackFrameCount = frames.filter((frame) => frame.meanLuminance < 3 && frame.nonDarkRatio < 0.002).length;
  const dimensionMismatchCount = frames.filter((frame) => frame.sourceWidth !== request.width
    || frame.sourceHeight !== request.height).length;
  const changes = frames.slice(1).map((frame) => frame.differenceFromPrevious);
  const maximumChange = changes.length === 0 ? 0 : Math.max(...changes);
  const averageChange = changes.length === 0 ? 0 : changes.reduce((sum, value) => sum + value, 0) / changes.length;
  return Object.freeze({
    decoded_frame_count: frames.length,
    decode_failure_count: 0,
    dimension_consistent: dimensionMismatchCount === 0,
    black_frame_count: blackFrameCount,
    visible_change_range: changes.length === 0 ? 0 : rounded(Math.max(...changes) - Math.min(...changes), 6),
    abnormal_freeze_detected: maximumChange < 0.00001,
    obvious_flicker_detected: averageChange > 0.6
  });
}

function mediaFacts(request: ObservedVideoSelfCheckRequest): Readonly<Record<string, unknown>> {
  return Object.freeze({
    media_type: "video/mp4",
    container: "mp4",
    video_codec: "h264",
    width_px: request.width,
    height_px: request.height,
    fps: request.fps,
    duration_seconds: rounded(request.durationSeconds, 3),
    frame_count: request.frameCount,
    file_size_bytes: request.bytes,
    encoding_completed: true,
    decodable: true
  });
}

function keyframeFacts(frames: readonly ObservedFrameMetrics[]): Readonly<Record<string, unknown>> {
  return Object.freeze({
    coverage: "sufficient",
    image_count: frames.length,
    contact_sheet: CONTACT_SHEET_ID,
    keyframes: Object.freeze(frames.map((frame) => Object.freeze({
      image_id: `frame_${frame.frame}`,
      time_seconds: frame.time,
      role: frame.role
    })))
  });
}

function resultFor(
  evaluation: ObservedEffectEvaluation,
  frames: readonly ObservedFrameMetrics[],
  request: ObservedVideoSelfCheckRequest,
  expectedMotion: boolean
): ObservedEffectSelfCheckResult {
  const dimensionsOkay = frames.every((frame) => frame.sourceWidth === request.width && frame.sourceHeight === request.height);
  const blackFrames = frames.filter((frame) => frame.meanLuminance < 3 && frame.nonDarkRatio < 0.002).length;
  const variation = Math.max(0, ...frames.map((frame) => frame.differenceFromFirst));
  const temporalPassed = !expectedMotion || variation >= 0.00005;
  const technicalPassed = blackFrames < frames.length;
  const checks = Object.freeze([
    Object.freeze({ name: "final_video" as const, status: dimensionsOkay ? "pass" as const : "fail" as const,
      reason: dimensionsOkay ? "最终 MP4 关键帧均可按目标尺寸解码。" : "最终 MP4 的抽样帧尺寸不一致。" }),
    Object.freeze({ name: "visible_effect" as const, status: evaluation.passed ? "pass" as const : "fail" as const,
      reason: evaluation.verdict }),
    Object.freeze({ name: "temporal_behavior" as const, status: temporalPassed ? "pass" as const : "fail" as const,
      reason: temporalPassed ? "成片关键阶段存在可观察的时序变化。" : "需要运动的效果在成片中未观察到足够变化。" }),
    Object.freeze({ name: "technical_quality" as const, status: technicalPassed ? "pass" as const : "fail" as const,
      reason: blackFrames === 0 ? "未发现无法解释的黑帧或解码异常。"
        : technicalPassed ? `发现 ${blackFrames} 个近黑端点或阶段帧，其余关键阶段可见。` : "所有抽样帧均近黑。" })
  ]);
  const passed = checks.every((check) => check.status === "pass");
  const issues = Object.freeze([
    ...(evaluation.issues ?? []),
    ...(dimensionsOkay ? [] : ["最终视频抽样帧尺寸不一致。"]),
    ...(temporalPassed ? [] : ["成片未呈现所需的可见时序变化。"]),
    ...(technicalPassed ? [] : ["成片所有抽样帧均为近黑画面。"])
  ]);
  return Object.freeze({
    status: passed ? "pass" : "fail",
    summary: passed ? `${evaluation.description} 自检通过。` : `${evaluation.description} 需要返修。`,
    checks,
    issues
  });
}

function failedArtifacts(profile: ObservedSelfCheckProfile, error: unknown): ObservedSelfCheckArtifacts {
  const message = error instanceof Error ? error.message : "专属自检执行失败。";
  return Object.freeze({
    view: Object.freeze({
      status: "fail",
      automatic: true,
      toolName: profile.toolName,
      ruleVersion: RULE_VERSION,
      evidenceContractVersion: EVIDENCE_CONTRACT_VERSION,
      evidenceStatus: "pending",
      evidenceImages: Object.freeze([]),
      failure: Object.freeze({ code: "SELF_CHECK_FAILED", message })
    }),
    evidenceFiles: new Map()
  });
}

export async function runObservedVideoEvidencePipeline(
  profile: ObservedSelfCheckProfile,
  request: ObservedVideoSelfCheckRequest
): Promise<ObservedSelfCheckArtifacts> {
    try {
      if (!Number.isInteger(request.width) || !Number.isInteger(request.height)
        || request.width < 1 || request.height < 1 || request.fps <= 0
        || request.durationSeconds <= 0 || request.frameCount < 1 || request.bytes < 1) {
        throw new TypeError(`${profile.toolName} 自检收到无效的最终视频元数据。`);
      }
      const directory = join(request.outputDirectory, "self-check", profile.toolName);
      await mkdir(directory, { recursive: true });
      const extractor = request.frameExtractor ?? ((inputPath, outputPath, time, signal) =>
        extractFrame(request.ffmpegPath, inputPath, outputPath, time, signal));
      const hints = mergedHints(request, profile.hintFrames(request));
      const rawFrames: RawFrame[] = [];
      for (const hint of hints) {
        const path = join(directory, `frame_${hint.frame}.png`);
        const time = hint.frame / request.fps;
        await extractor(request.videoPath, path, time, request.signal);
        rawFrames.push(await readRawFrame(hint, path, request));
      }
      const frames = withDifferences(rawFrames, request);
      const selected = distinctFrames(profile.selectFrames(frames));
      if (selected.length < 2) throw new Error(`${profile.toolName} 没有选出足够的最终成片关键帧。`);
      const evaluation = profile.evaluate(frames, selected, request.effectParams);
      const result = resultFor(evaluation, frames, request, profile.expectedMotion);
      const boardPath = join(directory, "keyframe_contact_sheet.png");
      const board = await contactSheet(selected, boardPath, request.width, request.height);
      const macroView = Object.freeze({
        file_name: request.fileName ?? basename(request.videoPath),
        original_request: request.userRequest.slice(0, MAX_REQUEST_LENGTH),
        summary: Object.freeze({
          description: evaluation.description,
          key_information: selfCheckParameterInformation(profile.toolName, request.effectParams),
          missing_information: Object.freeze([...(evaluation.missingInformation ?? [])])
        }),
        metadata: Object.freeze({
          media: mediaFacts(request),
          quality: qualityFacts(frames, request),
          observed_effect: Object.freeze({
            ...evaluation.observedFacts,
            ...observedEffectInformation(evaluation.keyInformation)
          }),
          keyframe_evidence: keyframeFacts(selected)
        })
      });
      const jsonPath = join(directory, "self-check.json");
      await writeFile(jsonPath, `${JSON.stringify(macroView, null, 2)}\n`, "utf8");
      const evidenceFiles = new Map<string, string>([[CONTACT_SHEET_ID, boardPath]]);
      return Object.freeze({
        view: Object.freeze({
          status: result.status,
          automatic: true,
          toolName: profile.toolName,
          ruleVersion: RULE_VERSION,
          evidenceContractVersion: EVIDENCE_CONTRACT_VERSION,
          evidenceStatus: "sufficient",
          macroView,
          evidenceImages: Object.freeze([Object.freeze({
            evidenceId: CONTACT_SHEET_ID,
            label: `${profile.displayName}最终 MP4 关键帧合成图`,
            mime: "image/png",
            width: board.width,
            height: board.height
          })]),
          result
        }),
        evidenceFiles,
        jsonPath
      });
  } catch (error) {
    return failedArtifacts(profile, error);
  }
}

export async function readGeneratedSelfCheckJson(artifacts: ObservedSelfCheckArtifacts): Promise<unknown> {
  if (artifacts.jsonPath === undefined) throw new Error("Self-check JSON was not generated.");
  return JSON.parse(await readFile(artifacts.jsonPath, "utf8"));
}
