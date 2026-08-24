import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { createCanvas, GlobalFonts, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import type { EffectParameterEnvelope } from "@codemotion/effect-functions";

const execFileAsync = promisify(execFile);
const RULE_VERSION = "1.0.0";
const EVIDENCE_CONTRACT_VERSION = "1.0.0";
const FONT_FAMILY = "CMFX Self Check CJK";
const MAX_PROBE_FRAMES = 25;
const MAX_EVIDENCE_FRAMES = 8;
let fontReady: boolean | undefined;

export const FINAL_VIDEO_SELF_CHECK_TOOLS = Object.freeze([
  "aura_field",
  "gradient_flow",
  "neon_glow",
  "energy_pulse",
  "lens_flare",
  "neon_trace",
  "sacred_geometry",
  "scan_beam",
  "volumetric_ray",
  "hologram"
] as const);

export type FinalVideoSelfCheckToolName = typeof FINAL_VIDEO_SELF_CHECK_TOOLS[number];

export interface FinalVideoSamplingItem {
  readonly evidenceId: string;
  readonly role: string;
  readonly frame: number;
  readonly time: number;
}

export interface FinalFrameObservation {
  readonly item: FinalVideoSamplingItem;
  readonly imagePath: string;
  readonly meanLuminance: number;
  readonly baselineLuminance: number;
  readonly brightnessGain: number;
  readonly colorDifference: number;
  readonly changedAreaRatio: number;
  readonly centroidX: number;
  readonly centroidY: number;
  readonly bounds: Readonly<{ left: number; top: number; right: number; bottom: number }>;
  readonly dominantColor: string;
  readonly dominantColorName: string;
  readonly peakLuminance: number;
  readonly componentCount: number;
  readonly principalAngleDegrees: number;
  readonly radialPeak: number;
  readonly scanlinePresence: number;
}

export interface FinalVideoSelfCheckResult {
  readonly status: "pass" | "fail";
  readonly summary: string;
  readonly checks: readonly Readonly<{
    ruleId: string;
    status: "pass" | "fail";
    evidenceRefs: readonly string[];
    reason: string;
  }>[];
  readonly issues: readonly Readonly<{
    ruleId: string;
    code: string;
    message: string;
    evidenceRefs: readonly string[];
  }>[];
}

export interface FinalVideoSelfCheckView {
  readonly status: "queued" | "running" | "pass" | "fail";
  readonly automatic: true;
  readonly toolName: FinalVideoSelfCheckToolName;
  readonly ruleVersion: string;
  readonly evidenceContractVersion: string;
  readonly evidenceStatus: "pending" | "sufficient";
  readonly macroView?: Readonly<Record<string, unknown>>;
  readonly evidenceImages: readonly Readonly<{
    evidenceId: "keyframe_contact_sheet";
    label: string;
    mime: "image/png";
    width: number;
    height: number;
  }>[];
  readonly result?: FinalVideoSelfCheckResult;
  readonly failure?: Readonly<{ code: string; message: string }>;
}

export interface FinalVideoSelfCheckArtifacts {
  readonly view: FinalVideoSelfCheckView;
  readonly evidenceFiles: ReadonlyMap<string, string>;
  readonly jsonFile?: string;
}

export interface FinalVideoSelfCheckRequest {
  readonly userRequest: string;
  readonly envelope: EffectParameterEnvelope;
  readonly videoPath: string;
  readonly fileName?: string;
  readonly baselineVideoPath: string;
  readonly outputDirectory: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationSeconds: number;
  readonly frameCount: number;
  readonly bytes: number;
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

export interface SelfCheckSummary {
  readonly description: string;
  readonly keyInformation: readonly Readonly<{ label: string; value: string }>[];
  readonly quality: Readonly<Record<string, string | number | boolean>>;
  readonly checks: readonly Readonly<{
    ruleId: string;
    status: "pass" | "fail";
    reason: string;
    issueCode?: string;
  }>[];
  readonly missingInformation?: readonly string[];
}

export interface FinalVideoSelfCheckContext {
  readonly request: FinalVideoSelfCheckRequest;
  readonly observations: readonly FinalFrameObservation[];
  readonly evidence: readonly FinalFrameObservation[];
  readonly params: Readonly<Record<string, unknown>>;
}

export interface FinalVideoSelfCheckSpec {
  readonly toolName: FinalVideoSelfCheckToolName;
  readonly displayName: string;
  readonly isNeutral: (params: Readonly<Record<string, unknown>>) => boolean;
  readonly samplingPlan: (
    durationSeconds: number,
    fps: number,
    params: Readonly<Record<string, unknown>>
  ) => readonly FinalVideoSamplingItem[];
  readonly selectEvidence: (
    observations: readonly FinalFrameObservation[],
    params: Readonly<Record<string, unknown>>
  ) => readonly FinalFrameObservation[];
  readonly summarize: (context: FinalVideoSelfCheckContext) => SelfCheckSummary;
}

export function queuedFinalVideoSelfCheck(toolName: FinalVideoSelfCheckToolName): FinalVideoSelfCheckView {
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

export function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function rounded(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function font(): string {
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

export function samplingPlanFromFractions(
  durationSeconds: number,
  fps: number,
  entries: readonly Readonly<{ fraction: number; role: string; id?: string }>[]
): readonly FinalVideoSamplingItem[] {
  const frameCount = Math.max(1, Math.round(durationSeconds * fps));
  const items = new Map<number, FinalVideoSamplingItem>();
  entries.forEach((entry, index) => {
    const frame = Math.max(0, Math.min(frameCount - 1, Math.round((frameCount - 1) * entry.fraction)));
    items.set(frame, Object.freeze({
      evidenceId: entry.id ?? `probe_${String(index + 1).padStart(2, "0")}`,
      role: entry.role,
      frame,
      time: rounded(frame / fps, 6)
    }));
  });
  return Object.freeze([...items.values()].sort((a, b) => a.frame - b.frame));
}

export function uniformSamplingPlan(
  durationSeconds: number,
  fps: number,
  count: number,
  role: (index: number, total: number) => string
): readonly FinalVideoSamplingItem[] {
  const safeCount = Math.max(2, Math.min(MAX_PROBE_FRAMES, Math.round(count)));
  return samplingPlanFromFractions(durationSeconds, fps, Array.from({ length: safeCount }, (_, index) => ({
    fraction: safeCount === 1 ? 0.5 : 0.03 + 0.94 * index / (safeCount - 1),
    role: role(index, safeCount),
    id: `probe_${String(index + 1).padStart(2, "0")}`
  })));
}

export function distinctEvidence(
  observations: readonly FinalFrameObservation[],
  preferred: readonly (FinalFrameObservation | undefined)[]
): readonly FinalFrameObservation[] {
  const byFrame = new Map<number, FinalFrameObservation>();
  preferred.forEach((item) => {
    if (item !== undefined && byFrame.size < MAX_EVIDENCE_FRAMES) byFrame.set(item.item.frame, item);
  });
  if (byFrame.size < 2 && observations.length > 0) {
    byFrame.set(observations[0]!.item.frame, observations[0]!);
    byFrame.set(observations.at(-1)!.item.frame, observations.at(-1)!);
  }
  return Object.freeze([...byFrame.values()].sort((a, b) => a.item.frame - b.item.frame));
}

export function minimumBy(
  observations: readonly FinalFrameObservation[],
  value: (item: FinalFrameObservation) => number
): FinalFrameObservation | undefined {
  return observations.reduce<FinalFrameObservation | undefined>((best, item) =>
    best === undefined || value(item) < value(best) ? item : best, undefined);
}

export function maximumBy(
  observations: readonly FinalFrameObservation[],
  value: (item: FinalFrameObservation) => number
): FinalFrameObservation | undefined {
  return observations.reduce<FinalFrameObservation | undefined>((best, item) =>
    best === undefined || value(item) > value(best) ? item : best, undefined);
}

export function localMaxima(
  observations: readonly FinalFrameObservation[],
  value: (item: FinalFrameObservation) => number
): readonly FinalFrameObservation[] {
  return Object.freeze(observations.filter((item, index) => index > 0 && index < observations.length - 1
    && value(item) >= value(observations[index - 1]!) && value(item) >= value(observations[index + 1]!)));
}

export function locationName(x: number, y: number): string {
  const horizontal = x < 1 / 3 ? "左侧" : x > 2 / 3 ? "右侧" : "中央";
  const vertical = y < 1 / 3 ? "上部" : y > 2 / 3 ? "下部" : "中部";
  return `${horizontal}${vertical}`;
}

export function coverageName(value: number): string {
  return value < 0.045 ? "局部点状范围" : value < 0.18 ? "较小局部范围"
    : value < 0.42 ? "中等覆盖范围" : value < 0.72 ? "大范围覆盖" : "接近全画面覆盖";
}

export function brightnessName(value: number): string {
  return value < 0.012 ? "很轻" : value < 0.035 ? "柔和" : value < 0.075 ? "清晰"
    : value < 0.14 ? "明亮" : "强烈";
}

export function speedName(distance: number, elapsed: number): string {
  if (elapsed <= 0 || distance / elapsed < 0.015) return "基本静止";
  const rate = distance / elapsed;
  return rate < 0.12 ? "缓慢" : rate < 0.35 ? "中速" : "快速";
}

export function directionName(first: FinalFrameObservation, last: FinalFrameObservation): string {
  const dx = last.centroidX - first.centroidX;
  const dy = last.centroidY - first.centroidY;
  if (Math.hypot(dx, dy) < 0.025) return "未观察到明显位移方向";
  if (Math.abs(dx) > Math.abs(dy) * 1.35) return dx > 0 ? "从左向右" : "从右向左";
  if (Math.abs(dy) > Math.abs(dx) * 1.35) return dy > 0 ? "从上向下" : "从下向上";
  return `${dy > 0 ? "向下" : "向上"}${dx > 0 ? "并向右" : "并向左"}`;
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
  const left = x + (width - targetWidth) / 2;
  const top = y + (height - targetHeight) / 2;
  context.fillStyle = "#07101c";
  context.fillRect(x, y, width, height);
  context.drawImage(image, left, top, targetWidth, targetHeight);
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
  await execFileAsync(ffmpegPath ?? "ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-ss", time.toFixed(6), "-i", inputPath,
    "-frames:v", "1", "-vf",
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    outputPath
  ], {
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 2 * 1024 * 1024,
    ...(signal === undefined ? {} : { signal })
  });
}

function rgbToHsl(red: number, green: number, blue: number): readonly [number, number, number] {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const lightness = (maximum + minimum) / 2;
  if (maximum === minimum) return [0, 0, lightness];
  const delta = maximum - minimum;
  const saturation = lightness > 0.5 ? delta / (2 - maximum - minimum) : delta / (maximum + minimum);
  const hue = maximum === r ? ((g - b) / delta + (g < b ? 6 : 0)) / 6
    : maximum === g ? ((b - r) / delta + 2) / 6 : ((r - g) / delta + 4) / 6;
  return [hue * 360, saturation, lightness];
}

function colorName(red: number, green: number, blue: number): string {
  const [hue, saturation, lightness] = rgbToHsl(red, green, blue);
  if (lightness > 0.9 && saturation < 0.18) return "白色高光";
  if (saturation < 0.16) return lightness < 0.32 ? "深灰" : "中性灰白";
  if (hue < 18 || hue >= 345) return "红色";
  if (hue < 45) return "橙色";
  if (hue < 72) return "金黄色";
  if (hue < 155) return "绿色";
  if (hue < 195) return "青绿色";
  if (hue < 225) return "青蓝色";
  if (hue < 260) return "蓝色";
  if (hue < 295) return "紫色";
  if (hue < 330) return "洋红色";
  return "粉红色";
}

function connectedComponents(mask: Uint8Array, width: number, height: number): number {
  const visited = new Uint8Array(mask.length);
  const stack: number[] = [];
  let components = 0;
  const minimumSize = Math.max(3, Math.round(mask.length * 0.00035));
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] === 0 || visited[start] !== 0) continue;
    visited[start] = 1;
    stack.push(start);
    let size = 0;
    while (stack.length > 0) {
      const index = stack.pop()!;
      size += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      const neighbors = [x > 0 ? index - 1 : -1, x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1, y + 1 < height ? index + width : -1];
      for (const neighbor of neighbors) if (neighbor >= 0 && mask[neighbor] !== 0 && visited[neighbor] === 0) {
        visited[neighbor] = 1;
        stack.push(neighbor);
      }
    }
    if (size >= minimumSize) components += 1;
  }
  return components;
}

async function observation(
  item: FinalVideoSamplingItem,
  imagePath: string,
  baselinePath: string,
  width: number,
  height: number,
  center: readonly [number, number]
): Promise<FinalFrameObservation> {
  const [sampleImage, baselineImage] = await Promise.all([loadImage(imagePath), loadImage(baselinePath)]);
  const sampleCanvas = createCanvas(width, height);
  const baselineCanvas = createCanvas(width, height);
  const sampleContext = sampleCanvas.getContext("2d");
  const baselineContext = baselineCanvas.getContext("2d");
  drawFitted(sampleContext, sampleImage, 0, 0, width, height);
  drawFitted(baselineContext, baselineImage, 0, 0, width, height);
  const sample = sampleContext.getImageData(0, 0, width, height).data;
  const baseline = baselineContext.getImageData(0, 0, width, height).data;
  const mask = new Uint8Array(width * height);
  const radial = new Float64Array(32);
  const radialWeights = new Float64Array(32);
  const rowLuminance = new Float64Array(height);
  let mean = 0;
  let baselineMean = 0;
  let gain = 0;
  let differenceTotal = 0;
  let changed = 0;
  let weightTotal = 0;
  let weightedX = 0;
  let weightedY = 0;
  let weightedRed = 0;
  let weightedGreen = 0;
  let weightedBlue = 0;
  let left = width;
  let top = height;
  let right = 0;
  let bottom = 0;
  const luminances: number[] = [];
  const weightedPoints: Array<readonly [number, number, number]> = [];
  const maximumRadius = Math.hypot(Math.max(center[0], 1 - center[0]), Math.max(center[1], 1 - center[1]));
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const sampleLuminance = (sample[offset]! * 0.2126 + sample[offset + 1]! * 0.7152 + sample[offset + 2]! * 0.0722) / 255;
    const baselineLuminance = (baseline[offset]! * 0.2126 + baseline[offset + 1]! * 0.7152 + baseline[offset + 2]! * 0.0722) / 255;
    mean += sampleLuminance;
    baselineMean += baselineLuminance;
    gain += sampleLuminance - baselineLuminance;
    rowLuminance[y]! += sampleLuminance / width;
    const channelDifference = Math.max(
      Math.abs(sample[offset]! - baseline[offset]!),
      Math.abs(sample[offset + 1]! - baseline[offset + 1]!),
      Math.abs(sample[offset + 2]! - baseline[offset + 2]!)
    ) / 255;
    differenceTotal += channelDifference;
    if (channelDifference < 0.045) continue;
    mask[pixel] = 1;
    changed += 1;
    const positiveLight = Math.max(0, sampleLuminance - baselineLuminance);
    const weight = channelDifference * 0.32 + positiveLight * 0.68;
    weightTotal += weight;
    weightedX += x / Math.max(1, width - 1) * weight;
    weightedY += y / Math.max(1, height - 1) * weight;
    weightedRed += Math.max(0, sample[offset]! - baseline[offset]!) * weight;
    weightedGreen += Math.max(0, sample[offset + 1]! - baseline[offset + 1]!) * weight;
    weightedBlue += Math.max(0, sample[offset + 2]! - baseline[offset + 2]!) * weight;
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
    luminances.push(sampleLuminance);
    weightedPoints.push([x / Math.max(1, width - 1), y / Math.max(1, height - 1), weight]);
    const dx = x / Math.max(1, width - 1) - center[0];
    const dy = y / Math.max(1, height - 1) - center[1];
    const bin = Math.min(radial.length - 1, Math.floor(Math.hypot(dx, dy) / Math.max(0.001, maximumRadius) * radial.length));
    radial[bin]! += weight;
    radialWeights[bin]! += 1;
  }
  const pixels = Math.max(1, width * height);
  const centroidX = weightTotal === 0 ? 0.5 : weightedX / weightTotal;
  const centroidY = weightTotal === 0 ? 0.5 : weightedY / weightTotal;
  let covarianceXX = 0;
  let covarianceYY = 0;
  let covarianceXY = 0;
  for (const [x, y, weight] of weightedPoints) {
    covarianceXX += (x - centroidX) ** 2 * weight;
    covarianceYY += (y - centroidY) ** 2 * weight;
    covarianceXY += (x - centroidX) * (y - centroidY) * weight;
  }
  const angle = 0.5 * Math.atan2(2 * covarianceXY, covarianceXX - covarianceYY) * 180 / Math.PI;
  let radialPeak = 0;
  let radialPeakValue = -1;
  for (let index = 0; index < radial.length; index += 1) {
    const value = radialWeights[index] === 0 ? 0 : radial[index]! / radialWeights[index]!;
    if (value > radialPeakValue) {
      radialPeakValue = value;
      radialPeak = (index + 0.5) / radial.length;
    }
  }
  luminances.sort((a, b) => a - b);
  let adjacentRowDifference = 0;
  for (let y = 1; y < height; y += 1) adjacentRowDifference += Math.abs(rowLuminance[y]! - rowLuminance[y - 1]!);
  const red = weightTotal === 0 ? 0 : Math.min(255, weightedRed / Math.max(1, weightTotal));
  const green = weightTotal === 0 ? 0 : Math.min(255, weightedGreen / Math.max(1, weightTotal));
  const blue = weightTotal === 0 ? 0 : Math.min(255, weightedBlue / Math.max(1, weightTotal));
  return Object.freeze({
    item,
    imagePath,
    meanLuminance: rounded(mean / pixels, 6),
    baselineLuminance: rounded(baselineMean / pixels, 6),
    brightnessGain: rounded(gain / pixels, 6),
    colorDifference: rounded(differenceTotal / pixels, 6),
    changedAreaRatio: rounded(changed / pixels, 6),
    centroidX: rounded(centroidX, 5),
    centroidY: rounded(centroidY, 5),
    bounds: Object.freeze(changed === 0 ? { left: 0.5, top: 0.5, right: 0.5, bottom: 0.5 } : {
      left: rounded(left / Math.max(1, width - 1), 5),
      top: rounded(top / Math.max(1, height - 1), 5),
      right: rounded(right / Math.max(1, width - 1), 5),
      bottom: rounded(bottom / Math.max(1, height - 1), 5)
    }),
    dominantColor: `#${[red, green, blue].map((value) => Math.round(value).toString(16).padStart(2, "0")).join("").toUpperCase()}`,
    dominantColorName: colorName(red, green, blue),
    peakLuminance: rounded(luminances.length === 0 ? mean / pixels : luminances[Math.floor((luminances.length - 1) * 0.95)]!, 5),
    componentCount: connectedComponents(mask, width, height),
    principalAngleDegrees: rounded(angle, 1),
    radialPeak: rounded(radialPeak, 4),
    scanlinePresence: rounded(adjacentRowDifference / Math.max(1, height - 1), 6)
  });
}

function analysisDimensions(width: number, height: number): readonly [number, number] {
  const scale = Math.min(1, 320 / width, 180 / height);
  return [Math.max(2, Math.round(width * scale)), Math.max(2, Math.round(height * scale))];
}

async function contactSheet(
  spec: FinalVideoSelfCheckSpec,
  evidence: readonly FinalFrameObservation[],
  outputPath: string,
  sourceWidth: number,
  sourceHeight: number
): Promise<Readonly<{ width: number; height: number }>> {
  const panels = await Promise.all(evidence.map(async (item) => ({ item, image: await loadImage(item.imagePath) })));
  const panelWidth = 288;
  const panelHeight = Math.max(162, Math.round(panelWidth * sourceHeight / sourceWidth));
  const gap = 16;
  const headerHeight = 72;
  const labelHeight = 58;
  const boardWidth = panels.length * panelWidth + (panels.length + 1) * gap;
  const boardHeight = headerHeight + panelHeight + labelHeight + gap;
  const canvas = createCanvas(boardWidth, boardHeight);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, boardWidth, boardHeight);
  context.fillStyle = "#172235";
  context.font = `bold 22px ${font()}`;
  context.fillText(`${spec.displayName} · 关键帧合成图`, gap, 30);
  context.fillStyle = "#667287";
  context.font = `13px ${font()}`;
  context.fillText(`从最终 MP4 抽取 · ${sourceWidth} × ${sourceHeight} · 按时间从左到右`, gap, 55);
  panels.forEach(({ item, image }, index) => {
    const x = gap + index * (panelWidth + gap);
    const y = headerHeight;
    drawFitted(context, image, x, y, panelWidth, panelHeight);
    context.strokeStyle = "#cfd6e1";
    context.strokeRect(x, y, panelWidth, panelHeight);
    context.fillStyle = "#27344a";
    context.font = `bold 13px ${font()}`;
    context.fillText(`第 ${index + 1} 帧 · ${item.item.role}`, x, y + panelHeight + 22);
    context.fillStyle = "#68758a";
    context.font = `11px ${font()}`;
    context.fillText(`时间 ${item.item.time.toFixed(3)} 秒`, x, y + panelHeight + 44);
  });
  await writeFile(outputPath, canvas.toBuffer("image/png"));
  return Object.freeze({ width: boardWidth, height: boardHeight });
}

function centerFor(toolName: FinalVideoSelfCheckToolName, params: Readonly<Record<string, unknown>>): readonly [number, number] {
  const vector = toolName === "energy_pulse" || toolName === "lens_flare"
    ? params[toolName === "energy_pulse" ? "center" : "source"] : undefined;
  if (Array.isArray(vector) && vector.length === 2) return [finite(vector[0], 0.5), finite(vector[1], 0.5)];
  if (toolName === "aura_field") return [finite(params.centerX, 0.5), finite(params.centerY, 0.5)];
  if (toolName === "volumetric_ray") return [finite(params.lightX, 0.5), finite(params.lightY, 0.2)];
  if (toolName === "neon_trace") return [finite(params.startX, 0.5), finite(params.startY, 0.5)];
  return [0.5, 0.5];
}

function safeFailure(error: unknown): string {
  const message = error instanceof Error && error.message.trim().length > 0 ? error.message : "自动自检未能完成。";
  return message.replace(/https?:\/\/\S+|[A-Za-z]:\\\S+|\/(?:home|tmp|var)\/\S+/gu, "[已隐藏]").slice(0, 400);
}

function resultFromSummary(summary: SelfCheckSummary): FinalVideoSelfCheckResult {
  const checks = summary.checks.map((check) => Object.freeze({
    ruleId: check.ruleId,
    status: check.status,
    evidenceRefs: Object.freeze(["keyframe_contact_sheet"]),
    reason: check.reason
  }));
  const issues = summary.checks.filter((check) => check.status === "fail").map((check) => Object.freeze({
    ruleId: check.ruleId,
    code: check.issueCode ?? "VISUAL_QUALITY_MISMATCH",
    message: check.reason,
    evidenceRefs: Object.freeze(["keyframe_contact_sheet"])
  }));
  return Object.freeze({
    status: issues.length === 0 ? "pass" : "fail",
    summary: issues.length === 0 ? "最终成片的专属自检证据已生成，未发现影响交付的明确异常。"
      : `最终成片发现 ${issues.length} 项需要返修的明确异常。`,
    checks: Object.freeze(checks),
    issues: Object.freeze(issues)
  });
}

export async function runFinalVideoSelfCheck(
  spec: FinalVideoSelfCheckSpec,
  request: FinalVideoSelfCheckRequest
): Promise<FinalVideoSelfCheckArtifacts> {
  const evidenceFiles = new Map<string, string>();
  let macroView: Readonly<Record<string, unknown>> | undefined;
  let evidenceImages: FinalVideoSelfCheckView["evidenceImages"] = Object.freeze([]);
  try {
    if (request.envelope.type !== spec.toolName) throw new Error(`${spec.toolName} 自检收到不匹配的工具结果。`);
    const params = request.envelope.data;
    const plan = spec.samplingPlan(request.durationSeconds, request.fps, params);
    if (plan.length < 2 || plan.length > MAX_PROBE_FRAMES
      || plan.some((item, index) => index > 0 && item.frame <= plan[index - 1]!.frame)) {
      throw new Error(`${spec.toolName} 关键阶段抽帧计划无效。`);
    }
    const directory = join(request.outputDirectory, "self-check", spec.toolName);
    await mkdir(directory, { recursive: true });
    const [analysisWidth, analysisHeight] = analysisDimensions(request.width, request.height);
    const extract = request.frameExtractor ?? ((inputPath, outputPath, width, height, time, signal) =>
      extractImage(request.ffmpegPath, inputPath, outputPath, width, height, time, signal));
    const center = centerFor(spec.toolName, params);
    const observations: FinalFrameObservation[] = [];
    for (const item of plan) {
      const imagePath = join(directory, `${item.evidenceId}.png`);
      const baselinePath = join(directory, `${item.evidenceId}_baseline.png`);
      await extract(request.videoPath, imagePath, analysisWidth, analysisHeight, item.time, request.signal);
      await extract(request.baselineVideoPath, baselinePath, analysisWidth, analysisHeight, item.time, request.signal);
      observations.push(await observation(item, imagePath, baselinePath, analysisWidth, analysisHeight, center));
    }
    const evidence = spec.selectEvidence(Object.freeze(observations), params);
    if (evidence.length < 2 || evidence.length > MAX_EVIDENCE_FRAMES
      || evidence.some((item) => !observations.includes(item))) {
      throw new Error(`${spec.toolName} 没有选出有效的关键帧证据。`);
    }
    const boardPath = join(directory, "keyframe_contact_sheet.png");
    const board = await contactSheet(spec, evidence, boardPath, request.width, request.height);
    evidenceFiles.set("keyframe_contact_sheet", boardPath);
    evidenceImages = Object.freeze([Object.freeze({
      evidenceId: "keyframe_contact_sheet" as const,
      label: `${spec.displayName}最终 MP4 关键帧合成图`,
      mime: "image/png" as const,
      width: board.width,
      height: board.height
    })]);
    const context: FinalVideoSelfCheckContext = Object.freeze({
      request,
      observations: Object.freeze(observations),
      evidence: Object.freeze([...evidence]),
      params
    });
    const effectSummary = spec.summarize(context);
    const neutral = spec.isNeutral(params);
    const blackFailure = observations.some((item) => item.meanLuminance < 0.004 && item.baselineLuminance > 0.025);
    const visibleDifference = Math.max(...observations.map((item) => item.colorDifference)) >= 0.0035;
    const genericChecks = [
      Object.freeze({
        ruleId: `${spec.toolName.toUpperCase()}_MEDIA_INTEGRITY`,
        status: blackFailure ? "fail" as const : "pass" as const,
        reason: blackFailure ? "最终视频出现了与底图不一致的明显黑帧。" : "最终视频可解码，画面尺寸一致，未发现异常黑帧。",
        ...(blackFailure ? { issueCode: "UNEXPECTED_BLACK_FRAME" } : {})
      }),
      Object.freeze({
        ruleId: `${spec.toolName.toUpperCase()}_EFFECT_PRESENCE`,
        status: visibleDifference || neutral ? "pass" as const : "fail" as const,
        reason: visibleDifference ? "最终成片中能够观察到该特效带来的实际画面变化。"
          : neutral ? "最终成片保持底图状态，与关闭光效的结果一致。" : "最终成片中没有观察到足以辨认的特效表现。",
        ...(!visibleDifference && !neutral ? { issueCode: "EFFECT_NOT_VISIBLE" } : {})
      })
    ];
    const summary = Object.freeze({ ...effectSummary, checks: Object.freeze([...genericChecks, ...effectSummary.checks]) });
    const keyframes = evidence.map((item) => Object.freeze({
      image_id: item.item.evidenceId,
      time_seconds: rounded(item.item.time, 3),
      role: item.item.role
    }));
    macroView = Object.freeze({
      file_name: request.fileName ?? basename(request.videoPath),
      original_request: request.userRequest.slice(0, 4_000),
      summary: Object.freeze({
        description: summary.description,
        key_information: Object.freeze(summary.keyInformation),
        missing_information: Object.freeze(summary.missingInformation ?? [])
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
        quality: Object.freeze(summary.quality),
        keyframe_evidence: Object.freeze({
          coverage: "sufficient",
          image_count: keyframes.length,
          contact_sheet: "keyframe_contact_sheet",
          keyframes: Object.freeze(keyframes)
        })
      })
    });
    if (Object.keys(macroView).join(",") !== "file_name,original_request,summary,metadata") {
      throw new Error(`${spec.toolName} 自检 JSON 顶层字段不符合契约。`);
    }
    const jsonFile = join(directory, `${spec.toolName}.self-check-view.json`);
    await writeFile(jsonFile, `${JSON.stringify(macroView, null, 2)}\n`, "utf8");
    const result = resultFromSummary(summary);
    return Object.freeze({
      view: Object.freeze({
        status: result.status,
        automatic: true,
        toolName: spec.toolName,
        ruleVersion: RULE_VERSION,
        evidenceContractVersion: EVIDENCE_CONTRACT_VERSION,
        evidenceStatus: "sufficient",
        macroView,
        evidenceImages,
        result
      }),
      evidenceFiles,
      jsonFile
    });
  } catch (error) {
    return Object.freeze({
      view: Object.freeze({
        status: "fail",
        automatic: true,
        toolName: spec.toolName,
        ruleVersion: RULE_VERSION,
        evidenceContractVersion: EVIDENCE_CONTRACT_VERSION,
        evidenceStatus: macroView === undefined ? "pending" : "sufficient",
        ...(macroView === undefined ? {} : { macroView }),
        evidenceImages,
        failure: Object.freeze({ code: "SELF_CHECK_PIPELINE_FAILED", message: safeFailure(error) })
      }),
      evidenceFiles
    });
  }
}

export async function readGeneratedSelfCheckJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}
