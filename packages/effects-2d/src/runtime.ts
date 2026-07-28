import type { JsonObject, RenderQuality } from "@codemotion/core";
import { GROUP_2_BLUEPRINTS } from "./blueprints.js";
import type {
  EffectBlueprint,
  EffectRuntimeOptions,
  ParameterSpec,
  PixelSurface
} from "./types.js";

const blueprintById = new Map(GROUP_2_BLUEPRINTS.map((entry) => [entry.effectId, entry]));
const TAU = Math.PI * 2;

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function hash(x: number, y: number, seed: number): number {
  return fract(Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123);
}

function hashString(value: string): number {
  let state = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    state ^= value.charCodeAt(index);
    state = Math.imul(state, 0x01000193);
  }
  return (state >>> 0) / 0xffffffff;
}

function applyEasing(progress: number, easing: string): number {
  const value = clamp(progress);
  if (easing === "linear") return value;
  if (easing === "easeIn") return value ** 3;
  if (easing === "easeInOut") {
    return value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2;
  }
  return 1 - (1 - value) ** 3;
}

function assertSurface(surface: PixelSurface): void {
  if (!Number.isInteger(surface.width) || surface.width < 1
    || !Number.isInteger(surface.height) || surface.height < 1) {
    throw new RangeError("Pixel surface dimensions must be positive integers.");
  }
  if (surface.data.length !== surface.width * surface.height * 4) {
    throw new RangeError("Pixel surface data length does not match its dimensions.");
  }
}

function cloneSurface(surface: PixelSurface): PixelSurface {
  return { ...surface, data: new Uint8ClampedArray(surface.data) };
}

function emptyLike(surface: PixelSurface): PixelSurface {
  return { ...surface, data: new Uint8ClampedArray(surface.data.length) };
}

type Rgba = [number, number, number, number];

function read(surface: PixelSurface, x: number, y: number): Rgba {
  const px = Math.min(surface.width - 1, Math.max(0, Math.round(x)));
  const py = Math.min(surface.height - 1, Math.max(0, Math.round(y)));
  const offset = (py * surface.width + px) * 4;
  const alpha = surface.alphaMode === "none" ? 1 : surface.data[offset + 3]! / 255;
  const divisor = surface.alphaMode === "premultiplied" && alpha > 0 ? alpha : 1;
  return [
    clamp(surface.data[offset]! / 255 / divisor),
    clamp(surface.data[offset + 1]! / 255 / divisor),
    clamp(surface.data[offset + 2]! / 255 / divisor),
    alpha
  ];
}

function edgeCoordinate(value: number, size: number, mode: string): number {
  if (mode === "wrap") return ((value % size) + size) % size;
  if (mode === "mirror") {
    const period = Math.max(1, size * 2 - 2);
    const wrapped = ((value % period) + period) % period;
    return wrapped < size ? wrapped : period - wrapped;
  }
  return Math.min(size - 1, Math.max(0, value));
}

function readEdge(surface: PixelSurface, x: number, y: number, mode: string): Rgba {
  return read(
    surface,
    edgeCoordinate(x, surface.width, mode),
    edgeCoordinate(y, surface.height, mode)
  );
}

function write(surface: PixelSurface, x: number, y: number, rgba: Rgba): void {
  const offset = (y * surface.width + x) * 4;
  const alpha = surface.alphaMode === "none" ? 1 : clamp(rgba[3]);
  const alphaByte = Math.round(alpha * 255);
  const multiplier = surface.alphaMode === "premultiplied" ? alpha : 1;
  const visible = alphaByte > 0 ? multiplier : 0;
  surface.data[offset] = Math.round(clamp(rgba[0]) * visible * 255);
  surface.data[offset + 1] = Math.round(clamp(rgba[1]) * visible * 255);
  surface.data[offset + 2] = Math.round(clamp(rgba[2]) * visible * 255);
  surface.data[offset + 3] = alphaByte;
}

function mixColor(a: Rgba, b: Rgba, t: number): Rgba {
  const amount = clamp(t);
  return [
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
    a[3] + (b[3] - a[3]) * amount
  ];
}

function numberParam(params: Readonly<Record<string, unknown>>, name: string, fallback: number): number {
  const value = params[name];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringParam(params: Readonly<Record<string, unknown>>, name: string, fallback: string): string {
  const value = params[name];
  return typeof value === "string" ? value : fallback;
}

function booleanParam(params: Readonly<Record<string, unknown>>, name: string, fallback: boolean): boolean {
  const value = params[name];
  return typeof value === "boolean" ? value : fallback;
}

function vectorParam(
  params: Readonly<Record<string, unknown>>,
  name: string,
  fallback: readonly [number, number]
): readonly [number, number] {
  const value = params[name];
  if (Array.isArray(value) && value.length === 2
    && typeof value[0] === "number" && Number.isFinite(value[0])
    && typeof value[1] === "number" && Number.isFinite(value[1])) {
    return [value[0], value[1]];
  }
  return fallback;
}

function defaultParams(blueprint: EffectBlueprint): Record<string, unknown> {
  return Object.fromEntries(blueprint.parameters.map((spec) => [spec.name, spec.default]));
}

export function normalizeEffectParams(
  effectId: string,
  supplied: Readonly<Record<string, unknown>> = {}
): JsonObject {
  const blueprint = blueprintById.get(effectId);
  if (!blueprint) throw new RangeError(`Unknown Group 2 P0 effect: ${effectId}`);
  const output: JsonObject = {};
  for (const spec of blueprint.parameters) {
    const value = supplied[spec.name];
    if (spec.kind === "number") {
      const numeric = typeof value === "number" && Number.isFinite(value) ? value : spec.default;
      output[spec.name] = clamp(numeric, spec.min, spec.max);
    } else if (spec.kind === "enum") {
      output[spec.name] = typeof value === "string" && spec.options.includes(value) ? value : spec.default;
    } else if (spec.kind === "text") {
      const textual = typeof value === "string" ? value : spec.default;
      output[spec.name] = textual.slice(0, spec.maxLength);
    } else if (spec.kind === "boolean") {
      output[spec.name] = typeof value === "boolean" ? value : spec.default;
    } else {
      const vectorValue = vectorParam(supplied, spec.name, spec.default);
      output[spec.name] = [
        clamp(vectorValue[0], spec.min, spec.max),
        clamp(vectorValue[1], spec.min, spec.max)
      ];
    }
  }
  return output;
}

function eased(progress: number): number {
  return 1 - (1 - clamp(progress)) ** 3;
}

function transformedSample(
  source: PixelSurface,
  u: number,
  v: number,
  transform: (u: number, v: number) => readonly [number, number]
): Rgba {
  const [su, sv] = transform(u, v);
  if (su < 0 || su > 1 || sv < 0 || sv > 1) return [0, 0, 0, 0];
  return read(source, su * (source.width - 1), sv * (source.height - 1));
}

function renderMotion(
  blueprint: EffectBlueprint,
  source: PixelSurface,
  params: Readonly<Record<string, unknown>>,
  options: EffectRuntimeOptions
): PixelSurface {
  const output = emptyLike(source);
  const p = eased(options.progress);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const u = source.width === 1 ? 0.5 : x / (source.width - 1);
      const v = source.height === 1 ? 0.5 : y / (source.height - 1);
      let rgba: Rgba;
      if (blueprint.sourceId === "M01") {
        rgba = read(source, x, y);
        const duration = Math.max(0.01, numberParam(params, "duration", 1));
        const fadeProgress = applyEasing(
          options.progress / duration,
          stringParam(params, "easing", "easeOut")
        );
        const alpha = numberParam(params, "from", 0)
          + (numberParam(params, "to", 1) - numberParam(params, "from", 0)) * fadeProgress;
        rgba[3] *= clamp(alpha);
      } else if (blueprint.sourceId === "M02") {
        const direction = stringParam(params, "direction", "left");
        const distance = numberParam(params, "distance", 0.35) * (1 - p);
        const overshoot = numberParam(params, "overshoot", 0.08) * Math.sin(p * Math.PI);
        const custom = vectorParam(params, "vector", [1, 0]);
        const dx = direction === "left" ? -distance + overshoot
          : direction === "right" ? distance - overshoot : 0;
        const dy = direction === "up" ? -distance + overshoot
          : direction === "down" ? distance - overshoot : 0;
        const customAmount = distance * 0.25;
        rgba = transformedSample(source, u, v, (su, sv) => [
          su - dx - custom[0] * customAmount,
          sv - dy - custom[1] * customAmount
        ]);
      } else if (blueprint.sourceId === "M03") {
        const start = numberParam(params, "startScale", 0.2);
        const end = numberParam(params, "endScale", 1);
        const spring = numberParam(params, "spring", 0.65);
        const scale = Math.max(0.001, start + (end - start) * p
          + Math.sin(p * Math.PI * 3) * spring * (1 - p) * 0.18);
        const pivot = vectorParam(params, "pivot", [0.5, 0.5]);
        rgba = transformedSample(source, u, v, (su, sv) => [
          pivot[0] + (su - pivot[0]) / scale,
          pivot[1] + (sv - pivot[1]) / scale
        ]);
      } else if (blueprint.sourceId === "M04") {
        const pivot = vectorParam(params, "pivot", [0.5, 0.5]);
        const angle = (numberParam(params, "angle", -90)
          + numberParam(params, "turns", 0) * 360) * (1 - p) * Math.PI / 180;
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        rgba = transformedSample(source, u, v, (su, sv) => {
          const dx = su - pivot[0];
          const dy = sv - pivot[1];
          return [pivot[0] + dx * cosine - dy * sine, pivot[1] + dx * sine + dy * cosine];
        });
        const blur = numberParam(params, "blur", 0.08) * (1 - p);
        if (blur > 0) {
          const blurred = transformedSample(source, u + blur * 0.15, v, (su, sv) => {
            const dx = su - pivot[0];
            const dy = sv - pivot[1];
            return [pivot[0] + dx * cosine - dy * sine, pivot[1] + dx * sine + dy * cosine];
          });
          rgba = mixColor(rgba, blurred, clamp(blur));
        }
      } else if (blueprint.sourceId === "M05") {
        const bounceCount = Math.max(1, Math.round(numberParam(params, "bounces", 3)));
        const height = numberParam(params, "height", 0.25);
        const gravity = numberParam(params, "gravity", 9.8);
        const damping = numberParam(params, "damping", 0.55);
        const gravityScale = clamp(gravity / 9.8, 0.05, 4);
        const offset = Math.abs(Math.sin(p * Math.PI * bounceCount * gravityScale))
          * height * (1 - p) ** (1 + damping * gravityScale);
        rgba = transformedSample(source, u, v, (su, sv) => [su, sv + offset]);
      } else if (blueprint.sourceId === "M06") {
        const amplitude = numberParam(params, "amplitude", 0.16);
        const decay = numberParam(params, "decay", 5);
        const period = Math.max(0.02, numberParam(params, "period", 0.28));
        const displacement = amplitude * Math.sin(p * TAU / period) * Math.exp(-decay * p);
        const axis = stringParam(params, "axis", "x");
        const scale = axis === "scale" ? Math.max(0.05, 1 + displacement) : 1;
        rgba = transformedSample(source, u, v, (su, sv) => axis === "x"
          ? [su - displacement, sv]
          : axis === "y"
            ? [su, sv - displacement]
            : [0.5 + (su - 0.5) / scale, 0.5 + (sv - 0.5) / scale]);
      } else if (blueprint.sourceId === "M07") {
        const range = numberParam(params, "range", 0.04);
        const frequency = numberParam(params, "frequency", 1);
        const phase = numberParam(params, "phase", 0);
        const amount = Math.sin(options.progress * TAU * frequency + phase) * range;
        const axis = stringParam(params, "axis", "y");
        rgba = transformedSample(source, u, v, (su, sv) => [
          su - (axis === "x" || axis === "both" ? amount : 0),
          sv - (axis === "y" || axis === "both" ? amount : 0)
        ]);
      } else {
        const intensity = numberParam(params, "intensity", 0.04);
        const frequency = numberParam(params, "frequency", 12);
        const decay = numberParam(params, "decay", 2.5);
        const seed = options.seed + numberParam(params, "seedOffset", 0);
        const step = Math.floor(options.progress * frequency * 10);
        const attenuation = Math.exp(-decay * options.progress);
        const dx = (hash(step, 1, seed) * 2 - 1) * intensity * attenuation;
        const dy = (hash(step, 2, seed) * 2 - 1) * intensity * attenuation;
        rgba = transformedSample(source, u, v, (su, sv) => [su - dx, sv - dy]);
      }
      write(output, x, y, rgba);
    }
  }
  return output;
}

function glyphCell(u: number, v: number): { index: number; localX: number; localY: number } {
  const columns = 12;
  const rows = 5;
  const gx = Math.min(columns - 1, Math.floor(u * columns));
  const gy = Math.min(rows - 1, Math.floor(v * rows));
  return {
    index: gy * columns + gx,
    localX: fract(u * columns),
    localY: fract(v * rows)
  };
}

function renderText(
  blueprint: EffectBlueprint,
  source: PixelSurface,
  params: Readonly<Record<string, unknown>>,
  options: EffectRuntimeOptions
): PixelSurface {
  const output = emptyLike(source);
  const p = clamp(numberParam(params, "progress", options.progress));
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const u = source.width === 1 ? 0.5 : x / (source.width - 1);
      const v = source.height === 1 ? 0.5 : y / (source.height - 1);
      const cell = glyphCell(u, v);
      let sample = read(source, x, y);
      let visibility = 1;
      if (blueprint.sourceId === "T01") {
        const speed = numberParam(params, "speed", 12);
        const wordMode = booleanParam(params, "wordMode", false);
        const revealIndex = wordMode ? Math.floor(cell.index / 5) * 5 : cell.index;
        const revealProgress = clamp(p * (0.6 + speed / 30));
        visibility = revealIndex / 60 <= revealProgress ? 1 : 0;
        const cursorWidth = numberParam(params, "cursorWidth", 0.08);
        if (booleanParam(params, "cursor", true)
          && Math.abs(revealIndex / 60 - revealProgress) < 0.04
          && cell.localX > 1 - cursorWidth) sample = [1, 1, 1, 1];
      } else if (blueprint.sourceId === "T02") {
        const stagger = numberParam(params, "stagger", 0.04);
        const selector = stringParam(params, "selector", "character");
        const groupSize = selector === "word" ? 5 : selector === "line" ? 12 : selector === "paragraph" ? 60 : 1;
        const selectedIndex = Math.floor(cell.index / groupSize) * groupSize;
        const threshold = clamp(p * 1.4 - selectedIndex * stagger / 3);
        const offset = (1 - threshold) * numberParam(params, "offset", 0.25);
        const axis = stringParam(params, "axis", "y");
        sample = transformedSample(source, u, v, (su, sv) =>
          axis === "x" ? [su - offset, sv] : [su, sv - offset]);
        visibility = threshold;
      } else if (blueprint.sourceId === "T03") {
        const strength = numberParam(params, "strength", 0.35);
        const layout = stringParam(params, "layoutMode", "grid");
        const beatHash = hashString(stringParam(params, "beatMap", "0,0.5,1"));
        const scaleHash = hashString(stringParam(params, "scaleMap", "0.8,1.2,1"));
        const layoutPhase = layout === "radial"
          ? Math.atan2(v - 0.5, u - 0.5) : layout === "stack" ? v * 8 : cell.index % 7;
        const pulse = 1 + Math.sin(layoutPhase + p * TAU * (1 + beatHash * 3))
          * strength * (0.15 + scaleHash * 0.25);
        sample = transformedSample(source, u, v, (su, sv) => {
          const centerU = (Math.floor(su * 12) + 0.5) / 12;
          const centerV = (Math.floor(sv * 5) + 0.5) / 5;
          const radialOffset = layout === "radial" ? (pulse - 1) * 0.04 : 0;
          const scaleMapOffset = (scaleHash - 0.5) * strength * 0.18;
          return [
            centerU + (su - centerU) / pulse
              + (su - 0.5) * (radialOffset + scaleMapOffset),
            centerV + (sv - centerV) / pulse
              + (sv - 0.5) * (radialOffset + scaleMapOffset)
          ];
        });
      } else if (blueprint.sourceId === "T04") {
        const pathHash = hashString(stringParam(params, "path", ""));
        const orientation = stringParam(params, "orientation", "tangent");
        const pathY = 0.5 + Math.sin(u * TAU * (1 + pathHash * 2) + pathHash * TAU) * (0.12 + pathHash * 0.18);
        const pathProgress = orientation === "upright" ? v * 0.25 + u * 0.75 : u;
        const feather = numberParam(params, "feather", 0.04);
        visibility = (1 - smoothstep(p - feather, p + feather, pathProgress))
          * smoothstep(0.16, 0.02, Math.abs(v - pathY));
      } else if (blueprint.sourceId === "T05") {
        const sourceHash = hashString(stringParam(params, "sourceText", "CODE"));
        const targetHash = hashString(stringParam(params, "targetText", "MOTION"));
        const matchMode = stringParam(params, "matchMode", "glyph");
        const matchScale = matchMode === "outline" ? 1.8 : matchMode === "position" ? 0.65 : 1;
        const wobble = Math.sin(cell.index * (1.2 + sourceHash)
          + p * Math.PI * (1 + targetHash)) * 0.025 * matchScale * Math.sin(p * Math.PI);
        sample = transformedSample(source, u, v, (su, sv) => [su + wobble, sv - wobble]);
        sample[0] = clamp(sample[0] + p * (0.06 + targetHash * 0.12));
        sample[2] = clamp(sample[2] + (1 - p) * (0.06 + sourceHash * 0.12));
      } else if (blueprint.sourceId === "T06") {
        const direction = stringParam(params, "lockDirection", "left-to-right");
        const charsetHash = hashString(stringParam(params, "charset", ""));
        const speed = numberParam(params, "speed", 24);
        const decodeProgress = clamp(p * (0.5 + speed / 48));
        const threshold = direction === "right-to-left" ? 1 - u
          : direction === "random" ? hash(cell.index, 0, options.seed) : u;
        if (threshold > decodeProgress) {
          const noise = hash(cell.index, Math.floor(p * speed), options.seed + charsetHash * 997);
          sample = [noise, 1 - noise * 0.5, 0.7 + noise * 0.3, sample[3] * 0.8];
        }
      } else {
        const force = numberParam(params, "force", 0.45) * p;
        const selector = stringParam(params, "selector", "word");
        const selectedIndex = selector === "word" ? Math.floor(cell.index / 5) * 5 : cell.index;
        const rotation = numberParam(params, "rotation", 35) * Math.PI / 180;
        const angle = hash(selectedIndex, 3, options.seed) * TAU + rotation * p;
        const dx = Math.cos(angle) * force * p;
        const dy = Math.sin(angle) * force * p;
        const cosine = Math.cos(rotation * p);
        const sine = Math.sin(rotation * p);
        sample = transformedSample(source, u, v, (su, sv) => {
          const localU = su - 0.5 - dx;
          const localV = sv - 0.5 - dy;
          return [0.5 + localU * cosine - localV * sine, 0.5 + localU * sine + localV * cosine];
        });
        visibility = 1 - p * numberParam(params, "depth", 0.3);
      }
      sample[3] *= clamp(visibility);
      write(output, x, y, sample);
    }
  }
  return output;
}

function coverageForVector(
  sourceId: EffectBlueprint["sourceId"],
  u: number,
  v: number,
  params: Readonly<Record<string, unknown>>,
  options: EffectRuntimeOptions
): number {
  const p = clamp(numberParam(params, "progress", options.progress));
  if (sourceId === "V01") {
    const offset = numberParam(params, "offset", 0);
    const angle = fract(Math.atan2(v - 0.5, u - 0.5) / TAU + 1 + offset);
    const start = numberParam(params, "start", 0);
    const end = numberParam(params, "end", 0.75) * p;
    const radius = Math.hypot(u - 0.5, v - 0.5);
    const strokeWidth = numberParam(params, "strokeWidth", 0.03);
    return smoothstep(strokeWidth, 0, Math.abs(radius - 0.305))
      * (angle >= start && angle <= end ? 1 : 0);
  }
  if (sourceId === "V02") {
    const fromHash = hashString(stringParam(params, "fromPath", ""));
    const toHash = hashString(stringParam(params, "toPath", ""));
    const normalize = booleanParam(params, "normalize", true);
    const aspect = normalize ? 1 : 0.65 + fromHash * 0.7;
    const du = (u - 0.5) * aspect;
    const diamond = (Math.abs(du) + Math.abs(v - 0.5)) * (0.8 + fromHash * 0.4);
    const circle = Math.hypot(du, v - 0.5) * (0.8 + toHash * 0.4);
    const distance = diamond * (1 - p) + circle * p;
    return smoothstep(0.37, 0.34, Math.abs(distance - 0.34));
  }
  if (sourceId === "V03") {
    const count = Math.max(1, Math.round(numberParam(params, "count", 8)));
    const offset = vectorParam(params, "offset", [0.08, 0.04]);
    const rotation = numberParam(params, "rotation", 12) * Math.PI / 180;
    const scale = Math.max(0.01, numberParam(params, "scale", 0.92));
    const rotated = (u + offset[0]) * Math.cos(rotation)
      + (v + offset[1]) * Math.sin(rotation);
    const cell = fract(rotated * count / scale);
    return smoothstep(0.18 / scale, 0.02, Math.abs(cell - 0.5));
  }
  if (sourceId === "V04") {
    const count = Math.max(2, Math.round(numberParam(params, "count", 24)));
    const rotation = numberParam(params, "angle", 0) / 360;
    const angle = fract((Math.atan2(v - 0.5, u - 0.5) / TAU + rotation) * count);
    const radius = Math.hypot(u - 0.5, v - 0.5);
    const thickness = numberParam(params, "thickness", 0.012);
    return radius < numberParam(params, "radius", 0.42)
      ? smoothstep(Math.min(0.48, thickness * count), 0.002, Math.min(angle, 1 - angle)) : 0;
  }
  if (sourceId === "D01") {
    const pathHash = hashString(stringParam(params, "path", ""));
    const pressure = numberParam(params, "pressure", 0.7);
    const variation = numberParam(params, "speedVariation", 0.25);
    const path = 0.62 - (0.18 + pathHash * 0.2)
      * Math.sin(u * Math.PI * (1.6 + pathHash * 2));
    const revealHead = p + (variation - 0.25) * 0.3
      + Math.sin(u * 19) * variation * 0.12;
    const revealed = u <= clamp(revealHead) ? 1 : 0;
    return revealed * smoothstep(0.02 + pressure * 0.07, 0.003, Math.abs(v - path));
  }
  if (sourceId === "D02") {
    const textureHash = hashString(stringParam(params, "brushTexture", ""));
    const size = numberParam(params, "size", 0.12);
    const noise = hash(Math.floor(u / Math.max(0.005, size)), Math.floor(v / Math.max(0.005, size)), options.seed + textureHash * 997);
    return smoothstep(p + size, p - size, u + (noise - 0.5) * numberParam(params, "roughness", 0.35));
  }
  if (sourceId === "D03") {
    const distance = Math.hypot(u - 0.5, v - 0.5);
    const noise = (hash(Math.floor(u * 32), Math.floor(v * 32), options.seed) - 0.5)
      * numberParam(params, "edgeNoise", 0.2);
    const diffusion = numberParam(params, "diffusion", 0.55);
    const absorption = numberParam(params, "absorption", 0.65);
    const radius = p * (0.35 + diffusion * 0.75);
    return smoothstep(radius + noise, radius - (0.02 + absorption * 0.14), distance)
      * (0.55 + absorption * 0.45);
  }
  const grain = hash(Math.floor(u * 90), Math.floor(v * 90), options.seed);
  const stroke = smoothstep(0.12, 0.02, Math.abs(v - (0.25 + u * 0.5)));
  const scatter = numberParam(params, "scatter", 0.18);
  const opacity = numberParam(params, "opacity", 0.85);
  const scattered = hash(Math.floor(u * 37), Math.floor(v * 53), options.seed + 17);
  return u <= p + (scattered - 0.5) * scatter
    ? stroke * (grain > numberParam(params, "grain", 0.55) * 0.45 ? 1 : 0.25) * opacity : 0;
}

function renderVectorOrDraw(
  blueprint: EffectBlueprint,
  source: PixelSurface,
  params: Readonly<Record<string, unknown>>,
  options: EffectRuntimeOptions
): PixelSurface {
  const output = emptyLike(source);
  const isDraw = blueprint.category === "draw";
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const u = source.width === 1 ? 0.5 : x / (source.width - 1);
      const v = source.height === 1 ? 0.5 : y / (source.height - 1);
      const sourceColor = read(source, x, y);
      const coverage = coverageForVector(blueprint.sourceId, u, v, params, options);
      const ink: Rgba = isDraw ? [0.96, 0.88, 0.7, coverage] : [0.25, 0.82, 1, coverage];
      write(output, x, y, mixColor(sourceColor, ink, coverage * (isDraw ? 0.9 : 0.75)));
    }
  }
  return output;
}

function parseHex(value: string): readonly [number, number, number] {
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu.exec(value);
  if (!match) return [0.26, 0.78, 1];
  return [
    Number.parseInt(match[1]!, 16) / 255,
    Number.parseInt(match[2]!, 16) / 255,
    Number.parseInt(match[3]!, 16) / 255
  ];
}

function renderLight(
  blueprint: EffectBlueprint,
  source: PixelSurface,
  params: Readonly<Record<string, unknown>>,
  options: EffectRuntimeOptions
): PixelSurface {
  const output = emptyLike(source);
  const neon = parseHex(stringParam(params, "color", "#42C8FF"));
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const u = source.width === 1 ? 0.5 : x / (source.width - 1);
      const v = source.height === 1 ? 0.5 : y / (source.height - 1);
      const base = read(source, x, y);
      let light = 0;
      let color = neon;
      if (blueprint.sourceId === "L01") {
        const radius = numberParam(params, "radius", 0.08);
        const sampleRadius = Math.max(1, Math.round(radius * Math.min(source.width, source.height)));
        const neighbor = read(source, x + sampleRadius, y + sampleRadius);
        const edge = Math.abs(base[3] - neighbor[3]) + Math.abs(base[0] - neighbor[0]);
        const flicker = 1 - numberParam(params, "flicker", 0.12)
          * hash(Math.floor(options.progress * 30), 0, options.seed);
        light = clamp(edge * numberParam(params, "intensity", 1.8) * 4 * flicker);
      } else if (blueprint.sourceId === "L02") {
        const angle = numberParam(params, "angle", 18) * Math.PI / 180;
        const coordinate = u * Math.cos(angle) + v * Math.sin(angle);
        const center = fract(options.progress * numberParam(params, "speed", 0.8));
        const distance = Math.abs(fract(coordinate - center + 0.5) - 0.5);
        const width = numberParam(params, "width", 0.12);
        const softness = numberParam(params, "softness", 0.4);
        light = 1 - smoothstep(width * (1 - softness), width * (1 + softness), distance);
        color = [0.5, 0.9, 1];
      } else if (blueprint.sourceId === "L03") {
        const center = vectorParam(params, "source", [0.72, 0.28]);
        const distance = Math.hypot(u - center[0], v - center[1]);
        const ghosts = Math.max(1, numberParam(params, "ghosts", 5));
        const streak = numberParam(params, "streak", 0.45);
        const chromatic = numberParam(params, "chromatic", 0.08);
        const streakLight = Math.exp(-Math.abs(v - center[1]) * (30 / Math.max(0.05, streak)))
          * Math.exp(-Math.abs(u - center[0]) * 2);
        light = clamp((1 - smoothstep(0, 0.22, distance))
          + Math.max(0, Math.sin(distance * ghosts * 35)) * 0.16 + streakLight * streak);
        color = [1, clamp(0.72 - chromatic * 0.4), clamp(0.32 + chromatic * 0.8)];
      } else {
        const center = vectorParam(params, "center", [0.5, 0.5]);
        const radius = numberParam(params, "radius", 0.34) * (0.65 + options.progress * 0.7);
        const distance = Math.hypot(u - center[0], v - center[1]);
        const rings = Math.max(1, numberParam(params, "rings", 4));
        const falloff = numberParam(params, "falloff", 0.2);
        light = Math.exp(-Math.abs(distance - radius) * (8 / Math.max(0.001, falloff)))
          * (0.65 + 0.35 * Math.sin(distance * rings * 60));
        color = [0.55, 0.3, 1];
      }
      write(output, x, y, [
        clamp(base[0] + color[0] * light),
        clamp(base[1] + color[1] * light),
        clamp(base[2] + color[2] * light),
        base[3]
      ]);
    }
  }
  return output;
}

function renderPost(
  blueprint: EffectBlueprint,
  source: PixelSurface,
  params: Readonly<Record<string, unknown>>,
  options: EffectRuntimeOptions
): PixelSurface {
  const output = emptyLike(source);
  const qualitySamples = options.quality === "draft" ? 3 : options.quality === "preview" ? 5 : 9;
  const passes = Math.max(1, Math.round(numberParam(params, "passes", 1)));
  const requestedSamples = blueprint.sourceId === "P01"
    ? Math.min(32, qualitySamples + passes - 1)
    : Math.round(numberParam(params, "samples", qualitySamples));
  const samples = Math.max(1, Math.min(qualitySamples, requestedSamples));
  const edgeMode = stringParam(params, "edgeMode", "clamp");
  const alphaAware = booleanParam(params, "alphaAware", true);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const u = source.width === 1 ? 0.5 : x / (source.width - 1);
      const v = source.height === 1 ? 0.5 : y / (source.height - 1);
      const sum: Rgba = [0, 0, 0, 0];
      let weightTotal = 0;
      for (let sampleIndex = 0; sampleIndex < samples; sampleIndex += 1) {
        const t = samples === 1 ? 0 : sampleIndex / (samples - 1) - 0.5;
        let su = u;
        let sv = v;
        let weight = 1;
        if (blueprint.sourceId === "P01") {
          const radius = numberParam(params, "radius", 6) * Math.sqrt(passes);
          const angle = (sampleIndex / samples) * TAU;
          su += Math.cos(angle) * radius * Math.abs(t) / Math.max(1, source.width);
          sv += Math.sin(angle) * radius * Math.abs(t) / Math.max(1, source.height);
          weight = Math.exp(-t * t * 4);
        } else if (blueprint.sourceId === "P02") {
          const angle = numberParam(params, "angle", 0) * Math.PI / 180;
          const distance = numberParam(params, "distance", 12);
          su += Math.cos(angle) * distance * t / Math.max(1, source.width);
          sv += Math.sin(angle) * distance * t / Math.max(1, source.height);
        } else if (blueprint.sourceId === "P03") {
          const center = vectorParam(params, "center", [0.5, 0.5]);
          const strength = numberParam(params, "strength", 0.16) * t;
          if (stringParam(params, "mode", "zoom") === "spin") {
            const angle = strength;
            const dx = u - center[0];
            const dy = v - center[1];
            su = center[0] + dx * Math.cos(angle) - dy * Math.sin(angle);
            sv = center[1] + dx * Math.sin(angle) + dy * Math.cos(angle);
          } else {
            su += (u - center[0]) * strength;
            sv += (v - center[1]) * strength;
          }
        } else {
          const velocity = vectorParam(params, "velocity", [0.08, 0]);
          const shutter = numberParam(params, "shutterAngle", 180) / 360;
          const centered = booleanParam(params, "centered", true);
          const sampleTime = centered ? t : sampleIndex / Math.max(1, samples - 1);
          su += velocity[0] * shutter * sampleTime;
          sv += velocity[1] * shutter * sampleTime;
        }
        const rgba = readEdge(
          source,
          su * (source.width - 1),
          sv * (source.height - 1),
          edgeMode
        );
        if (blueprint.sourceId === "P01" && alphaAware) weight *= rgba[3];
        for (let channel = 0; channel < 4; channel += 1) sum[channel]! += rgba[channel]! * weight;
        weightTotal += weight;
      }
      if (weightTotal <= 0) write(output, x, y, [0, 0, 0, 0]);
      else {
        for (let channel = 0; channel < 4; channel += 1) sum[channel]! /= weightTotal;
        write(output, x, y, sum);
      }
    }
  }
  return output;
}

function transitionCoverage(
  sourceId: EffectBlueprint["sourceId"],
  u: number,
  v: number,
  progress: number,
  params: Readonly<Record<string, unknown>>,
  options: EffectRuntimeOptions
): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  if (sourceId === "C01") {
    const direction = stringParam(params, "direction", "left");
    const angle = numberParam(params, "angle", 0) * Math.PI / 180;
    const rotated = (u - 0.5) * Math.cos(angle) + (v - 0.5) * Math.sin(angle) + 0.5;
    const coordinate = direction === "right" ? 1 - rotated
      : direction === "up" ? v * Math.cos(angle) - (u - 0.5) * Math.sin(angle)
        : direction === "down" ? 1 - (v * Math.cos(angle) - (u - 0.5) * Math.sin(angle))
          : rotated;
    const softness = numberParam(params, "softness", 0.04);
    return smoothstep(progress - softness, progress + softness, 1 - coordinate);
  }
  if (sourceId === "C02") {
    const center = vectorParam(params, "center", [0.5, 0.5]);
    const start = numberParam(params, "startAngle", -90) / 360;
    let angle = fract(Math.atan2(v - center[1], u - center[0]) / TAU - start + 1);
    if (!booleanParam(params, "clockwise", true)) angle = 1 - angle;
    return angle <= progress ? 1 : 0;
  }
  if (sourceId === "C03") {
    const noise = numberParam(params, "noise", 0.16);
    const viscosity = numberParam(params, "viscosity", 0.6);
    const frequency = 8 + (1 - viscosity) * 48;
    const edge = u + (hash(Math.floor(v * frequency), Math.floor(u * frequency * 0.5), options.seed) - 0.5) * noise;
    const softness = 0.015 + (1 - viscosity) * 0.1;
    return smoothstep(progress - softness, progress + softness, 1 - edge);
  }
  const grid = Math.max(2, Math.round(numberParam(params, "grid", 20)));
  const cellX = Math.floor(u * grid);
  const cellY = Math.floor(v * grid);
  const order = stringParam(params, "order", "random");
  const threshold = order === "linear" ? cellX / grid
    : order === "radial" ? Math.hypot(u - 0.5, v - 0.5) * 1.414
      : hash(cellX, cellY, options.seed + numberParam(params, "seed", 1));
  return threshold <= progress ? 1 : 0;
}

function renderTransition(
  blueprint: EffectBlueprint,
  source: PixelSurface,
  params: Readonly<Record<string, unknown>>,
  options: EffectRuntimeOptions
): PixelSurface {
  const secondary = options.secondary ?? source;
  assertSurface(secondary);
  if (secondary.width !== source.width || secondary.height !== source.height) {
    throw new RangeError("Transition A/B inputs must have equal dimensions.");
  }
  const p = clamp(numberParam(params, "progress", options.progress));
  if (p <= 0) return cloneSurface(source);
  if (p >= 1) return cloneSurface(secondary);
  const output = emptyLike(source);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const u = source.width === 1 ? 0.5 : x / (source.width - 1);
      const v = source.height === 1 ? 0.5 : y / (source.height - 1);
      const coverage = transitionCoverage(blueprint.sourceId, u, v, p, params, options);
      const mixed = mixColor(read(source, x, y), read(secondary, x, y), coverage);
      if (blueprint.sourceId === "C03") {
        const glow = numberParam(params, "edgeGlow", 0.25)
          * Math.max(0, 1 - Math.abs(coverage - 0.5) * 2);
        mixed[0] = clamp(mixed[0] + glow * 0.2);
        mixed[1] = clamp(mixed[1] + glow * 0.55);
        mixed[2] = clamp(mixed[2] + glow);
      }
      write(output, x, y, mixed);
    }
  }
  return output;
}

function luma(color: Rgba): number {
  return color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
}

function blend(base: Rgba, top: Rgba, mode: string, opacity: number): Rgba {
  const amount = clamp(opacity * top[3]);
  const output = [...base] as Rgba;
  for (let channel = 0; channel < 3; channel += 1) {
    const value = mode === "multiply" ? base[channel]! * top[channel]!
      : mode === "screen" ? base[channel]! + top[channel]! - base[channel]! * top[channel]!
        : mode === "add" ? Math.min(1, base[channel]! + top[channel]!)
          : mode === "difference" ? Math.abs(base[channel]! - top[channel]!)
            : top[channel]!;
    output[channel] = base[channel]! + (value - base[channel]!) * amount;
  }
  output[3] = amount + base[3] * (1 - amount);
  return output;
}

function renderComposite(
  blueprint: EffectBlueprint,
  source: PixelSurface,
  params: Readonly<Record<string, unknown>>,
  options: EffectRuntimeOptions
): PixelSurface {
  const secondary = options.secondary ?? options.mask ?? source;
  assertSurface(secondary);
  if (secondary.width !== source.width || secondary.height !== source.height) {
    throw new RangeError("Composite inputs must have equal dimensions.");
  }
  const output = emptyLike(source);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const base = read(source, x, y);
      const matte = read(secondary, x, y);
      let result: Rgba;
      if (blueprint.sourceId === "H01") {
        let coverage = matte[3];
        const maskRef = hashString(stringParam(params, "mask", "context://mask"));
        if (booleanParam(params, "invert", false)) coverage = 1 - coverage;
        const p = numberParam(params, "progress", options.progress);
        const feather = numberParam(params, "feather", 0.04);
        const threshold = clamp(p + (maskRef - 0.5) * 0.12);
        coverage = smoothstep(threshold - feather, threshold + feather, coverage);
        result = [...base] as Rgba;
        result[3] *= coverage;
      } else if (blueprint.sourceId === "H02") {
        const matteRef = hashString(stringParam(params, "matteLayer", "context://secondary"));
        const shiftedMatte = read(
          secondary,
          x + (matteRef - 0.5) * secondary.width * 0.1,
          y - (matteRef - 0.5) * secondary.height * 0.1
        );
        let coverage = stringParam(params, "mode", "alpha") === "luma"
          ? luma(shiftedMatte) : shiftedMatte[3];
        if (booleanParam(params, "invert", false)) coverage = 1 - coverage;
        result = [...base] as Rgba;
        result[3] *= coverage * numberParam(params, "opacity", 1);
      } else if (blueprint.sourceId === "H03") {
        const premultiply = booleanParam(params, "premultiply", true);
        const top = [...matte] as Rgba;
        if (!premultiply) {
          top[0] = clamp(top[0] * (0.5 + top[3] * 0.5));
          top[1] = clamp(top[1] * (0.5 + top[3] * 0.5));
          top[2] = clamp(top[2] * (0.5 + top[3] * 0.5));
        }
        const opacity = numberParam(params, "opacity", 1) * numberParam(params, "mix", 1);
        result = blend(base, top, stringParam(params, "mode", "normal"), opacity);
      } else {
        const channel = stringParam(params, "channel", "luma");
        const sampledValue = channel === "red" ? matte[0] : channel === "green" ? matte[1]
          : channel === "blue" ? matte[2] : channel === "alpha" ? matte[3] : luma(matte);
        const value = Math.round(sampledValue * 3) / 3;
        const mapRef = hashString(stringParam(params, "map", "context://secondary"));
        const mapBias = (mapRef - 0.5) * 0.25;
        const sx = x + (value - 0.5 + mapBias) * numberParam(params, "xAmount", 0.05) * source.width;
        const sy = y + (value - 0.5 - mapBias) * numberParam(params, "yAmount", 0.05) * source.height;
        result = read(source, sx, sy);
      }
      write(output, x, y, result);
    }
  }
  return output;
}

function applyMask(output: PixelSurface, mask: PixelSurface | undefined): PixelSurface {
  if (!mask) return output;
  assertSurface(mask);
  if (mask.width !== output.width || mask.height !== output.height) {
    throw new RangeError("Mask and effect output must have equal dimensions.");
  }
  const masked = cloneSurface(output);
  for (let y = 0; y < output.height; y += 1) {
    for (let x = 0; x < output.width; x += 1) {
      const color = read(output, x, y);
      color[3] *= read(mask, x, y)[3];
      write(masked, x, y, color);
    }
  }
  return masked;
}

export function renderEffectPixels(
  effectId: string,
  source: PixelSurface,
  suppliedParams: Readonly<Record<string, unknown>> = {},
  suppliedOptions: Partial<EffectRuntimeOptions> = {}
): PixelSurface {
  assertSurface(source);
  const blueprint = blueprintById.get(effectId);
  if (!blueprint) throw new RangeError(`Unknown Group 2 P0 effect: ${effectId}`);
  const params = { ...defaultParams(blueprint), ...normalizeEffectParams(effectId, suppliedParams) };
  const options: EffectRuntimeOptions = {
    progress: clamp(suppliedOptions.progress ?? numberParam(params, "progress", 0.5)),
    seed: Math.trunc(suppliedOptions.seed ?? 1),
    quality: suppliedOptions.quality ?? "preview",
    ...(suppliedOptions.secondary ? { secondary: suppliedOptions.secondary } : {}),
    ...(suppliedOptions.mask ? { mask: suppliedOptions.mask } : {})
  };
  const rendered = blueprint.category === "motion" ? renderMotion(blueprint, source, params, options)
    : blueprint.category === "text" ? renderText(blueprint, source, params, options)
      : blueprint.category === "vector" || blueprint.category === "draw"
        ? renderVectorOrDraw(blueprint, source, params, options)
        : blueprint.category === "light" ? renderLight(blueprint, source, params, options)
          : blueprint.category === "post" ? renderPost(blueprint, source, params, options)
            : blueprint.category === "transition" ? renderTransition(blueprint, source, params, options)
              : renderComposite(blueprint, source, params, options);
  return applyMask(rendered, options.mask);
}

export function makePreviewInput(width = 160, height = 90, alternate = false): PixelSurface {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const u = width === 1 ? 0 : x / (width - 1);
      const v = height === 1 ? 0 : y / (height - 1);
      data[offset] = Math.round((alternate ? 1 - u : u) * 230 + 20);
      data[offset + 1] = Math.round((alternate ? v : 1 - v) * 190 + 30);
      data[offset + 2] = Math.round((0.35 + 0.65 * Math.sin((u + v + (alternate ? 0.5 : 0)) * Math.PI) ** 2) * 255);
      data[offset + 3] = Math.round(clamp(0.2 + 0.8 * (u * 0.6 + v * 0.4)) * 255);
    }
  }
  return { width, height, data, colorSpace: "srgb", alphaMode: "straight" };
}

export function hashPixelSurface(surface: PixelSurface): string {
  let value = 0x811c9dc5;
  for (const byte of surface.data) {
    value ^= byte;
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(16).padStart(8, "0");
}

export function qualitySampleCount(quality: RenderQuality): number {
  return quality === "draft" ? 3 : quality === "preview" ? 5 : 9;
}

export function parameterSpecFor(effectId: string, name: string): ParameterSpec | undefined {
  return blueprintById.get(effectId)?.parameters.find((spec) => spec.name === name);
}
