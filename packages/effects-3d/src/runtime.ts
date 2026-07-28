import type { JsonObject, RenderQuality } from "@codemotion/core";
import { createTextExtrusionGeometry } from "./geometry.js";
import { qualityLayerCount } from "./shader.js";
import type {
  PixelSurface,
  TextExtrude3DParams,
  TextExtrude3DRenderOptions,
  TextLight,
  TextMaterial
} from "./types.js";

const DEFAULTS: TextExtrude3DParams = Object.freeze({
  depth: 0.28,
  bevel: 0.06,
  material: "metal",
  light: "studio",
  rotationX: 18,
  rotationY: -24,
  perspective: 0.55,
  progress: 0.5
});

function finite(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function enumValue<T extends string>(value: unknown, fallback: T, values: readonly T[]): T {
  return typeof value === "string" && values.includes(value as T) ? value as T : fallback;
}

export function normalizeTextExtrude3DParams(
  supplied: Readonly<Record<string, unknown>> = {}
): TextExtrude3DParams {
  return Object.freeze({
    depth: finite(supplied.depth, DEFAULTS.depth, 0, 1),
    bevel: finite(supplied.bevel, DEFAULTS.bevel, 0, 0.25),
    material: enumValue<TextMaterial>(supplied.material, DEFAULTS.material, ["matte", "metal", "glass"]),
    light: enumValue<TextLight>(supplied.light, DEFAULTS.light, ["studio", "rim", "top"]),
    rotationX: finite(supplied.rotationX, DEFAULTS.rotationX, -60, 60),
    rotationY: finite(supplied.rotationY, DEFAULTS.rotationY, -90, 90),
    perspective: finite(supplied.perspective, DEFAULTS.perspective, 0, 1),
    progress: finite(supplied.progress, DEFAULTS.progress, 0, 1)
  });
}

export function defaultTextExtrude3DParams(): JsonObject {
  return { ...DEFAULTS };
}

function assertSurface(surface: PixelSurface): void {
  if (!Number.isInteger(surface.width) || surface.width < 1
    || !Number.isInteger(surface.height) || surface.height < 1
    || surface.data.length !== surface.width * surface.height * 4) {
    throw new RangeError("Text extrusion surface must have positive dimensions and exact RGBA data.");
  }
}

function emptyLike(source: PixelSurface): PixelSurface {
  return {
    width: source.width,
    height: source.height,
    data: new Uint8ClampedArray(source.data.length),
    colorSpace: source.colorSpace,
    alphaMode: source.alphaMode
  };
}

type Rgba = [number, number, number, number];

function read(source: PixelSurface, x: number, y: number): Rgba {
  const ix = Math.max(0, Math.min(source.width - 1, Math.round(x)));
  const iy = Math.max(0, Math.min(source.height - 1, Math.round(y)));
  const offset = (iy * source.width + ix) * 4;
  const alpha = source.data[offset + 3]! / 255;
  const scale = source.alphaMode === "premultiplied" && alpha > 0 ? 1 / alpha : 1;
  return [
    Math.min(1, source.data[offset]! / 255 * scale),
    Math.min(1, source.data[offset + 1]! / 255 * scale),
    Math.min(1, source.data[offset + 2]! / 255 * scale),
    source.alphaMode === "none" ? 1 : alpha
  ];
}

function shade(
  color: Rgba,
  material: TextMaterial,
  light: TextLight,
  sideAmount: number,
  normalX: number,
  normalY: number
): Rgba {
  const lights: Readonly<Record<TextLight, readonly [number, number, number]>> = {
    studio: [-0.45, -0.55, 0.8],
    rim: [0.8, -0.2, 0.55],
    top: [0, -0.9, 0.45]
  };
  const vector = lights[light];
  const normalZ = Math.sqrt(Math.max(0.05, 1 - normalX * normalX - normalY * normalY));
  const diffuse = Math.max(0, normalX * vector[0] + normalY * vector[1] + normalZ * vector[2]);
  const base = material === "matte" ? 0.28 + diffuse * 0.72
    : material === "metal" ? 0.42 + diffuse * 0.48
      : 0.5 + diffuse * 0.3;
  const specular = material === "matte" ? 0
    : Math.pow(Math.max(0, normalZ * vector[2]), material === "metal" ? 12 : 7)
      * (material === "metal" ? 0.48 : 0.68);
  const glassMix = material === "glass" ? 0.38 : 0;
  return [
    color[0] * base * (1 - glassMix) + 0.72 * glassMix + specular + sideAmount * 0.02,
    color[1] * base * (1 - glassMix) + 0.9 * glassMix + specular + sideAmount * 0.02,
    color[2] * base * (1 - glassMix) + glassMix + specular + sideAmount * 0.03,
    color[3]
  ];
}

function write(output: PixelSurface, x: number, y: number, color: Rgba): void {
  const offset = (y * output.width + x) * 4;
  const alpha = Math.max(0, Math.min(1, color[3]));
  const association = output.alphaMode === "premultiplied" ? alpha : 1;
  output.data[offset] = alpha === 0 ? 0 : Math.round(Math.max(0, Math.min(1, color[0])) * association * 255);
  output.data[offset + 1] = alpha === 0 ? 0 : Math.round(Math.max(0, Math.min(1, color[1])) * association * 255);
  output.data[offset + 2] = alpha === 0 ? 0 : Math.round(Math.max(0, Math.min(1, color[2])) * association * 255);
  output.data[offset + 3] = output.alphaMode === "none" ? 255 : Math.round(alpha * 255);
}

function applyMask(output: PixelSurface, mask: PixelSurface | undefined): PixelSurface {
  if (!mask) return output;
  assertSurface(mask);
  if (mask.width !== output.width || mask.height !== output.height) {
    throw new RangeError("Mask and text extrusion output must have equal dimensions.");
  }
  for (let y = 0; y < output.height; y += 1) {
    for (let x = 0; x < output.width; x += 1) {
      const offset = (y * output.width + x) * 4;
      const coverage = mask.data[offset + 3]! / 255;
      output.data[offset + 3] = Math.round(output.data[offset + 3]! * coverage);
      if (output.alphaMode === "premultiplied") {
        output.data[offset] = Math.round(output.data[offset]! * coverage);
        output.data[offset + 1] = Math.round(output.data[offset + 1]! * coverage);
        output.data[offset + 2] = Math.round(output.data[offset + 2]! * coverage);
      }
      if (output.data[offset + 3] === 0) {
        output.data[offset] = 0;
        output.data[offset + 1] = 0;
        output.data[offset + 2] = 0;
      }
    }
  }
  return output;
}

export function renderTextExtrude3DPixels(
  source: PixelSurface,
  suppliedParams: Readonly<Record<string, unknown>> = {},
  suppliedOptions: Partial<TextExtrude3DRenderOptions> = {}
): PixelSurface {
  assertSurface(source);
  const params = normalizeTextExtrude3DParams({
    ...suppliedParams,
    progress: suppliedOptions.progress ?? suppliedParams.progress
  });
  const quality: RenderQuality = suppliedOptions.quality ?? "preview";
  const geometry = createTextExtrusionGeometry(source, params, quality);
  const output = emptyLike(source);
  if (geometry.occupiedCells === 0) return applyMask(output, suppliedOptions.mask);
  const layers = qualityLayerCount(quality);
  const progress = params.progress;
  const rx = params.rotationX * Math.PI / 180;
  const ry = params.rotationY * Math.PI / 180;
  const depthPixels = params.depth * progress * Math.min(source.width, source.height) * (0.45 + params.perspective * 0.55);
  const shiftX = Math.sin(ry) * depthPixels;
  const shiftY = -Math.sin(rx) * depthPixels;
  const normalLength = Math.max(1, Math.hypot(shiftX, shiftY));
  const normalX = -shiftX / normalLength * 0.45;
  const normalY = -shiftY / normalLength * 0.45;
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      let result: Rgba = [0, 0, 0, 0];
      for (let layer = layers; layer >= 1; layer -= 1) {
        const amount = layer / layers;
        const sample = read(source, x - shiftX * amount, y - shiftY * amount);
        if (sample[3] <= result[3]) continue;
        const bevelCoverage = params.bevel === 0 ? 1
          : Math.min(1, sample[3] / Math.max(0.02, params.bevel * 4));
        sample[3] *= bevelCoverage;
        result = shade(sample, params.material, params.light, amount, normalX, normalY);
      }
      const front = read(source, x - shiftX * 0.15, y - shiftY * 0.15);
      if (front[3] > 0) result = shade(front, params.material, params.light, 0, 0, 0);
      write(output, x, y, result);
    }
  }
  return applyMask(output, suppliedOptions.mask);
}

const GLYPHS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"]
});

export function makeTextExtrudePreviewInput(width = 64, height = 36): PixelSurface {
  const output: PixelSurface = {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
    colorSpace: "srgb",
    alphaMode: "straight"
  };
  const text = "3D";
  const scale = Math.max(1, Math.floor(Math.min(width / 15, height / 10)));
  const textWidth = text.length * 6 * scale - scale;
  const startX = Math.floor((width - textWidth) / 2);
  const startY = Math.floor((height - 7 * scale) / 2);
  for (let index = 0; index < text.length; index += 1) {
    const glyph = GLYPHS[text[index]!]!;
    for (let gy = 0; gy < glyph.length; gy += 1) {
      for (let gx = 0; gx < glyph[gy]!.length; gx += 1) {
        if (glyph[gy]![gx] !== "1") continue;
        for (let py = 0; py < scale; py += 1) {
          for (let px = 0; px < scale; px += 1) {
            const x = startX + (index * 6 + gx) * scale + px;
            const y = startY + gy * scale + py;
            if (x < 0 || y < 0 || x >= width || y >= height) continue;
            const offset = (y * width + x) * 4;
            const u = x / Math.max(1, width - 1);
            output.data[offset] = Math.round(70 + u * 140);
            output.data[offset + 1] = Math.round(150 + u * 80);
            output.data[offset + 2] = 255;
            output.data[offset + 3] = 255;
          }
        }
      }
    }
  }
  return output;
}

export function hashPixelSurface(surface: PixelSurface): string {
  let value = 0x811c9dc5;
  for (const byte of surface.data) {
    value ^= byte;
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(16).padStart(8, "0");
}
