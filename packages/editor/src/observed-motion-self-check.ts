import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { createCanvas, GlobalFonts, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { ProviderError } from "@codemotion/ai-planner";
import { observedEffectInformation, selfCheckParameterInformation } from "./self-check-parameter-summary.js";
import {
  VolcengineArkUnifiedSelfCheckReviewer,
  parseUnifiedSelfCheckResult,
  unifiedSelfCheckResponseContract
} from "./unified-self-check-review.js";

const execFileAsync = promisify(execFile);
const DEFAULT_ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const MAX_REVIEW_TEXT = 2_000;
const RULE_VERSION = "1.0.0";
const EVIDENCE_CONTRACT_VERSION = "1.0.0";
const EVIDENCE_FONT_FAMILY = "CMFX CJK";
let evidenceFontReady: boolean | undefined;

export const OBSERVED_MOTION_SELF_CHECK_TOOLS = Object.freeze([
  "handheld", "bounce", "elastic", "float", "fade", "rotate_in", "scale_pop", "slide", "ken_burns", "dolly"
] as const);

export type ObservedMotionSelfCheckTool = typeof OBSERVED_MOTION_SELF_CHECK_TOOLS[number];

export interface ObservedMotionSummary {
  readonly description: string;
  readonly keyInformation: readonly Readonly<{ label: string; value: string }>[];
  readonly missingInformation: readonly string[];
}

export interface ObservedMotionToolConfig {
  readonly toolName: ObservedMotionSelfCheckTool;
  readonly displayName: string;
  readonly candidateCount: number;
  readonly ruleIds: readonly string[];
  readonly selectKeyframes: (candidates: readonly CandidateFrame[]) => readonly KeyframeSelection[];
  readonly summarize: (candidates: readonly CandidateFrame[]) => ObservedMotionSummary;
}

export interface ObservedMotionSelfCheckIssue {
  readonly ruleId: string;
  readonly code: string;
  readonly message: string;
  readonly evidenceRefs: readonly string[];
}

export interface ObservedMotionSelfCheckResult {
  readonly status: "pass" | "fail" | "inconclusive";
  readonly summary: string;
  readonly checks: readonly Readonly<{
    ruleId: string;
    status: "pass" | "fail" | "inconclusive";
    evidenceRefs: readonly string[];
    reason: string;
  }>[];
  readonly issues: readonly ObservedMotionSelfCheckIssue[];
}

export interface ObservedMotionSelfCheckView {
  readonly status: "queued" | "running" | "pass" | "fail" | "inconclusive";
  readonly automatic: true;
  readonly toolName: ObservedMotionSelfCheckTool;
  readonly ruleVersion: string;
  readonly evidenceContractVersion: string;
  readonly evidenceStatus: "pending" | "sufficient";
  readonly macroView?: Readonly<Record<string, unknown>>;
  readonly evidenceImages: readonly Readonly<{
    evidenceId: string;
    label: string;
    mime: "image/png";
    width: number;
    height: number;
  }>[];
  readonly result?: ObservedMotionSelfCheckResult;
  readonly failure?: Readonly<{ code: string; message: string }>;
}

export interface ObservedMotionSelfCheckReviewer {
  review(request: Readonly<{
    requestId: string;
    tenantId: string;
    userId: string;
    toolName: ObservedMotionSelfCheckTool;
    displayName: string;
    ruleIds: readonly string[];
    rule: string;
    acceptanceView: Readonly<Record<string, unknown>>;
    evidencePng: Buffer;
    signal?: AbortSignal;
  }>): Promise<ObservedMotionSelfCheckResult>;
}

export interface ObservedMotionSelfCheckArtifacts {
  readonly view: ObservedMotionSelfCheckView;
  readonly evidenceFiles: ReadonlyMap<string, string>;
}

export interface ObservedMotionSelfCheckRequest {
  readonly requestId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly userRequest: string;
  readonly effectiveParams: Readonly<Record<string, unknown>>;
  readonly videoPath: string;
  readonly fileName?: string;
  readonly outputDirectory: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationSeconds: number;
  readonly frameCount: number;
  readonly bytes: number;
  readonly reviewer?: ObservedMotionSelfCheckReviewer;
  readonly ffmpegPath?: string;
  readonly frameExtractor?: (
    inputPath: string,
    outputPath: string,
    width: number,
    height: number,
    time: number,
    signal?: AbortSignal
  ) => Promise<void>;
  readonly signal?: AbortSignal;
}

export interface CandidateFrame {
  readonly frame: number;
  readonly time: number;
  readonly path: string;
  readonly pixels: Uint8ClampedArray;
  readonly meanLuma: number;
  readonly contrast: number;
  readonly darkRatio: number;
  readonly edgeStrength: number;
  readonly centroidX: number;
  readonly centroidY: number;
  readonly spreadX: number;
  readonly spreadY: number;
  readonly orientation: number;
  readonly changeFromPrevious: number;
}

export interface KeyframeSelection {
  readonly candidate: CandidateFrame;
  readonly role: string;
}

function evidenceFont(): string {
  if (evidenceFontReady === undefined) {
    const candidates = [
      "C:/Windows/Fonts/msyh.ttc",
      "C:/Windows/Fonts/msyh.ttf",
      "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
      "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
      "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"
    ];
    evidenceFontReady = candidates.some((path) => existsSync(path)
      && Boolean(GlobalFonts.registerFromPath(path, EVIDENCE_FONT_FAMILY)));
  }
  return evidenceFontReady ? `"${EVIDENCE_FONT_FAMILY}", sans-serif` : "sans-serif";
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function rounded(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function observedMedian(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

export function observedRange(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values) - Math.min(...values);
}

function isObservedMotionTool(value: string): value is ObservedMotionSelfCheckTool {
  return (OBSERVED_MOTION_SELF_CHECK_TOOLS as readonly string[]).includes(value);
}

export function hasObservedMotionSelfCheck(toolName: string): toolName is ObservedMotionSelfCheckTool {
  return isObservedMotionTool(toolName);
}

export function queuedObservedMotionSelfCheck(toolName: ObservedMotionSelfCheckTool): ObservedMotionSelfCheckView {
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

function candidateFrames(durationSeconds: number, fps: number, frameCount: number, count: number): readonly Readonly<{
  frame: number;
  time: number;
}>[] {
  const safeFrameCount = Math.max(1, frameCount);
  const frames = new Set<number>();
  const requested = Math.max(3, Math.min(count, safeFrameCount));
  for (let index = 0; index < requested; index += 1) {
    frames.add(Math.round(index / Math.max(1, requested - 1) * (safeFrameCount - 1)));
  }
  return Object.freeze([...frames].sort((a, b) => a - b).map((frame) => Object.freeze({
    frame,
    time: rounded(Math.min(durationSeconds, frame / fps), 6)
  })));
}

async function runFfmpeg(ffmpegPath: string | undefined, args: readonly string[], signal?: AbortSignal): Promise<void> {
  await execFileAsync(ffmpegPath ?? "ffmpeg", [...args], {
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 2 * 1024 * 1024,
    ...(signal === undefined ? {} : { signal })
  });
}

async function extractImage(
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
  ctx: SKRSContext2D,
  image: Awaited<ReturnType<typeof loadImage>>,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const scale = Math.min(width / image.width, height / image.height);
  const targetWidth = image.width * scale;
  const targetHeight = image.height * scale;
  const left = x + (width - targetWidth) / 2;
  const top = y + (height - targetHeight) / 2;
  ctx.fillStyle = "#070b12";
  ctx.fillRect(x, y, width, height);
  ctx.drawImage(image, left, top, targetWidth, targetHeight);
}

function pixelDifference(first: Uint8ClampedArray, second: Uint8ClampedArray): number {
  let difference = 0;
  const length = Math.min(first.length, second.length);
  for (let offset = 0; offset < length; offset += 4) {
    difference += Math.abs(first[offset]! - second[offset]!)
      + Math.abs(first[offset + 1]! - second[offset + 1]!)
      + Math.abs(first[offset + 2]! - second[offset + 2]!);
  }
  return length === 0 ? 0 : difference / (length / 4 * 3 * 255);
}

async function analyzeFrame(
  path: string,
  frame: number,
  time: number,
  previousPixels?: Uint8ClampedArray
): Promise<CandidateFrame> {
  const image = await loadImage(path);
  const analysisWidth = 160;
  const analysisHeight = 90;
  const canvas = createCanvas(analysisWidth, analysisHeight);
  const ctx = canvas.getContext("2d");
  drawFitted(ctx, image, 0, 0, analysisWidth, analysisHeight);
  const pixels = ctx.getImageData(0, 0, analysisWidth, analysisHeight).data;
  const luminance = new Float64Array(analysisWidth * analysisHeight);
  let sum = 0;
  let sumSquares = 0;
  let dark = 0;
  for (let index = 0; index < luminance.length; index += 1) {
    const offset = index * 4;
    const value = (pixels[offset]! * 0.2126 + pixels[offset + 1]! * 0.7152 + pixels[offset + 2]! * 0.0722) / 255;
    luminance[index] = value;
    sum += value;
    sumSquares += value * value;
    if (value < 0.02) dark += 1;
  }
  const meanLuma = sum / luminance.length;
  const contrast = Math.sqrt(Math.max(0, sumSquares / luminance.length - meanLuma * meanLuma));
  let weights = 0;
  let weightedX = 0;
  let weightedY = 0;
  let edgeTotal = 0;
  const samples: Array<readonly [number, number, number]> = [];
  for (let y = 1; y < analysisHeight - 1; y += 1) {
    for (let x = 1; x < analysisWidth - 1; x += 1) {
      const index = y * analysisWidth + x;
      const gx = luminance[index + 1]! - luminance[index - 1]!;
      const gy = luminance[index + analysisWidth]! - luminance[index - analysisWidth]!;
      const weight = Math.hypot(gx, gy) + Math.abs(luminance[index]! - meanLuma) * 0.08;
      if (weight <= 0.002) continue;
      const nx = x / (analysisWidth - 1);
      const ny = y / (analysisHeight - 1);
      samples.push([nx, ny, weight]);
      weights += weight;
      weightedX += nx * weight;
      weightedY += ny * weight;
      edgeTotal += Math.hypot(gx, gy);
    }
  }
  const centroidX = weights <= Number.EPSILON ? 0.5 : weightedX / weights;
  const centroidY = weights <= Number.EPSILON ? 0.5 : weightedY / weights;
  let covarianceX = 0;
  let covarianceY = 0;
  let covarianceXY = 0;
  for (const [x, y, weight] of samples) {
    const dx = x - centroidX;
    const dy = y - centroidY;
    covarianceX += dx * dx * weight;
    covarianceY += dy * dy * weight;
    covarianceXY += dx * dy * weight;
  }
  const divisor = Math.max(Number.EPSILON, weights);
  covarianceX /= divisor;
  covarianceY /= divisor;
  covarianceXY /= divisor;
  return Object.freeze({
    frame,
    time,
    path,
    pixels,
    meanLuma: rounded(meanLuma, 6),
    contrast: rounded(contrast, 6),
    darkRatio: rounded(dark / luminance.length, 6),
    edgeStrength: rounded(edgeTotal / luminance.length, 6),
    centroidX: rounded(centroidX, 6),
    centroidY: rounded(centroidY, 6),
    spreadX: rounded(Math.sqrt(Math.max(0, covarianceX)), 6),
    spreadY: rounded(Math.sqrt(Math.max(0, covarianceY)), 6),
    orientation: rounded(0.5 * Math.atan2(2 * covarianceXY, covarianceX - covarianceY), 6),
    changeFromPrevious: previousPixels === undefined ? 0 : rounded(pixelDifference(previousPixels, pixels), 6)
  });
}

export function observedExtremaIndices(values: readonly number[], minimumChange: number): readonly number[] {
  const indices: number[] = [];
  for (let index = 1; index < values.length - 1; index += 1) {
    const before = values[index]! - values[index - 1]!;
    const after = values[index + 1]! - values[index]!;
    if (Math.abs(before) + Math.abs(after) >= minimumChange && before * after <= 0) indices.push(index);
  }
  return Object.freeze(indices);
}

export function addObservedSelection(
  selections: Map<number, string>,
  index: number,
  role: string,
  length: number
): void {
  const safeIndex = Math.max(0, Math.min(length - 1, index));
  if (!selections.has(safeIndex)) selections.set(safeIndex, role);
}

export function strongestObservedExtrema(values: readonly number[], limit: number): readonly number[] {
  const amplitude = Math.max(0.002, observedRange(values) * 0.04);
  return Object.freeze([...observedExtremaIndices(values, amplitude)]
    .sort((a, b) => Math.abs(values[b]! - observedMedian(values)) - Math.abs(values[a]! - observedMedian(values)))
    .slice(0, limit));
}

export function observedAmplitude(value: number): string {
  return value < 0.012 ? "轻微" : value < 0.04 ? "中等" : "明显";
}

export function observedPace(changes: readonly number[], duration: number): string {
  const active = changes.filter((value) => value > Math.max(0.004, observedMedian(changes) * 0.8)).length;
  const rate = active / Math.max(0.1, duration);
  return rate < 2 ? "舒缓" : rate < 6 ? "适中" : "急促";
}

export function observedDirection(dx: number, dy: number, entrance = false): string {
  if (Math.hypot(dx, dy) < 0.004) return "起终位置接近";
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0
    ? entrance ? "从左向右进入" : "向右移动"
    : entrance ? "从右向左进入" : "向左移动";
  return dy > 0
    ? entrance ? "从上向下进入" : "向下移动"
    : entrance ? "从下向上进入" : "向上移动";
}

export function observedScale(candidate: CandidateFrame): number {
  return Math.sqrt(candidate.spreadX * candidate.spreadY);
}

export function observedVisibility(candidate: CandidateFrame): number {
  return candidate.meanLuma + candidate.contrast * 0.35 + candidate.edgeStrength * 0.25;
}

export function finalizeObservedSelections(
  candidates: readonly CandidateFrame[],
  selections: ReadonlyMap<number, string>,
  maximum: number
): readonly KeyframeSelection[] {
  const length = candidates.length;
  let ordered = [...selections.entries()].sort((a, b) => a[0] - b[0]);
  if (ordered.length > maximum) {
    const mandatory = new Set([0, length - 1]);
    const interior = ordered.filter(([index]) => !mandatory.has(index));
    const keep = interior.filter((_, index) => index % Math.max(1, Math.ceil(interior.length / (maximum - 2))) === 0)
      .slice(0, maximum - 2);
    const first = ordered.find(([index]) => index === 0);
    const last = ordered.find(([index]) => index === length - 1);
    ordered = [...(first === undefined ? [] : [first]), ...keep, ...(last === undefined ? [] : [last])]
      .sort((a, b) => a[0] - b[0]);
  }
  return Object.freeze(ordered.map(([index, role]) => Object.freeze({ candidate: candidates[index]!, role })));
}

function observedSummary(
  config: ObservedMotionToolConfig,
  candidates: readonly CandidateFrame[]
): ObservedMotionSummary {
  return config.summarize(candidates);
}

function qualityView(candidates: readonly CandidateFrame[]): Readonly<Record<string, unknown>> {
  const changes = candidates.slice(1).map((item) => item.changeFromPrevious);
  const typicalChange = observedMedian(changes);
  const abrupt = changes.filter((value) => value > Math.max(0.2, typicalChange * 5)).length;
  const blackFrames = candidates.filter((item) => item.meanLuma < 0.015 && item.darkRatio > 0.98).length;
  return Object.freeze({
    black_frame_ratio: rounded(blackFrames / Math.max(1, candidates.length), 6),
    decode_failure_count: 0,
    dimension_consistent: true,
    freeze_detected: changes.length > 0 && Math.max(...changes) < 0.0015,
    flicker_level: abrupt === 0 ? "none" : abrupt <= 1 ? "low" : "high",
    unexpected_cut_count: abrupt
  });
}

function publicSelfCheckView(
  config: ObservedMotionToolConfig,
  request: ObservedMotionSelfCheckRequest,
  candidates: readonly CandidateFrame[],
  keyframes: readonly KeyframeSelection[]
): Readonly<Record<string, unknown>> {
  const summary = observedSummary(config, candidates);
  return Object.freeze({
    file_name: request.fileName ?? basename(request.videoPath),
    original_request: request.userRequest.slice(0, 4_000),
    summary: Object.freeze({
      description: summary.description,
      key_information: selfCheckParameterInformation(config.toolName, request.effectiveParams),
      missing_information: summary.missingInformation
    }),
    metadata: Object.freeze({
      media: Object.freeze({
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
        decodable: true,
        has_audio: false
      }),
      observed_effect: observedEffectInformation(summary.keyInformation),
      quality: qualityView(candidates),
      keyframe_evidence: Object.freeze({
        coverage: "sufficient",
        image_count: keyframes.length,
        contact_sheet: "keyframe_contact_sheet",
        keyframes: Object.freeze(keyframes.map((item, index) => Object.freeze({
          image_id: `keyframe_${String(index + 1).padStart(2, "0")}`,
          time_seconds: rounded(item.candidate.time, 3),
          role: item.role
        })))
      })
    })
  });
}

async function keyframeContactSheet(
  config: ObservedMotionToolConfig,
  keyframes: readonly KeyframeSelection[],
  outputPath: string,
  width: number,
  height: number
): Promise<Readonly<{ width: number; height: number }>> {
  const panels = await Promise.all(keyframes.map(async (item) => Object.freeze({
    item,
    image: await loadImage(item.candidate.path)
  })));
  const panelWidth = 288;
  const panelHeight = Math.max(162, Math.round(panelWidth * height / width));
  const labelHeight = 55;
  const gap = 16;
  const headerHeight = 68;
  const boardWidth = panels.length * panelWidth + (panels.length + 1) * gap;
  const boardHeight = headerHeight + panelHeight + labelHeight + gap * 2;
  const canvas = createCanvas(boardWidth, boardHeight);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, boardWidth, boardHeight);
  ctx.fillStyle = "#18211d";
  ctx.font = `bold 22px ${evidenceFont()}`;
  ctx.fillText(`${config.displayName}关键帧合成图`, gap, 29);
  ctx.fillStyle = "#65706a";
  ctx.font = `13px ${evidenceFont()}`;
  ctx.fillText(`从最终 MP4 抽取 · ${width} × ${height} · 按时间从左到右`, gap, 53);
  panels.forEach((panel, index) => {
    const x = gap + index * (panelWidth + gap);
    const y = headerHeight;
    drawFitted(ctx, panel.image, x, y, panelWidth, panelHeight);
    ctx.strokeStyle = "#d7ddd9";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, panelWidth, panelHeight);
    ctx.fillStyle = "#27312c";
    ctx.font = `bold 13px ${evidenceFont()}`;
    ctx.fillText(`第 ${index + 1} 帧 · ${panel.item.role}`, x, y + panelHeight + 21);
    ctx.fillStyle = "#6d7872";
    ctx.font = `11px ${evidenceFont()}`;
    ctx.fillText(`时间 ${panel.item.candidate.time.toFixed(3)} 秒`, x, y + panelHeight + 42);
  });
  await writeFile(outputPath, canvas.toBuffer("image/png"));
  return Object.freeze({ width: boardWidth, height: boardHeight });
}

function safeReviewText(value: unknown, label: string): string {
  if (typeof value !== "string") throw new ProviderError("provider_response", `${label} is invalid.`);
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > MAX_REVIEW_TEXT
    || /https?:\/\/|[A-Za-z]:\\|\/(?:home|tmp|var)\/|asset_[a-z0-9]{8,}/u.test(normalized)) {
    throw new ProviderError("provider_response", `${label} contains unsafe or invalid content.`);
  }
  return normalized;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new ProviderError("provider_response", `${label} has an invalid field set.`);
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProviderError("provider_response", `${label} is not an object.`);
  }
  return value as Record<string, unknown>;
}

export function parseObservedMotionSelfCheckResult(
  ruleIds: readonly string[],
  value: unknown
): ObservedMotionSelfCheckResult {
  return parseUnifiedSelfCheckResult(value, ruleIds);
}

function arkBodyContent(body: unknown): unknown {
  const root = object(body, "Ark response");
  if (!Array.isArray(root.choices) || root.choices.length !== 1) {
    throw new ProviderError("provider_response", "Ark returned an invalid choice count.");
  }
  const choice = object(root.choices[0], "Ark choice");
  const message = object(choice.message, "Ark message");
  if (typeof message.content !== "string") {
    throw new ProviderError("provider_response", "Ark returned no self-check JSON content.");
  }
  const content = message.content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(content)?.[1];
  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  const embedded = firstBrace >= 0 && lastBrace > firstBrace ? content.slice(firstBrace, lastBrace + 1) : undefined;
  let cause: unknown;
  for (const candidate of [...new Set([content, fenced, embedded].filter((item): item is string => item !== undefined))]) {
    try { return JSON.parse(candidate) as unknown; }
    catch (error) { cause = error; }
  }
  throw new ProviderError("provider_response", "Ark returned invalid self-check JSON.", { cause });
}

function actualEvidenceRefs(acceptanceView: Readonly<Record<string, unknown>>): ReadonlySet<string> {
  const allowed = new Set<string>(["keyframe_contact_sheet"]);
  const visit = (value: unknown, path: string, depth: number): void => {
    if (depth > 8) return;
    if (path.length > 0) allowed.add(path);
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}[${index}]`, depth + 1));
      return;
    }
    if (typeof value !== "object" || value === null) return;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (!/^[a-z][a-z0-9_]*$/u.test(key)) continue;
      const childPath = path.length === 0 ? key : `${path}.${key}`;
      visit(entry, childPath, depth + 1);
      if (key === "image_id" && typeof entry === "string" && entry.length <= 80) allowed.add(entry);
    }
  };
  visit(acceptanceView, "", 0);
  return allowed;
}

function reviewResponseContract(ruleIds: readonly string[], acceptanceView: Readonly<Record<string, unknown>>): string {
  void acceptanceView;
  return unifiedSelfCheckResponseContract(ruleIds);
}

function assertActualEvidenceRefs(
  result: ObservedMotionSelfCheckResult,
  acceptanceView: Readonly<Record<string, unknown>>
): void {
  const allowed = actualEvidenceRefs(acceptanceView);
  for (const item of [...result.checks, ...result.issues]) {
    const unavailable = item.evidenceRefs.find((reference) => !allowed.has(reference));
    if (unavailable !== undefined) throw new ProviderError("provider_response",
      `${item.ruleId} references unavailable self-check evidence: ${unavailable}.`);
  }
}

export class VolcengineArkObservedMotionSelfCheckReviewer implements ObservedMotionSelfCheckReviewer {
  readonly #delegate: VolcengineArkUnifiedSelfCheckReviewer;

  constructor(private readonly options: Readonly<{
    apiKey: string;
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    audit?: (record: Readonly<Record<string, unknown>>) => void;
  }>) {
    this.#delegate = new VolcengineArkUnifiedSelfCheckReviewer(options);
  }

  async review(request: Parameters<ObservedMotionSelfCheckReviewer["review"]>[0]): Promise<ObservedMotionSelfCheckResult> {
    return this.#delegate.review(request);
  }
}

export async function loadObservedMotionSelfCheckRule(toolName: ObservedMotionSelfCheckTool): Promise<string> {
  const rule = await readFile(new URL(`../../effect-functions/self-check-rules/tools/${toolName}.md`, import.meta.url), "utf8");
  if (!rule.startsWith(`# ${toolName} 自检规则`) || !rule.includes("## 关键帧合成图")) {
    throw new Error(`${toolName} self-check rule identity is invalid.`);
  }
  return rule;
}

function pipelineFailure(
  config: ObservedMotionToolConfig,
  macroView: Readonly<Record<string, unknown>> | undefined,
  evidenceImages: ObservedMotionSelfCheckView["evidenceImages"],
  error: unknown
): ObservedMotionSelfCheckView {
  const message = error instanceof Error && error.message.trim().length > 0
    ? error.message.replace(/https?:\/\/\S+|[A-Za-z]:\\\S+|\/(?:home|tmp|var)\/\S+/gu, "[已隐藏]").slice(0, 500)
    : "自动自检未能完成。";
  return Object.freeze({
    status: "fail",
    automatic: true,
    toolName: config.toolName,
    ruleVersion: RULE_VERSION,
    evidenceContractVersion: EVIDENCE_CONTRACT_VERSION,
    evidenceStatus: macroView === undefined ? "pending" : "sufficient",
    ...(macroView === undefined ? {} : { macroView }),
    evidenceImages,
    failure: Object.freeze({ code: "SELF_CHECK_PIPELINE_FAILED", message })
  });
}

export async function runObservedMotionSelfCheck(
  config: ObservedMotionToolConfig,
  request: ObservedMotionSelfCheckRequest
): Promise<ObservedMotionSelfCheckArtifacts> {
  let macroView: Readonly<Record<string, unknown>> | undefined;
  let evidenceImages: ObservedMotionSelfCheckView["evidenceImages"] = Object.freeze([]);
  const evidenceFiles = new Map<string, string>();
  try {
    const directory = join(request.outputDirectory, "self-check");
    await mkdir(directory, { recursive: true });
    const plan = candidateFrames(request.durationSeconds, request.fps, request.frameCount, config.candidateCount);
    const extractFrame = request.frameExtractor ?? ((inputPath, outputPath, width, height, time, signal) =>
      extractImage(request.ffmpegPath, inputPath, outputPath, width, height, time, signal));
    const candidates: CandidateFrame[] = [];
    let previousPixels: Uint8ClampedArray | undefined;
    for (let index = 0; index < plan.length; index += 1) {
      const item = plan[index]!;
      const path = join(directory, `observed-${String(index).padStart(3, "0")}.png`);
      await extractFrame(request.videoPath, path, request.width, request.height, item.time, request.signal);
      const candidate = await analyzeFrame(path, item.frame, item.time, previousPixels);
      candidates.push(candidate);
      previousPixels = candidate.pixels;
    }
    if (candidates.length < 3) throw new Error(`${config.toolName} 最终视频没有足够的可解码画面。`);
    const keyframes = config.selectKeyframes(candidates);
    const boardPath = join(directory, "keyframe_contact_sheet.png");
    const board = await keyframeContactSheet(config, keyframes, boardPath, request.width, request.height);
    evidenceFiles.set("keyframe_contact_sheet", boardPath);
    evidenceImages = Object.freeze([Object.freeze({
      evidenceId: "keyframe_contact_sheet",
      label: `${config.displayName}最终 MP4 关键帧合成图`,
      mime: "image/png" as const,
      width: board.width,
      height: board.height
    })]);
    macroView = publicSelfCheckView(config, request, candidates, keyframes);
    if (request.reviewer === undefined) {
      throw new Error("自动自检审查器未配置，证据已生成但不能伪造验收结论。");
    }
    const result = await request.reviewer.review({
      requestId: request.requestId,
      tenantId: request.tenantId,
      userId: request.userId,
      toolName: config.toolName,
      displayName: config.displayName,
      ruleIds: config.ruleIds,
      rule: await loadObservedMotionSelfCheckRule(config.toolName),
      acceptanceView: macroView,
      evidencePng: await readFile(boardPath),
      ...(request.signal === undefined ? {} : { signal: request.signal })
    });
    return Object.freeze({
      view: Object.freeze({
        status: result.status,
        automatic: true,
        toolName: config.toolName,
        ruleVersion: RULE_VERSION,
        evidenceContractVersion: EVIDENCE_CONTRACT_VERSION,
        evidenceStatus: "sufficient",
        macroView,
        evidenceImages,
        result
      }),
      evidenceFiles
    });
  } catch (error) {
    return Object.freeze({ view: pipelineFailure(config, macroView, evidenceImages, error), evidenceFiles });
  }
}
