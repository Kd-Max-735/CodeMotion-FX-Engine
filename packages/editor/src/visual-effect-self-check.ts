import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { createCanvas, GlobalFonts, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { ARK_V1_MODEL, ProviderError } from "@codemotion/ai-planner";
import { selfCheckDisplacementMap } from "./self-checks/displacement-map-self-check.js";
import { selfCheckFractal } from "./self-checks/fractal-self-check.js";
import { selfCheckGlass } from "./self-checks/glass-self-check.js";
import { selfCheckImageDepthParallax } from "./self-checks/image-depth-parallax-self-check.js";
import { selfCheckKaleidoscope } from "./self-checks/kaleidoscope-self-check.js";
import { selfCheckLiquidDisplace } from "./self-checks/liquid-displace-self-check.js";
import { selfCheckPathMorph } from "./self-checks/path-morph-self-check.js";
import { selfCheckTurbulentDisplace } from "./self-checks/turbulent-displace-self-check.js";
import { selfCheckWaveSurface } from "./self-checks/wave-surface-self-check.js";
import { selfCheckWaveWarp } from "./self-checks/wave-warp-self-check.js";

const execFileAsync = promisify(execFile);
const EVIDENCE_FONT_FAMILY = "CMFX CJK";
const RULE_VERSION = "1.0.0";
const EVIDENCE_CONTRACT_VERSION = "1.0.0";
const DEFAULT_ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const MAX_REVIEW_TEXT = 2_000;
let evidenceFontReady: boolean | undefined;

export const VISUAL_SELF_CHECK_TOOLS = Object.freeze([
  "displacement_map",
  "kaleidoscope",
  "liquid_displace",
  "fractal",
  "glass",
  "image_depth_parallax",
  "path_morph",
  "turbulent_displace",
  "wave_warp",
  "wave_surface"
] as const);

export type VisualSelfCheckToolName = typeof VISUAL_SELF_CHECK_TOOLS[number];

export interface VisualSelfCheckResult {
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

export interface VisualEffectSelfCheckView {
  readonly status: "queued" | "running" | "pass" | "fail";
  readonly automatic: true;
  readonly toolName: VisualSelfCheckToolName;
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
  readonly result?: VisualSelfCheckResult;
  readonly failure?: Readonly<{ code: string; message: string }>;
}

export interface VisualSelfCheckReviewer {
  review(request: Readonly<{
    requestId: string;
    tenantId: string;
    userId: string;
    rule: string;
    acceptanceView: Readonly<Record<string, unknown>>;
    evidencePng: Buffer;
    signal?: AbortSignal;
  }>): Promise<VisualSelfCheckResult>;
}

export interface VisualSelfCheckArtifacts {
  readonly view: VisualEffectSelfCheckView;
  readonly evidenceFiles: ReadonlyMap<string, string>;
}

export interface VisualFrameSample {
  readonly frame: number;
  readonly time: number;
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
}

export interface FrameSignals {
  readonly luminance: number;
  readonly contrast: number;
  readonly edgeX: number;
  readonly edgeY: number;
  readonly colorSeparation: number;
  readonly centerBrightness: number;
  readonly borderBrightness: number;
  readonly mirrorAgreement: number;
  readonly darkRatio: number;
}

export interface AnalyzedFrame extends VisualFrameSample {
  readonly signals: FrameSignals;
  readonly changeFromPrevious: number;
}

export interface SelectedFrame extends AnalyzedFrame {
  readonly role: string;
  readonly imageId: string;
}

export interface EffectFacts {
  readonly description: string;
  readonly keyInformation: readonly Readonly<{ label: string; value: string }>[];
  readonly selected: readonly SelectedFrame[];
  readonly continuity: "稳定" | "连续" | "存在突跳";
  readonly freezeExpected: boolean;
  readonly technicalQuality: Readonly<Record<string, string | boolean>>;
}

export type VisualEffectAnalyzer = (frames: readonly AnalyzedFrame[]) => EffectFacts;

const DISPLAY_NAMES: Readonly<Record<VisualSelfCheckToolName, string>> = Object.freeze({
  displacement_map: "置换贴图",
  kaleidoscope: "万花筒",
  liquid_displace: "液态置换",
  fractal: "分形",
  glass: "玻璃材质",
  image_depth_parallax: "图像深度视差",
  path_morph: "路径变形",
  turbulent_displace: "湍流置换",
  wave_warp: "波浪扭曲",
  wave_surface: "波浪曲面"
});

export function isVisualSelfCheckTool(value: string): value is VisualSelfCheckToolName {
  return (VISUAL_SELF_CHECK_TOOLS as readonly string[]).includes(value);
}

export function queuedVisualEffectSelfCheck(toolName: VisualSelfCheckToolName): VisualEffectSelfCheckView {
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

function rounded(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
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

function frameSignals(frame: VisualFrameSample): FrameSignals {
  const { pixels, width, height } = frame;
  let sum = 0;
  let squared = 0;
  let edgeX = 0;
  let edgeY = 0;
  let edgeSamples = 0;
  let separation = 0;
  let center = 0;
  let centerCount = 0;
  let border = 0;
  let borderCount = 0;
  let mirrorDifference = 0;
  let mirrorSamples = 0;
  let dark = 0;
  const luminanceAt = (x: number, y: number): number => {
    const offset = (y * width + x) * 4;
    return pixels[offset]! * 0.2126 + pixels[offset + 1]! * 0.7152 + pixels[offset + 2]! * 0.0722;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const r = pixels[offset]!;
      const g = pixels[offset + 1]!;
      const b = pixels[offset + 2]!;
      const lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
      sum += lum;
      squared += lum * lum;
      separation += Math.max(r, g, b) - Math.min(r, g, b);
      if (lum < 6) dark += 1;
      const isCenter = x >= width * 0.25 && x < width * 0.75 && y >= height * 0.25 && y < height * 0.75;
      if (isCenter) { center += lum; centerCount += 1; }
      if (x < width * 0.1 || x >= width * 0.9 || y < height * 0.1 || y >= height * 0.9) {
        border += lum;
        borderCount += 1;
      }
      if (x + 1 < width) { edgeX += Math.abs(lum - luminanceAt(x + 1, y)); edgeSamples += 1; }
      if (y + 1 < height) { edgeY += Math.abs(lum - luminanceAt(x, y + 1)); }
      if (x < Math.floor(width / 2)) {
        mirrorDifference += Math.abs(lum - luminanceAt(width - 1 - x, y));
        mirrorSamples += 1;
      }
    }
  }
  const count = Math.max(1, width * height);
  const mean = sum / count;
  return Object.freeze({
    luminance: mean / 255,
    contrast: Math.sqrt(Math.max(0, squared / count - mean * mean)) / 255,
    edgeX: edgeX / Math.max(1, edgeSamples) / 255,
    edgeY: edgeY / Math.max(1, edgeSamples) / 255,
    colorSeparation: separation / count / 255,
    centerBrightness: center / Math.max(1, centerCount) / 255,
    borderBrightness: border / Math.max(1, borderCount) / 255,
    mirrorAgreement: 1 - mirrorDifference / Math.max(1, mirrorSamples) / 255,
    darkRatio: dark / count
  });
}

function frameDifference(before: VisualFrameSample, after: VisualFrameSample): number {
  if (before.width !== after.width || before.height !== after.height || before.pixels.length !== after.pixels.length) return 1;
  let difference = 0;
  for (let offset = 0; offset < after.pixels.length; offset += 4) {
    difference += Math.abs(after.pixels[offset]! - before.pixels[offset]!)
      + Math.abs(after.pixels[offset + 1]! - before.pixels[offset + 1]!)
      + Math.abs(after.pixels[offset + 2]! - before.pixels[offset + 2]!);
  }
  return difference / Math.max(1, after.width * after.height * 3 * 255);
}

function analyzeFrames(frames: readonly VisualFrameSample[]): readonly AnalyzedFrame[] {
  return Object.freeze(frames.map((frame, index) => Object.freeze({
    ...frame,
    signals: frameSignals(frame),
    changeFromPrevious: index === 0 ? 0 : rounded(frameDifference(frames[index - 1]!, frame), 6)
  })));
}

export const VISUAL_EFFECT_ANALYZERS: Readonly<Record<VisualSelfCheckToolName, VisualEffectAnalyzer>> = Object.freeze({
  displacement_map: selfCheckDisplacementMap,
  kaleidoscope: selfCheckKaleidoscope,
  liquid_displace: selfCheckLiquidDisplace,
  fractal: selfCheckFractal,
  glass: selfCheckGlass,
  image_depth_parallax: selfCheckImageDepthParallax,
  path_morph: selfCheckPathMorph,
  turbulent_displace: selfCheckTurbulentDisplace,
  wave_warp: selfCheckWaveWarp,
  wave_surface: selfCheckWaveSurface
});

export function analyzeVisualEffectFrames(
  toolName: VisualSelfCheckToolName,
  frames: readonly VisualFrameSample[]
): EffectFacts {
  if (frames.length < 2) throw new Error(`${toolName} 自检至少需要两个来自最终视频的候选帧。`);
  if (frames.some((frame) => frame.width !== frames[0]!.width || frame.height !== frames[0]!.height
    || frame.pixels.length !== frame.width * frame.height * 4)) {
    throw new Error(`${toolName} 最终视频候选帧尺寸不一致。`);
  }
  return VISUAL_EFFECT_ANALYZERS[toolName](analyzeFrames([...frames].sort((a, b) => a.time - b.time)));
}

function candidateFrames(durationSeconds: number, fps: number): readonly Readonly<{ frame: number; time: number }>[] {
  const frameCount = Math.max(2, Math.round(durationSeconds * fps));
  const fractions = durationSeconds <= 0.6
    ? [0.04, 0.25, 0.5, 0.75, 0.96]
    : durationSeconds <= 2
      ? [0.03, 0.12, 0.25, 0.38, 0.5, 0.62, 0.75, 0.88, 0.97]
      : [0.02, 0.08, 0.16, 0.25, 0.34, 0.43, 0.52, 0.61, 0.7, 0.79, 0.88, 0.94, 0.98];
  const frames = new Map<number, number>();
  for (const fraction of fractions) {
    const frame = Math.max(0, Math.min(frameCount - 1, Math.round((frameCount - 1) * fraction)));
    frames.set(frame, frame / fps);
  }
  return Object.freeze([...frames].map(([frame, time]) => Object.freeze({ frame, time })));
}

async function runFfmpeg(ffmpegPath: string | undefined, args: readonly string[], signal?: AbortSignal): Promise<void> {
  await execFileAsync(ffmpegPath ?? "ffmpeg", [...args], {
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 2 * 1024 * 1024,
    ...(signal === undefined ? {} : { signal })
  });
}

async function extractImage(ffmpegPath: string | undefined, inputPath: string, outputPath: string,
  width: number, height: number, time: number, signal?: AbortSignal): Promise<void> {
  await runFfmpeg(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-ss", time.toFixed(6),
    "-i", inputPath, "-frames:v", "1", "-vf",
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`, outputPath], signal);
}

function drawFitted(ctx: SKRSContext2D, image: Awaited<ReturnType<typeof loadImage>>, x: number, y: number,
  width: number, height: number): void {
  const scale = Math.min(width / image.width, height / image.height);
  const targetWidth = image.width * scale;
  const targetHeight = image.height * scale;
  ctx.fillStyle = "#070b12";
  ctx.fillRect(x, y, width, height);
  ctx.drawImage(image, x + (width - targetWidth) / 2, y + (height - targetHeight) / 2, targetWidth, targetHeight);
}

async function readPixels(path: string, width: number, height: number): Promise<Uint8ClampedArray> {
  const image = await loadImage(path);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  drawFitted(ctx, image, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

async function contactSheet(selected: readonly SelectedFrame[], paths: ReadonlyMap<number, string>, outputPath: string,
  sourceWidth: number, sourceHeight: number): Promise<Readonly<{ width: number; height: number }>> {
  const panels = await Promise.all(selected.map(async (frame) => {
    const path = paths.get(frame.frame);
    if (path === undefined) throw new Error(`缺少最终 MP4 关键帧 ${frame.frame}。`);
    return Object.freeze({ frame, image: await loadImage(path) });
  }));
  const panelWidth = 272;
  const panelHeight = Math.max(153, Math.round(panelWidth * sourceHeight / sourceWidth));
  const gap = 14;
  const labelHeight = 54;
  const boardWidth = panels.length * panelWidth + (panels.length + 1) * gap;
  const boardHeight = panelHeight + labelHeight + gap * 2;
  const canvas = createCanvas(boardWidth, boardHeight);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, boardWidth, boardHeight);
  panels.forEach((panel, index) => {
    const x = gap + index * (panelWidth + gap);
    drawFitted(ctx, panel.image, x, gap, panelWidth, panelHeight);
    ctx.strokeStyle = "#d7ddd9";
    ctx.strokeRect(x, gap, panelWidth, panelHeight);
    ctx.fillStyle = "#27312c";
    ctx.font = `bold 13px ${evidenceFont()}`;
    ctx.fillText(`第 ${index + 1} 帧 · ${panel.frame.role}`, x, gap + panelHeight + 21);
    ctx.fillStyle = "#6d7872";
    ctx.font = `11px ${evidenceFont()}`;
    ctx.fillText(`时间 ${panel.frame.time.toFixed(3)} 秒`, x, gap + panelHeight + 42);
  });
  await writeFile(outputPath, canvas.toBuffer("image/png"));
  return Object.freeze({ width: boardWidth, height: boardHeight });
}

function publicView(request: Readonly<{
  toolName: VisualSelfCheckToolName;
  userRequest: string;
  fileName: string;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  frameCount: number;
  bytes: number;
  facts: EffectFacts;
  candidates: readonly AnalyzedFrame[];
}>): Readonly<Record<string, unknown>> {
  const darkFrames = request.candidates.filter((frame) => frame.signals.darkRatio > 0.97).length;
  const averageChange = request.candidates.slice(1).reduce((sum, frame) => sum + frame.changeFromPrevious, 0)
    / Math.max(1, request.candidates.length - 1);
  return Object.freeze({
    file_name: basename(request.fileName),
    original_request: request.userRequest.slice(0, 4_000),
    summary: Object.freeze({
      description: request.facts.description,
      key_information: request.facts.keyInformation,
      missing_information: Object.freeze([])
    }),
    metadata: Object.freeze({
      media: Object.freeze({
        media_type: "video/mp4", container: "mp4", video_codec: "h264",
        width_px: request.width, height_px: request.height, fps: request.fps,
        duration_seconds: rounded(request.durationSeconds, 3), frame_count: request.frameCount,
        file_size_bytes: request.bytes, encoding_completed: true, decodable: true, has_audio: false
      }),
      quality: Object.freeze({
        black_frame_ratio: rounded(darkFrames / Math.max(1, request.candidates.length), 6),
        decode_failure_count: 0,
        dimension_consistent: true,
        unexpected_freeze: !request.facts.freezeExpected && averageChange < 0.0008,
        temporal_continuity: request.facts.continuity,
        frame_integrity: darkFrames === 0 && request.facts.continuity !== "存在突跳" ? "通过" : "需复核",
        effect_specific: request.facts.technicalQuality
      }),
      keyframe_evidence: Object.freeze({
        coverage: "sufficient",
        image_count: request.facts.selected.length,
        contact_sheet: "keyframe_contact_sheet",
        keyframes: Object.freeze(request.facts.selected.map((frame) => Object.freeze({
          image_id: frame.imageId,
          time_seconds: rounded(frame.time, 3),
          role: frame.role
        })))
      })
    })
  });
}

export async function loadVisualEffectSelfCheckRule(toolName: VisualSelfCheckToolName): Promise<string> {
  const rule = await readFile(new URL(`../../effect-functions/self-check-rules/tools/${toolName}.md`, import.meta.url), "utf8");
  if (!rule.startsWith(`# ${toolName} 自检规则`) || !rule.includes("## 关键帧规则")) {
    throw new Error(`${toolName} self-check rule identity is invalid.`);
  }
  return rule;
}

function safeFailure(error: unknown): string {
  return (error instanceof Error && error.message.trim().length > 0 ? error.message : "自动自检未能完成。")
    .replace(/https?:\/\/\S+|[A-Za-z]:\\\S+|\/(?:home|tmp|var)\/\S+/gu, "[已隐藏]").slice(0, 500);
}

export async function runVisualEffectSelfCheck(request: Readonly<{
  requestId: string;
  tenantId: string;
  userId: string;
  toolName: VisualSelfCheckToolName;
  userRequest: string;
  videoPath: string;
  fileName?: string;
  outputDirectory: string;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  frameCount: number;
  bytes: number;
  reviewer?: VisualSelfCheckReviewer;
  ffmpegPath?: string;
  frameExtractor?: (inputPath: string, outputPath: string, width: number, height: number,
    time: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
}>): Promise<VisualSelfCheckArtifacts> {
  let macroView: Readonly<Record<string, unknown>> | undefined;
  let evidenceImages: VisualEffectSelfCheckView["evidenceImages"] = Object.freeze([]);
  const evidenceFiles = new Map<string, string>();
  try {
    const directory = join(request.outputDirectory, "self-check");
    await mkdir(directory, { recursive: true });
    const plans = candidateFrames(request.durationSeconds, request.fps);
    const framePaths = new Map<number, string>();
    const samples: VisualFrameSample[] = [];
    const extract = request.frameExtractor ?? ((inputPath, outputPath, width, height, time, signal) =>
      extractImage(request.ffmpegPath, inputPath, outputPath, width, height, time, signal));
    for (const plan of plans) {
      const path = join(directory, `candidate_${String(plan.frame).padStart(6, "0")}.png`);
      await extract(request.videoPath, path, request.width, request.height, plan.time, request.signal);
      framePaths.set(plan.frame, path);
      samples.push(Object.freeze({ ...plan, width: request.width, height: request.height,
        pixels: await readPixels(path, request.width, request.height) }));
    }
    const analyzed = analyzeFrames(samples);
    const facts = VISUAL_EFFECT_ANALYZERS[request.toolName](analyzed);
    if (facts.selected.length < 2) throw new Error(`${request.toolName} 最终视频关键帧证据不足。`);
    const boardPath = join(directory, "keyframe_contact_sheet.png");
    const board = await contactSheet(facts.selected, framePaths, boardPath, request.width, request.height);
    evidenceFiles.set("keyframe_contact_sheet", boardPath);
    evidenceImages = Object.freeze([Object.freeze({
      evidenceId: "keyframe_contact_sheet",
      label: `${DISPLAY_NAMES[request.toolName]}最终 MP4 关键帧合成图`,
      mime: "image/png" as const,
      width: board.width,
      height: board.height
    })]);
    macroView = publicView({
      toolName: request.toolName,
      userRequest: request.userRequest,
      fileName: request.fileName ?? basename(request.videoPath),
      width: request.width,
      height: request.height,
      fps: request.fps,
      durationSeconds: request.durationSeconds,
      frameCount: request.frameCount,
      bytes: request.bytes,
      facts,
      candidates: analyzed
    });
    if (request.reviewer === undefined) throw new Error("自动交付审查器未配置，证据已生成但不能伪造验收结论。");
    const result = await request.reviewer.review({
      requestId: request.requestId,
      tenantId: request.tenantId,
      userId: request.userId,
      rule: await loadVisualEffectSelfCheckRule(request.toolName),
      acceptanceView: macroView,
      evidencePng: await readFile(boardPath),
      ...(request.signal === undefined ? {} : { signal: request.signal })
    });
    return Object.freeze({
      view: Object.freeze({
        status: result.status,
        automatic: true,
        toolName: request.toolName,
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
    return Object.freeze({
      view: Object.freeze({
        status: "fail",
        automatic: true,
        toolName: request.toolName,
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

function reviewText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > MAX_REVIEW_TEXT) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value.trim();
}

function responseContent(body: unknown): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return body;
  const choices = (body as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length !== 1) return body;
  const choice = choices[0];
  if (typeof choice !== "object" || choice === null || Array.isArray(choice)) return body;
  const message = (choice as Record<string, unknown>).message;
  if (typeof message !== "object" || message === null || Array.isArray(message)) return body;
  const content = (message as Record<string, unknown>).content;
  if (typeof content !== "string") return content;
  const trimmed = content.trim();
  const unfenced = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "") : trimmed;
  return JSON.parse(unfenced);
}

function parseReview(value: unknown): VisualSelfCheckResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Review response must be an object.");
  const raw = value as Record<string, unknown>;
  if ((raw.status !== "pass" && raw.status !== "fail") || !Array.isArray(raw.repair_suggestions)) {
    throw new TypeError("Review response contract is invalid.");
  }
  const summary = reviewText(raw.summary, "summary");
  const suggestions = raw.repair_suggestions.map((item, index) => reviewText(item, `repair_suggestions[${index}]`));
  if (raw.status === "pass" && suggestions.length > 0 || raw.status === "fail" && suggestions.length === 0) {
    throw new TypeError("Review status and repair suggestions disagree.");
  }
  const check = Object.freeze({
    ruleId: "DELIVERY_REVIEW",
    status: raw.status,
    evidenceRefs: Object.freeze(["macroView", "keyframe_contact_sheet"]),
    reason: summary
  });
  const issues = raw.status === "pass" ? Object.freeze([]) : Object.freeze(suggestions.map((message) => Object.freeze({
    ruleId: "DELIVERY_REVIEW",
    code: "REPAIR_REQUIRED",
    message,
    evidenceRefs: Object.freeze(["macroView", "keyframe_contact_sheet"])
  })));
  return Object.freeze({ status: raw.status, summary, checks: Object.freeze([check]), issues });
}

export class VolcengineArkVisualSelfCheckReviewer implements VisualSelfCheckReviewer {
  readonly #baseUrl: string;
  readonly #transport: typeof fetch;

  constructor(private readonly options: Readonly<{
    apiKey: string;
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    audit?: (record: Readonly<Record<string, unknown>>) => void;
  }>) {
    this.#baseUrl = (options.baseUrl ?? DEFAULT_ARK_BASE_URL).replace(/\/+$/u, "");
    this.#transport = options.fetchImpl ?? fetch;
  }

  async review(request: Parameters<VisualSelfCheckReviewer["review"]>[0]): Promise<VisualSelfCheckResult> {
    const started = Date.now();
    let response: Response;
    try {
      response = await this.#transport(`${this.#baseUrl}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: ARK_V1_MODEL,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [{ role: "system", content: `${request.rule}\n\n只输出 JSON：通过时 {\"status\":\"pass\",\"summary\":\"交付结论\",\"repair_suggestions\":[]}；返修时 status 为 fail，repair_suggestions 使用用户可理解的效果语言。` },
            { role: "user", content: [{ type: "text", text: JSON.stringify(request.acceptanceView) },
              { type: "image_url", image_url: { url: `data:image/png;base64,${request.evidencePng.toString("base64")}` } }] }]
        }),
        ...(request.signal === undefined ? {} : { signal: request.signal })
      });
    } catch (error) {
      throw new ProviderError("provider_unavailable", "Visual self-check request failed.", { cause: error, retryable: true });
    }
    const body = await response.json().catch(() => undefined);
    this.options.audit?.(Object.freeze({ event: "visual_self_check_review", requestId: request.requestId,
      tenantId: request.tenantId, userId: request.userId, status: response.status, latencyMs: Date.now() - started }));
    if (!response.ok) throw new ProviderError(response.status === 401 || response.status === 403
      ? "authentication" : "provider_response", "Visual self-check request was rejected.", { status: response.status });
    return parseReview(responseContent(body));
  }
}
