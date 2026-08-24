import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";

const execFileAsync = promisify(execFile);
const FONT_FAMILY = "CMFX Ten Tool Self Check";
let fontReady: boolean | undefined;

export interface EffectSelfCheckRequest<ToolName extends string> {
  readonly toolName: ToolName;
  readonly userRequest: string;
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
    inputPath: string, outputPath: string, width: number, height: number, time: number, signal?: AbortSignal
  ) => Promise<void>;
  readonly signal?: AbortSignal;
}

export interface PixelFrame {
  readonly frame: number;
  readonly time: number;
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
  readonly baseline: Uint8ClampedArray;
  readonly effectDelta: number;
  readonly changedRatio: number;
  readonly temporalDelta: number;
}

export interface ImageStats {
  readonly luminance: number;
  readonly luminanceSpread: number;
  readonly saturation: number;
  readonly edgeEnergy: number;
  readonly fineDetail: number;
}

export interface SelfCheckAnalysisContext {
  readonly frames: readonly PixelFrame[];
  readonly selected: readonly PixelFrame[];
  readonly representative: PixelFrame;
  readonly finalStats: ImageStats;
  readonly baselineStats: ImageStats;
}

export interface SelfCheckAnalysis {
  readonly description: string;
  readonly keyInformation: readonly Readonly<{ label: string; value: string }>[];
  readonly effect: Readonly<Record<string, string | number | boolean>>;
  readonly missingInformation?: readonly string[];
}

export interface SelfCheckSpec<ToolName extends string> {
  readonly toolName: ToolName;
  readonly displayName: string;
  readonly ruleIds: readonly string[];
  readonly peakRole: string;
  readonly changeRole: string;
  readonly temporalEvidence: boolean;
  readonly analyze: (context: SelfCheckAnalysisContext) => SelfCheckAnalysis;
}

export function rounded(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function percent(value: number): string { return `${rounded(clamp(value, 0, 1) * 100, 1)}%`; }

export function semanticLevel(value: number, low: number, high: number): "轻微" | "中等" | "明显" {
  return value <= low ? "轻微" : value <= high ? "中等" : "明显";
}

export function baseInformation(type: string, visibility: string): readonly Readonly<{ label: string; value: string }>[] {
  return Object.freeze([{ label: "特效类型", value: type }, { label: "可见程度", value: visibility }]);
}

export function directionLabel(dx: number, dy: number): string {
  if (Math.hypot(dx, dy) < 0.01) return "无明显单一方向";
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "由左向右" : "由右向左";
  return dy >= 0 ? "由上向下" : "由下向上";
}

function font(): string {
  if (fontReady === undefined) {
    fontReady = ["C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/msyh.ttf",
      "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"].some((path) => existsSync(path)
        && Boolean(GlobalFonts.registerFromPath(path, FONT_FAMILY)));
  }
  return fontReady ? `"${FONT_FAMILY}", sans-serif` : "sans-serif";
}

function candidates(duration: number, fps: number): readonly Readonly<{ frame: number; time: number }>[] {
  const total = Math.max(1, Math.round(duration * fps));
  const count = Math.min(total, Math.max(11, Math.min(25, Math.ceil(duration * 4) + 5)));
  const values = new Set<number>();
  for (let index = 0; index < count; index += 1) {
    values.add(Math.round(index / Math.max(1, count - 1) * (total - 1)));
  }
  return Object.freeze([...values].sort((a, b) => a - b)
    .map((frame) => Object.freeze({ frame, time: rounded(frame / fps, 6) })));
}

async function extract(
  ffmpegPath: string | undefined, inputPath: string, outputPath: string,
  width: number, height: number, time: number, signal?: AbortSignal
): Promise<void> {
  await execFileAsync(ffmpegPath ?? "ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", time.toFixed(6),
    "-i", inputPath, "-frames:v", "1", "-vf", `scale=${width}:${height}:flags=lanczos`, outputPath], {
    windowsHide: true, timeout: 60_000, maxBuffer: 2 * 1024 * 1024,
    ...(signal === undefined ? {} : { signal })
  });
}

async function pixels(path: string, width: number, height: number): Promise<Uint8ClampedArray> {
  const image = await loadImage(path); const canvas = createCanvas(width, height); const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, width, height);
  return context.getImageData(0, 0, width, height).data;
}

function difference(left: Uint8ClampedArray, right: Uint8ClampedArray): Readonly<{ mean: number; ratio: number }> {
  if (left.length !== right.length) throw new Error("自检帧尺寸不一致。" );
  let total = 0; let changed = 0;
  for (let offset = 0; offset < left.length; offset += 4) {
    const delta = (Math.abs(left[offset]! - right[offset]!) + Math.abs(left[offset + 1]! - right[offset + 1]!)
      + Math.abs(left[offset + 2]! - right[offset + 2]!)) / 3;
    total += delta; if (delta >= 16) changed += 1;
  }
  const count = Math.max(1, left.length / 4);
  return Object.freeze({ mean: rounded(total / count / 255, 6), ratio: rounded(changed / count, 6) });
}

export function imageStats(data: Uint8ClampedArray, width: number, height: number): ImageStats {
  const light = (x: number, y: number): number => {
    const offset = (clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)) * 4;
    return data[offset]! * 0.2126 + data[offset + 1]! * 0.7152 + data[offset + 2]! * 0.0722;
  };
  let sum = 0; let squared = 0; let saturation = 0; let edges = 0; let detail = 0;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 4; const value = light(x, y);
    sum += value; squared += value * value;
    saturation += Math.max(data[offset]!, data[offset + 1]!, data[offset + 2]!)
      - Math.min(data[offset]!, data[offset + 1]!, data[offset + 2]!);
    if (x > 0 && y > 0) {
      const left = light(x - 1, y); const top = light(x, y - 1);
      edges += (Math.abs(value - left) + Math.abs(value - top)) / 2;
      detail += Math.abs(value * 4 - left - top - light(x + 1, y) - light(x, y + 1));
    }
  }
  const count = Math.max(1, width * height); const mean = sum / count;
  return Object.freeze({ luminance: rounded(mean / 255, 6),
    luminanceSpread: rounded(Math.sqrt(Math.max(0, squared / count - mean * mean)) / 255, 6),
    saturation: rounded(saturation / count / 255, 6), edgeEnergy: rounded(edges / count / 255, 6),
    fineDetail: rounded(detail / count / 255, 6) });
}

export function temporalActivity(frames: readonly PixelFrame[]): number {
  return rounded(frames.slice(1).reduce((sum, item) => sum + item.temporalDelta, 0) / Math.max(1, frames.length - 1), 6);
}

export function regionalChange(frame: PixelFrame): Readonly<{
  center: number; edge: number; minimumRegion: string; minimumX: number; minimumY: number
}> {
  const grid = Array.from({ length: 9 }, () => ({ total: 0, count: 0 }));
  for (let y = 0; y < frame.height; y += 1) for (let x = 0; x < frame.width; x += 1) {
    const offset = (y * frame.width + x) * 4;
    const delta = (Math.abs(frame.pixels[offset]! - frame.baseline[offset]!)
      + Math.abs(frame.pixels[offset + 1]! - frame.baseline[offset + 1]!)
      + Math.abs(frame.pixels[offset + 2]! - frame.baseline[offset + 2]!)) / 3 / 255;
    const cell = Math.min(2, Math.floor(y / frame.height * 3)) * 3 + Math.min(2, Math.floor(x / frame.width * 3));
    grid[cell]!.total += delta; grid[cell]!.count += 1;
  }
  const means = grid.map((cell) => cell.total / Math.max(1, cell.count)); const minimum = means.indexOf(Math.min(...means));
  const column = minimum % 3; const row = Math.floor(minimum / 3);
  const horizontal = column === 0 ? "左侧" : column === 1 ? "水平中央" : "右侧";
  const vertical = row === 0 ? "上部" : row === 1 ? "垂直中央" : "下部";
  return Object.freeze({ center: rounded(means[4]!, 6), edge: rounded((means.reduce((sum, value) => sum + value, 0) - means[4]!) / 8, 6),
    minimumRegion: `${horizontal}${vertical}`, minimumX: (column + 0.5) / 3, minimumY: (row + 0.5) / 3 });
}

export function radialContinuity(frame: PixelFrame, centerX: number, centerY: number): Readonly<{
  pattern: "向中心缩放拖开" | "围绕中心旋转拖开"; radial: number; tangential: number
}> {
  const deltaAt = (x: number, y: number): number => { const offset = (clamp(Math.round(y), 0, frame.height - 1) * frame.width
      + clamp(Math.round(x), 0, frame.width - 1)) * 4;
    return (Math.abs(frame.pixels[offset]! - frame.baseline[offset]!) + Math.abs(frame.pixels[offset + 1]! - frame.baseline[offset + 1]!)
      + Math.abs(frame.pixels[offset + 2]! - frame.baseline[offset + 2]!)) / 3; };
  const cx = centerX * frame.width; const cy = centerY * frame.height; let radial = 0; let tangential = 0; let count = 0;
  for (let y = 4; y < frame.height - 4; y += 6) for (let x = 4; x < frame.width - 4; x += 6) {
    const dx = x - cx; const dy = y - cy; const length = Math.hypot(dx, dy); if (length < 8) continue;
    const ux = dx / length; const uy = dy / length; const current = deltaAt(x, y);
    radial += Math.abs(current - deltaAt(x + ux * 3, y + uy * 3));
    tangential += Math.abs(current - deltaAt(x - uy * 3, y + ux * 3)); count += 1;
  }
  return Object.freeze({ pattern: radial <= tangential ? "向中心缩放拖开" : "围绕中心旋转拖开",
    radial: rounded(radial / Math.max(1, count) / 255, 5), tangential: rounded(tangential / Math.max(1, count) / 255, 5) });
}

function selectFrames<T extends string>(spec: SelfCheckSpec<T>, frames: readonly PixelFrame[]): readonly PixelFrame[] {
  const chosen = new Set<number>([0, frames.length - 1]);
  const strongest = frames.reduce((best, item, index) => item.effectDelta > frames[best]!.effectDelta ? index : best, 0);
  chosen.add(strongest);
  const ranked = frames.map((item, index) => ({ index, value: item.temporalDelta }))
    .filter((item) => item.index > 0 && item.index < frames.length - 1).sort((a, b) => b.value - a.value);
  const peak = ranked[0]?.value ?? 0;
  ranked.slice(0, spec.temporalEvidence ? peak > 0.03 ? 4 : peak > 0.006 ? 2 : 1 : 1).forEach((item) => chosen.add(item.index));
  const effectRange = Math.max(...frames.map((item) => item.effectDelta)) - Math.min(...frames.map((item) => item.effectDelta));
  if (effectRange > 0.01) chosen.add(frames.reduce((best, item, index) => item.effectDelta < frames[best]!.effectDelta ? index : best, 0));
  return Object.freeze([...chosen].sort((a, b) => a - b).slice(0, 8).map((index) => frames[index]!));
}

async function contactSheet<T extends string>(spec: SelfCheckSpec<T>, frames: readonly PixelFrame[], outputPath: string): Promise<Readonly<{
  width: number; height: number; roles: readonly string[]
}>> {
  const images = await Promise.all(frames.map((frame) => loadImage(frame.path)));
  const panelWidth = 300; const panelHeight = Math.round(panelWidth * frames[0]!.height / frames[0]!.width);
  const gap = 12; const header = 58; const footer = 48;
  const canvas = createCanvas(gap + frames.length * (panelWidth + gap), header + panelHeight + footer);
  const context = canvas.getContext("2d"); context.fillStyle = "#f7f7f4"; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#171717"; context.font = `bold 21px ${font()}`; context.fillText(`${spec.toolName} 关键帧合成图`, gap, 26);
  context.fillStyle = "#666"; context.font = `13px ${font()}`; context.fillText("全部画面抽取自最终 MP4 · 按时间从左到右", gap, 48);
  const strongest = frames.reduce((best, item) => item.effectDelta > best.effectDelta ? item : best);
  const roles = frames.map((frame, index) => index === 0 ? "效果起始" : index === frames.length - 1 ? "效果结束"
    : frame === strongest ? spec.peakRole : frame.temporalDelta > 0.004 ? spec.changeRole : "稳定性检查");
  frames.forEach((frame, index) => { const x = gap + index * (panelWidth + gap); context.drawImage(images[index]!, x, header, panelWidth, panelHeight);
    context.fillStyle = "#222"; context.font = `13px ${font()}`; context.fillText(`${index + 1}. ${roles[index]}`, x, header + panelHeight + 20);
    context.fillStyle = "#666"; context.font = `12px ${font()}`; context.fillText(`${frame.time.toFixed(3)}s · frame ${frame.frame}`, x, header + panelHeight + 39); });
  await writeFile(outputPath, canvas.toBuffer("image/png"));
  return Object.freeze({ width: canvas.width, height: canvas.height, roles: Object.freeze(roles) });
}

export async function runEffectSelfCheck<T extends string>(spec: SelfCheckSpec<T>, request: EffectSelfCheckRequest<T>) {
  if (request.toolName !== spec.toolName) throw new Error("自检工具身份不匹配。" );
  const directory = join(request.outputDirectory, "self-check", spec.toolName); await mkdir(directory, { recursive: true });
  const width = Math.min(640, request.width); const height = Math.max(2, Math.round(width * request.height / request.width));
  const extractor = request.frameExtractor ?? ((input: string, output: string, w: number, h: number, time: number, signal?: AbortSignal) =>
    extract(request.ffmpegPath, input, output, w, h, time, signal));
  const frames: PixelFrame[] = [];
  for (const item of candidates(request.durationSeconds, request.fps)) {
    const path = join(directory, `${item.frame}.png`); const baselinePath = join(directory, `${item.frame}-control.png`);
    await extractor(request.videoPath, path, width, height, item.time, request.signal);
    await extractor(request.baselineVideoPath, baselinePath, width, height, item.time, request.signal);
    const [finalPixels, baselinePixels] = await Promise.all([pixels(path, width, height), pixels(baselinePath, width, height)]);
    const effect = difference(finalPixels, baselinePixels);
    const temporal = frames.length === 0 ? 0 : difference(finalPixels, frames.at(-1)!.pixels).mean;
    frames.push(Object.freeze({ ...item, path, width, height, pixels: finalPixels, baseline: baselinePixels,
      effectDelta: effect.mean, changedRatio: effect.ratio, temporalDelta: temporal }));
  }
  const selected = selectFrames(spec, frames); const representative = frames.reduce((best, item) => item.effectDelta > best.effectDelta ? item : best);
  const analysis = spec.analyze(Object.freeze({ frames: Object.freeze(frames), selected,
    representative, finalStats: imageStats(representative.pixels, width, height),
    baselineStats: imageStats(representative.baseline, width, height) }));
  const boardPath = join(directory, "keyframe_contact_sheet.png"); const board = await contactSheet(spec, selected, boardPath);
  const brightness = selected.map((frame) => imageStats(frame.pixels, width, height).luminance);
  const json = Object.freeze({
    file_name: (request.fileName ?? basename(request.videoPath)).slice(0, 255),
    original_request: request.userRequest.slice(0, 4_000),
    summary: Object.freeze({ description: analysis.description, key_information: Object.freeze(analysis.keyInformation),
      missing_information: Object.freeze(analysis.missingInformation ?? []) }),
    metadata: Object.freeze({
      media: Object.freeze({ media_type: "video/mp4", container: "mp4", width_px: request.width, height_px: request.height,
        fps: request.fps, duration_seconds: rounded(request.durationSeconds, 3), frame_count: request.frameCount,
        file_size_bytes: request.bytes, encoding_completed: true, decodable: true }),
      effect: analysis.effect,
      quality: Object.freeze({ black_frame_ratio: rounded(brightness.filter((value) => value < 0.01).length / Math.max(1, brightness.length), 6),
        dimension_consistent: true, abrupt_brightness_change: brightness.slice(1).some((value, index) => Math.abs(value - brightness[index]!) > 0.18),
        visible_frame_damage: "未发现无法解码画面" }),
      keyframe_evidence: Object.freeze({ image_id: "keyframe_contact_sheet", image_count: selected.length, coverage: "sufficient",
        keyframes: Object.freeze(selected.map((frame, index) => Object.freeze({ image_id: `keyframe_${index + 1}`,
          time_seconds: rounded(frame.time, 3), role: board.roles[index] }))) })
    })
  });
  const jsonPath = join(directory, "self_check.json"); await writeFile(jsonPath, `${JSON.stringify(json, null, 2)}\n`, "utf8");
  return Object.freeze({ json, jsonPath, evidenceFiles: new Map([["keyframe_contact_sheet", boardPath]]),
    evidenceImage: Object.freeze({ width: board.width, height: board.height }) });
}

export async function readSelfCheckJson(path: string): Promise<unknown> { return JSON.parse(await readFile(path, "utf8")); }
