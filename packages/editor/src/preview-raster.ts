import type { JsonObject, LayerDefinition, MotionProject, RenderQuality } from "@codemotion/core";
import { parseSvgPathData } from "@codemotion/effects-2d";
import type {
  CoverageBuffer,
  LayerRasterSource,
  MediaRasterSource,
  RasterGlyph,
  TextRasterSource,
  VectorRasterPath,
  VectorRasterSource
} from "@codemotion/renderer-api";

function object(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function number(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stableIdentity(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function canvas2d(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) throw new Error("Canvas 2D rasterization is unavailable.");
  return [canvas, context];
}

function glyphCoverage(
  character: string,
  font: string,
  width: number,
  height: number
): { readonly coverage: CoverageBuffer; readonly advance: number } {
  const [canvas, context] = canvas2d(width, height);
  context.clearRect(0, 0, width, height);
  context.font = font;
  context.textBaseline = "top";
  context.fillStyle = "#ffffff";
  const metrics = context.measureText(character);
  const advance = Math.max(1, Math.ceil(metrics.width));
  context.fillText(character, 1, 1);
  const pixels = context.getImageData(0, 0, width, height).data;
  const coverage = new Uint8Array(width * height);
  for (let index = 0; index < coverage.length; index += 1) coverage[index] = pixels[index * 4 + 3]!;
  return {
    coverage: { width, height, data: coverage, rowOrder: "top-to-bottom" },
    advance
  };
}

function textSource(layer: LayerDefinition, width: number, height: number, projectWidth: number): TextRasterSource {
  if (layer.type !== "text") throw new TypeError("Text rasterization requires a text layer.");
  const text = layer.properties.text;
  if (text.trim().length === 0) throw new TypeError(`Text layer ${layer.id} has no visible glyphs.`);
  const family = layer.properties.fontFamily;
  const requestedSize = number(layer.properties.fontSize, 72);
  const characters = Array.from(text);
  let fontSize = Math.max(8, Math.min(Math.floor(height * 0.45), requestedSize * width / projectWidth));
  let font = "";
  let glyphData: Array<ReturnType<typeof glyphCoverage> | undefined> = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    font = `700 ${fontSize}px ${family}`;
    glyphData = characters.map((character) =>
      character === " " ? undefined : glyphCoverage(
        character,
        font,
        Math.ceil(fontSize * 1.5),
        Math.ceil(fontSize * 1.5)
      )
    );
    const advanceWidth = glyphData.reduce(
      (sum, glyph) => sum + (glyph?.advance ?? Math.ceil(fontSize * 0.35)),
      0
    );
    const trailing = glyphData.at(-1);
    const footprint = advanceWidth + Math.max(0, (trailing?.coverage.width ?? 0) - (trailing?.advance ?? 0));
    if (footprint <= width - 4 || fontSize <= 8) break;
    fontSize = Math.max(8, Math.floor(fontSize * (width - 4) / footprint));
  }
  const totalWidth = glyphData.reduce((sum, glyph) => sum + (glyph?.advance ?? Math.ceil(fontSize * 0.35)), 0);
  let x = Math.max(0, Math.floor((width - totalWidth) / 2));
  const y = Math.max(0, Math.floor((height - fontSize * 1.25) / 2));
  const glyphs: RasterGlyph[] = [];
  let cluster = 0;
  characters.forEach((character, index) => {
    const data = glyphData[index];
    const advance = data?.advance ?? Math.ceil(fontSize * 0.35);
    if (data !== undefined) {
      glyphs.push({
        glyphId: character.codePointAt(0)!,
        cluster,
        advance,
        offsetX: 0,
        offsetY: 0,
        bounds: { x, y, width: data.coverage.width, height: data.coverage.height },
        coverage: data.coverage
      });
    }
    x += advance;
    cluster += character.length;
  });
  const identity = `${family}|700|normal|${font}`;
  return {
    kind: "text",
    text,
    font: {
      fontId: `browser-font.${stableIdentity(identity)}`,
      assetId: `browser-font://${encodeURIComponent(family)}`,
      assetHash: `browser-raster:${stableIdentity(identity)}`,
      family,
      style: "normal",
      weight: 700,
      unitsPerEm: 1000,
      missingGlyphPolicy: "error"
    },
    glyphs
  };
}

function pathStyle(value: Record<string, unknown>): Pick<VectorRasterPath, "fillRule" | "fill" | "stroke" | "strokeWidth"> {
  return {
    fillRule: value.fillRule === "evenodd" ? "evenodd" : "nonzero",
    fill: typeof value.fill === "string" ? value.fill : null,
    stroke: typeof value.stroke === "string" ? value.stroke : null,
    strokeWidth: number(value.strokeWidth, 1)
  };
}

function shapeSource(layer: LayerDefinition, projectWidth: number, projectHeight: number): VectorRasterSource {
  const shapes = Array.isArray(layer.properties.shapes) ? layer.properties.shapes : [];
  const paths = shapes.flatMap((shape) => {
    const entry = object(shape);
    return typeof entry.path === "string" ? [parseSvgPathData(entry.path, pathStyle(entry))] : [];
  });
  if (paths.length === 0) {
    const fill = typeof layer.properties.fill === "string" ? layer.properties.fill : "#ffffff";
    paths.push(parseSvgPathData(
      `M ${projectWidth * 0.2} ${projectHeight * 0.2} L ${projectWidth * 0.8} ${projectHeight * 0.2} L ${projectWidth * 0.8} ${projectHeight * 0.8} L ${projectWidth * 0.2} ${projectHeight * 0.8} Z`,
      { fillRule: "nonzero", fill, stroke: null, strokeWidth: 0 }
    ));
  }
  return {
    kind: "shape",
    viewport: { x: 0, y: 0, width: projectWidth, height: projectHeight },
    paths
  };
}

function svgSource(layer: LayerDefinition, width: number, height: number): VectorRasterSource {
  const markup = layer.type === "svg" ? layer.properties.svg : undefined;
  if (typeof markup !== "string" || markup.trim().length === 0) {
    throw new TypeError(`SVG layer ${layer.id} requires SVG markup.`);
  }
  const documentValue = new DOMParser().parseFromString(markup, "image/svg+xml");
  const root = documentValue.documentElement;
  if (root.nodeName.toLowerCase() === "parsererror") throw new TypeError(`SVG layer ${layer.id} is invalid.`);
  const paths = [...root.querySelectorAll("path")].map((node) =>
    parseSvgPathData(node.getAttribute("d") ?? "", {
      fillRule: node.getAttribute("fill-rule") === "evenodd" ? "evenodd" : "nonzero",
      fill: node.getAttribute("fill") ?? "#ffffff",
      stroke: node.getAttribute("stroke"),
      strokeWidth: number(Number(node.getAttribute("stroke-width")), 1)
    })
  );
  if (paths.length === 0) throw new TypeError(`SVG layer ${layer.id} requires at least one path.`);
  const viewBox = (root.getAttribute("viewBox") ?? `0 0 ${width} ${height}`).trim().split(/\s+/).map(Number);
  return {
    kind: "svg",
    viewport: {
      x: number(viewBox[0], 0),
      y: number(viewBox[1], 0),
      width: Math.max(1, number(viewBox[2], width)),
      height: Math.max(1, number(viewBox[3], height))
    },
    paths
  };
}

function waitFor(target: EventTarget, success: string, failure = "error"): Promise<void> {
  return new Promise((resolve, reject) => {
    const clean = (): void => {
      target.removeEventListener(success, onSuccess);
      target.removeEventListener(failure, onFailure);
    };
    const onSuccess = (): void => { clean(); resolve(); };
    const onFailure = (): void => { clean(); reject(new Error(`Media event ${failure}.`)); };
    target.addEventListener(success, onSuccess, { once: true });
    target.addEventListener(failure, onFailure, { once: true });
  });
}

async function mediaSource(
  project: MotionProject,
  layer: LayerDefinition,
  width: number,
  height: number,
  time: number
): Promise<MediaRasterSource | undefined> {
  if ((layer.type !== "image" && layer.type !== "video") || layer.source === undefined) return undefined;
  const asset = project.assets.find((entry) => entry.id === layer.source?.assetId);
  if (asset === undefined || /^media:\/\//.test(asset.uri)) return undefined;
  const [canvas, context] = canvas2d(width, height);
  if (layer.type === "image") {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = asset.uri;
    if (!image.complete) await waitFor(image, "load");
    context.drawImage(image, 0, 0, width, height);
  } else {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";
    video.src = asset.uri;
    await waitFor(video, "loadedmetadata");
    video.currentTime = Math.min(Math.max(0, time), Math.max(0, video.duration - 0.001));
    await waitFor(video, "seeked");
    context.drawImage(video, 0, 0, width, height);
  }
  return {
    kind: layer.type,
    assetId: asset.id,
    assetHash: asset.hash ?? `browser-media:${stableIdentity(asset.uri)}`,
    frameTime: time,
    pixels: {
      width,
      height,
      data: context.getImageData(0, 0, width, height).data,
      colorSpace: project.colorSpace,
      alphaMode: "straight",
      rowOrder: "top-to-bottom"
    }
  };
}

function existingSource(layer: LayerDefinition): LayerRasterSource | undefined {
  const value = layer.properties.rasterSource;
  const kind = object(value).kind;
  return kind === "text" || kind === "shape" || kind === "svg" || kind === "image" || kind === "video"
    ? value as unknown as LayerRasterSource
    : undefined;
}

export async function preparePreviewProject(
  project: MotionProject,
  width: number,
  height: number,
  time: number,
  quality: RenderQuality = "preview"
): Promise<MotionProject> {
  const clone = structuredClone(project);
  clone.metadata = { ...clone.metadata, timeContractVersion: "1.1.0" };
  for (const composition of clone.compositions) {
    for (const layer of composition.layers) {
      for (const effect of layer.effects) effect.renderQuality = quality;
      if (!layer.visible || !["text", "shape", "svg", "image", "video"].includes(layer.type)) continue;
      let source = existingSource(layer);
      if (source === undefined) {
        if (layer.type === "text") source = textSource(layer, width, height, project.width);
        else if (layer.type === "shape") source = shapeSource(layer, project.width, project.height);
        else if (layer.type === "svg") source = svgSource(layer, width, height);
        else source = await mediaSource(clone, layer, width, height, time);
      }
      if (source !== undefined) {
        (layer as unknown as { properties: JsonObject }).properties = {
          ...(layer.properties as unknown as JsonObject),
          rasterSource: source as unknown as JsonObject
        };
      }
    }
  }
  return clone;
}
