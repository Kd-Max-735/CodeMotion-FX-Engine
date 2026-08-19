import type { CoverageBuffer, RasterGlyph, TextRasterSource } from "@codemotion/renderer-api";

export type ServerTextFontFamilyV1 = "song" | "kai" | "sans";

export interface ServerTextRasterRequestV1 {
  readonly text: string;
  readonly fontFamily: ServerTextFontFamilyV1;
  readonly fontSize: number;
  readonly color: string;
  readonly positionX: number;
  readonly positionY: number;
  readonly width: number;
  readonly height: number;
}

const COLOR = /^#[0-9a-f]{6}$/iu;
const runtimeProcess = (globalThis as typeof globalThis & {
  readonly process?: { getBuiltinModule?: (identifier: string) => unknown };
}).process;

interface CanvasFontRuntime {
  readonly alias: string;
  readonly rasterize: (text: string, pixelSize: number) => {
    readonly coverage: CoverageBuffer;
    readonly advance: number;
  };
}

const runtimes = new Map<ServerTextFontFamilyV1, CanvasFontRuntime>();

function fontCandidates(family: ServerTextFontFamilyV1): readonly string[] {
  if (family === "song") return [
    "C:\\Windows\\Fonts\\simsun.ttc",
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
    "/System/Library/Fonts/Supplemental/Songti.ttc"
  ];
  if (family === "kai") return [
    "C:\\Windows\\Fonts\\simkai.ttf",
    "/usr/share/fonts/truetype/arphic/ukai.ttc",
    "/System/Library/Fonts/Supplemental/Kaiti.ttc"
  ];
  return [
    "C:\\Windows\\Fonts\\Noto Sans SC (TrueType).otf",
    "C:\\Windows\\Fonts\\NotoSansSC-VF.ttf",
    "C:\\Windows\\Fonts\\Deng.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.otf",
    "/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf",
    "/System/Library/Fonts/PingFang.ttc"
  ];
}

function loadRuntime(family: ServerTextFontFamilyV1): CanvasFontRuntime {
  const cached = runtimes.get(family);
  if (cached !== undefined) return cached;
  const moduleApi = runtimeProcess?.getBuiltinModule?.("node:module") as {
    readonly createRequire?: (url: string) => (identifier: string) => unknown;
  } | undefined;
  if (!moduleApi?.createRequire) throw new TypeError("Server text rasterization requires Node.js.");
  const require = moduleApi.createRequire(import.meta.url);
  const fs = require("node:fs") as {
    readonly existsSync: (path: string) => boolean;
  };
  const canvas = require("@napi-rs/canvas") as {
    readonly GlobalFonts: {
      has(family: string): boolean;
      registerFromPath(path: string, alias?: string): unknown;
    };
    readonly createCanvas: (width: number, height: number) => {
      getContext(type: "2d"): {
        font: string;
        fillStyle: string;
        textBaseline: "top";
        measureText(text: string): { width: number };
        fillText(text: string, x: number, y: number): void;
        getImageData(x: number, y: number, width: number, height: number): { data: Uint8ClampedArray };
      };
    };
  };
  const fontPath = fontCandidates(family).find((path) => fs.existsSync(path));
  if (fontPath === undefined) throw new TypeError(`Requested ${family} CJK font is unavailable.`);
  const alias = `Codemotion Server ${family}`;
  if (!canvas.GlobalFonts.has(alias) && !canvas.GlobalFonts.registerFromPath(fontPath, alias)) {
    throw new TypeError(`Requested ${family} CJK font could not be registered.`);
  }
  const runtime: CanvasFontRuntime = Object.freeze({
    alias,
    rasterize: (text: string, pixelSize: number) => {
      const probe = canvas.createCanvas(1, 1).getContext("2d");
      probe.font = `500 ${pixelSize}px "${alias}"`;
      const advance = Math.max(1, Math.ceil(probe.measureText(text).width));
      const width = Math.max(1, advance + 6);
      const height = Math.max(1, Math.ceil(pixelSize * 1.5) + 6);
      const surface = canvas.createCanvas(width, height);
      const context = surface.getContext("2d");
      context.font = `500 ${pixelSize}px "${alias}"`;
      context.fillStyle = "#ffffff";
      context.textBaseline = "top";
      context.fillText(text, 3, 3);
      const rgba = context.getImageData(0, 0, width, height).data;
      const data = new Uint8Array(width * height);
      let visible = false;
      for (let index = 0; index < data.length; index += 1) {
        const alpha = rgba[index * 4 + 3] ?? 0;
        data[index] = alpha;
        visible ||= alpha > 0;
      }
      if (!visible && !/^\s+$/u.test(text)) throw new TypeError("Requested font lacks a visible glyph.");
      return Object.freeze({
        advance: advance + 1,
        coverage: Object.freeze({ width, height, data, rowOrder: "top-to-bottom" as const })
      });
    }
  });
  runtimes.set(family, runtime);
  return runtime;
}

function rgba(color: string): readonly [number, number, number, number] {
  return Object.freeze([
    Number.parseInt(color.slice(1, 3), 16) / 255,
    Number.parseInt(color.slice(3, 5), 16) / 255,
    Number.parseInt(color.slice(5, 7), 16) / 255,
    1
  ] as const);
}

export function createServerTextRasterSourceV1(request: ServerTextRasterRequestV1): TextRasterSource {
  const characters = [...request.text.normalize("NFC")];
  if (characters.length === 0 || characters.length > 80) throw new RangeError("Text requires 1 to 80 characters.");
  if (!Number.isInteger(request.fontSize) || request.fontSize < 12 || request.fontSize > 240
    || !Number.isInteger(request.width) || request.width < 1 || request.width > 8_192
    || !Number.isInteger(request.height) || request.height < 1 || request.height > 8_192
    || !Number.isFinite(request.positionX) || request.positionX < 0 || request.positionX > 1
    || !Number.isFinite(request.positionY) || request.positionY < 0 || request.positionY > 1
    || !COLOR.test(request.color)) {
    throw new TypeError("Server text raster request is invalid.");
  }
  const runtime = loadRuntime(request.fontFamily);
  const maxTextWidth = Math.max(1, Math.floor(request.width * 0.9));
  const maxTextHeight = Math.max(1, Math.floor(request.height * 0.9));
  const layoutAtSize = (pixelSize: number) => {
    const rendered = characters.map((character, cluster) => character === "\n"
      ? undefined : Object.freeze({ character, cluster, ...runtime.rasterize(character, pixelSize) }));
    const lines: Array<Array<NonNullable<(typeof rendered)[number]>>> = [[]];
    let lineWidth = 0;
    for (const item of rendered) {
      if (item === undefined) {
        lines.push([]); lineWidth = 0; continue;
      }
      if (lineWidth + item.advance > maxTextWidth && lines.at(-1)!.length > 0) {
        lines.push([]); lineWidth = 0;
      }
      lines.at(-1)!.push(item);
      lineWidth += item.advance;
    }
    const lineAdvance = Math.max(1, Math.ceil(pixelSize * 1.22));
    const glyphHeight = rendered.reduce((maximum, item) => Math.max(maximum, item?.coverage.height ?? 0), 1);
    const textHeight = (lines.length - 1) * lineAdvance + glyphHeight;
    return { lines, lineAdvance, textHeight };
  };
  let pixelSize = request.fontSize;
  let layout = layoutAtSize(pixelSize);
  for (let attempt = 0; attempt < 8 && layout.textHeight > maxTextHeight && pixelSize > 12; attempt += 1) {
    pixelSize = Math.max(12, Math.floor(pixelSize * Math.sqrt(maxTextHeight / layout.textHeight) * 0.96));
    layout = layoutAtSize(pixelSize);
  }
  const textHeight = Math.min(request.height, layout.textHeight);
  const originY = Math.max(0, Math.min(Math.max(0, request.height - textHeight),
    Math.round(request.positionY * request.height - textHeight / 2)));
  const glyphs: RasterGlyph[] = [];
  layout.lines.forEach((line, lineIndex) => {
    const lineWidth = line.reduce((sum, item) => sum + item.advance, 0);
    let cursor = Math.round(request.positionX * request.width - lineWidth / 2);
    cursor = Math.max(0, Math.min(Math.max(0, request.width - lineWidth), cursor));
    for (const item of line) {
      const x = cursor;
      cursor += item.advance;
      glyphs.push(Object.freeze({
        glyphId: item.character.codePointAt(0)!,
        cluster: item.cluster,
        advance: item.advance,
        offsetX: 0,
        offsetY: 0,
        bounds: Object.freeze({ x, y: originY + lineIndex * layout.lineAdvance,
          width: item.coverage.width, height: item.coverage.height }),
        coverage: item.coverage
      }));
    }
  });
  return Object.freeze({
    kind: "text",
    text: request.text,
    font: Object.freeze({
      fontId: `font.codemotion.server-${request.fontFamily}-v1`,
      assetId: `font.codemotion.server-${request.fontFamily}-v1`,
      assetHash: `system:codemotion-${request.fontFamily}-v1`,
      family: runtime.alias,
      style: "normal",
      weight: 500,
      unitsPerEm: 1_000,
      missingGlyphPolicy: "error" as const
    }),
    glyphs: Object.freeze(glyphs),
    fillRgba: rgba(request.color)
  });
}
