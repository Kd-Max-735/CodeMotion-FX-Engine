import type { EffectRenderResult } from "@codemotion/effect-functions";
import type { FrameRequest } from "@codemotion/exporter";

type PixelBytes = Uint8Array | Uint8ClampedArray;

const TEXT_OVERLAY_TOOLS = new Set([
  "character_cascade", "kinetic_typography", "scramble_decode", "text_morph",
  "text_extrude_3d", "text_path_reveal", "typewriter", "word_explode"
]);

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !ArrayBuffer.isView(value)
    ? value as Record<string, unknown> : undefined;
}

function byteData(value: unknown): PixelBytes | undefined {
  if (value instanceof Uint8Array || value instanceof Uint8ClampedArray) return value;
  if (Array.isArray(value) && value.every((channel) => Number.isInteger(channel)
    && channel >= 0 && channel <= 255)) return Uint8Array.from(value);
  return undefined;
}

function exactFrame(result: EffectRenderResult, request: FrameRequest): Uint8Array | undefined {
  if (result.kind !== "frame") return undefined;
  const output = record(result.output);
  if (output === undefined || output.width !== request.width || output.height !== request.height) return undefined;
  const data = byteData(output.data);
  if (data === undefined || data.length !== request.width * request.height * 4) return undefined;
  return data instanceof Uint8Array
    ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function compositeExactTextFrame(
  source: Uint8Array,
  overlay: Uint8Array,
  request: FrameRequest
): Uint8Array {
  const output = new Uint8ClampedArray(source);
  for (let offset = 0; offset < overlay.length; offset += 4) {
    const overlayAlpha = overlay[offset + 3]! / 255;
    if (overlayAlpha === 0) continue;
    const sourceAlpha = output[offset + 3]! / 255;
    const alpha = overlayAlpha + sourceAlpha * (1 - overlayAlpha);
    for (let channel = 0; channel < 3; channel += 1) {
      output[offset + channel] = clampByte(alpha === 0 ? 0 : (
        overlay[offset + channel]! * overlayAlpha
        + output[offset + channel]! * sourceAlpha * (1 - overlayAlpha)
      ) / alpha);
    }
    output[offset + 3] = clampByte(alpha * 255);
  }
  if (output.length !== request.width * request.height * 4) {
    throw new RangeError("Composited text frame dimensions do not match the frame request.");
  }
  return new Uint8Array(output.buffer, output.byteOffset, output.byteLength);
}

function sourceFrame(source: Uint8Array | undefined, request: FrameRequest, toolName: string): Uint8ClampedArray {
  if (source?.length === request.width * request.height * 4) return new Uint8ClampedArray(source);
  const output = new Uint8ClampedArray(request.width * request.height * 4);
  let hash = 2166136261;
  for (const code of toolName) hash = Math.imul(hash ^ code.charCodeAt(0), 16777619);
  const red = 18 + (hash >>> 16 & 31);
  const green = 20 + (hash >>> 8 & 31);
  const blue = 24 + (hash & 31);
  for (let offset = 0; offset < output.length; offset += 4) {
    output[offset] = red;
    output[offset + 1] = green;
    output[offset + 2] = blue;
    output[offset + 3] = 255;
  }
  return output;
}

function blendPixel(
  output: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  color: readonly number[],
  opacity: number
): void {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= width || py >= height) return;
  const offset = (py * width + px) * 4;
  const alpha = Math.max(0, Math.min(1, opacity * ((color[3] ?? 255) / 255)));
  output[offset] = clampByte(output[offset]! * (1 - alpha) + (color[0] ?? 255) * alpha);
  output[offset + 1] = clampByte(output[offset + 1]! * (1 - alpha) + (color[1] ?? 255) * alpha);
  output[offset + 2] = clampByte(output[offset + 2]! * (1 - alpha) + (color[2] ?? 255) * alpha);
  output[offset + 3] = 255;
}

function drawDisc(
  output: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
  color: readonly number[],
  opacity: number
): void {
  const safeRadius = Math.max(1, Math.min(32, radius));
  for (let dy = -safeRadius; dy <= safeRadius; dy += 1) {
    for (let dx = -safeRadius; dx <= safeRadius; dx += 1) {
      const distance = Math.hypot(dx, dy);
      if (distance > safeRadius) continue;
      blendPixel(output, width, height, x + dx, y + dy, color, opacity * (1 - distance / (safeRadius + 1)));
    }
  }
}

function drawLine(
  output: Uint8ClampedArray,
  width: number,
  height: number,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  color: readonly number[],
  opacity = 1,
  thickness = 1
): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(toX - fromX, toY - fromY)));
  for (let step = 0; step <= steps; step += 1) {
    const progress = step / steps;
    drawDisc(
      output,
      width,
      height,
      fromX + (toX - fromX) * progress,
      fromY + (toY - fromY) * progress,
      thickness,
      color,
      opacity
    );
  }
}

function hexColor(value: unknown, fallback: readonly number[]): readonly number[] {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/iu.test(value)) return fallback;
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
    255
  ];
}

function pointToPixel(
  point: { readonly x: number; readonly y: number },
  width: number,
  height: number
): readonly [number, number] {
  const normalized = Math.abs(point.x) <= 4 && Math.abs(point.y) <= 4;
  return normalized
    ? [(point.x + 1) * 0.5 * (width - 1), (1 - (point.y + 1) * 0.5) * (height - 1)]
    : [point.x, point.y];
}

function finitePoint(value: unknown): { readonly x: number; readonly y: number } | undefined {
  const item = record(value);
  return item !== undefined && typeof item.x === "number" && Number.isFinite(item.x)
    && typeof item.y === "number" && Number.isFinite(item.y)
    ? { x: item.x, y: item.y } : undefined;
}

function drawGeometry(
  output: Uint8ClampedArray,
  value: unknown,
  request: FrameRequest,
  depth = 0
): void {
  if (depth > 6) return;
  if (Array.isArray(value)) {
    const points = value.map(finitePoint);
    if (points.length >= 2 && points.every((point) => point !== undefined)) {
      for (let index = 1; index < points.length; index += 1) {
        const from = pointToPixel(points[index - 1]!, request.width, request.height);
        const to = pointToPixel(points[index]!, request.width, request.height);
        drawLine(output, request.width, request.height, from[0], from[1], to[0], to[1], [72, 224, 255, 255], 0.9, 1.4);
      }
      return;
    }
    for (const item of value) drawGeometry(output, item, request, depth + 1);
    return;
  }
  const item = record(value);
  if (item === undefined) return;
  const from = finitePoint(item.from ?? item.start ?? item.a);
  const to = finitePoint(item.to ?? item.end ?? item.b);
  if (from !== undefined && to !== undefined) {
    const fromPixel = pointToPixel(from, request.width, request.height);
    const toPixel = pointToPixel(to, request.width, request.height);
    drawLine(output, request.width, request.height, fromPixel[0], fromPixel[1], toPixel[0], toPixel[1], [125, 244, 255, 255], 0.86, 1.2);
  }
  for (const child of Object.values(item)) drawGeometry(output, child, request, depth + 1);
}

function scalarField(
  output: Uint8ClampedArray,
  value: Record<string, unknown>,
  request: FrameRequest
): boolean {
  const width = typeof value.width === "number" && Number.isInteger(value.width) ? value.width : undefined;
  const height = typeof value.height === "number" && Number.isInteger(value.height) ? value.height : undefined;
  if (width === undefined || height === undefined || width < 1 || height < 1) return false;
  const candidates = [value.alpha, value.radiance, value.escape, value.field, value.values, value.heights, value.cells];
  const values = candidates.find((candidate) => Array.isArray(candidate)) as readonly unknown[] | undefined;
  if (values === undefined || values.length < width * height) return false;
  const channels = values.length >= width * height * 3 ? 3 : 1;
  const finite = values.filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry));
  if (finite.length === 0) return false;
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const entry of finite.slice(0, 65_536)) {
    minimum = Math.min(minimum, entry);
    maximum = Math.max(maximum, entry);
  }
  const range = Math.max(1e-9, maximum - minimum);
  const colors = Array.isArray(value.colors) ? value.colors : [];
  const low = hexColor(colors[0], [18, 24, 31, 255]);
  const high = hexColor(colors[1], [72, 224, 255, 255]);
  for (let y = 0; y < request.height; y += 1) {
    const gridY = Math.min(height - 1, Math.floor(y / request.height * height));
    for (let x = 0; x < request.width; x += 1) {
      const gridX = Math.min(width - 1, Math.floor(x / request.width * width));
      const index = (gridY * width + gridX) * channels;
      const offset = (y * request.width + x) * 4;
      if (channels === 3) {
        output[offset] = clampByte(Number(values[index]) * 255);
        output[offset + 1] = clampByte(Number(values[index + 1]) * 255);
        output[offset + 2] = clampByte(Number(values[index + 2]) * 255);
      } else {
        const amount = Math.max(0, Math.min(1, (Number(values[index]) - minimum) / range));
        output[offset] = clampByte(low[0]! + (high[0]! - low[0]!) * amount);
        output[offset + 1] = clampByte(low[1]! + (high[1]! - low[1]!) * amount);
        output[offset + 2] = clampByte(low[2]! + (high[2]! - low[2]!) * amount);
      }
      output[offset + 3] = 255;
    }
  }
  return true;
}

function particleFrame(
  output: Uint8ClampedArray,
  value: Record<string, unknown>,
  request: FrameRequest
): boolean {
  if (value.format !== "codemotion-particle-buffer/v1") return false;
  const positions = value.positions instanceof Float32Array ? value.positions : undefined;
  const sizes = value.sizes instanceof Float32Array ? value.sizes : undefined;
  const opacities = value.opacities instanceof Float32Array ? value.opacities : undefined;
  const colors = value.colors instanceof Uint8ClampedArray ? value.colors : undefined;
  const count = typeof value.count === "number" ? Math.max(0, Math.floor(value.count)) : 0;
  if (positions === undefined || sizes === undefined || opacities === undefined || colors === undefined) return false;
  const limit = Math.min(count, positions.length / 2, sizes.length, opacities.length, colors.length / 4);
  for (let index = 0; index < limit; index += 1) {
    const rawX = positions[index * 2]!;
    const rawY = positions[index * 2 + 1]!;
    const normalized = Math.abs(rawX) <= 2 && Math.abs(rawY) <= 2;
    const x = normalized ? (rawX + 1) * 0.5 * (request.width - 1) : rawX;
    const y = normalized ? (1 - (rawY + 1) * 0.5) * (request.height - 1) : rawY;
    const offset = index * 4;
    drawDisc(output, request.width, request.height, x, y, sizes[index]!, [
      colors[offset]!, colors[offset + 1]!, colors[offset + 2]!, colors[offset + 3]!
    ], opacities[index]!);
  }
  return true;
}

function collectPoints(value: unknown, output: { x: number; y: number }[], depth = 0): void {
  if (depth > 6 || output.length >= 2_000) return;
  if (Array.isArray(value)) {
    for (const item of value) collectPoints(item, output, depth + 1);
    return;
  }
  const item = record(value);
  if (item === undefined) return;
  if (typeof item.x === "number" && Number.isFinite(item.x)
    && typeof item.y === "number" && Number.isFinite(item.y)) {
    output.push({ x: item.x, y: item.y });
  }
  for (const child of Object.values(item)) collectPoints(child, output, depth + 1);
}

function drawStructuredOutput(
  output: Uint8ClampedArray,
  value: Record<string, unknown>,
  request: FrameRequest
): void {
  const points: { x: number; y: number }[] = [];
  collectPoints(value, points);
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    const normalized = Math.abs(point.x) <= 4 && Math.abs(point.y) <= 4;
    const x = normalized ? (point.x + 1) * 0.5 * request.width : point.x;
    const y = normalized ? (1 - (point.y + 1) * 0.5) * request.height : point.y;
    drawDisc(output, request.width, request.height, x, y, 2.5, [72, 224, 255, 255], 0.9);
  }
  const rgba = Array.isArray(value.rgba) ? value.rgba
    : Array.isArray(value.emissive) ? value.emissive
      : Array.isArray(value.f0) ? value.f0 : undefined;
  if (rgba?.length === 4) {
    const color = rgba.map((channel) => clampByte(Number(channel) * 255));
    for (let offset = 0; offset < output.length; offset += 4) {
      output[offset] = clampByte(output[offset]! * 0.55 + color[0]! * 0.45);
      output[offset + 1] = clampByte(output[offset + 1]! * 0.55 + color[1]! * 0.45);
      output[offset + 2] = clampByte(output[offset + 2]! * 0.55 + color[2]! * 0.45);
    }
  }
}

function shiftedSource(
  source: Uint8Array,
  output: Uint8ClampedArray,
  request: FrameRequest,
  shiftX: number,
  shiftY: number,
  opacity: number
): void {
  for (let y = 0; y < request.height; y += 1) {
    const sy = Math.max(0, Math.min(request.height - 1, y - shiftY));
    for (let x = 0; x < request.width; x += 1) {
      const sx = Math.max(0, Math.min(request.width - 1, x - shiftX));
      const sourceOffset = (sy * request.width + sx) * 4;
      blendPixel(output, request.width, request.height, x, y, [
        source[sourceOffset]!, source[sourceOffset + 1]!, source[sourceOffset + 2]!, source[sourceOffset + 3]!
      ], opacity);
    }
  }
}

function numberAt(value: unknown, keys: readonly string[], depth = 0): number | undefined {
  if (depth > 5) return undefined;
  const item = record(value);
  if (item === undefined) return undefined;
  for (const key of keys) {
    const candidate = item[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  }
  for (const child of Object.values(item)) {
    const candidate = numberAt(child, keys, depth + 1);
    if (candidate !== undefined) return candidate;
  }
  return undefined;
}

function resampleSource(
  source: Uint8Array,
  output: Uint8ClampedArray,
  request: FrameRequest,
  scale: number,
  translateX: number,
  translateY: number
): void {
  const safeScale = Math.max(0.25, Math.min(4, scale));
  const centerX = request.width / 2;
  const centerY = request.height / 2;
  for (let y = 0; y < request.height; y += 1) {
    for (let x = 0; x < request.width; x += 1) {
      const sourceX = Math.max(0, Math.min(request.width - 1,
        Math.round((x - centerX - translateX) / safeScale + centerX)));
      const sourceY = Math.max(0, Math.min(request.height - 1,
        Math.round((y - centerY - translateY) / safeScale + centerY)));
      const from = (sourceY * request.width + sourceX) * 4;
      const to = (y * request.width + x) * 4;
      output[to] = source[from]!;
      output[to + 1] = source[from + 1]!;
      output[to + 2] = source[from + 2]!;
      output[to + 3] = source[from + 3]!;
    }
  }
}

function operationFrame(
  output: Uint8ClampedArray,
  source: Uint8Array | undefined,
  value: Record<string, unknown>,
  request: FrameRequest
): boolean {
  if (source === undefined || typeof value.operation !== "string") return false;
  const operation = value.operation;
  const progress = Math.max(0, Math.min(1, numberAt(value, ["progress"]) ?? ((request.time * 0.35) % 1)));
  if (operation.includes("camera") || operation.includes("dolly") || operation.includes("parallax")) {
    const handheld = operation.includes("handheld");
    const scale = 1 + progress * (operation.includes("zoom") ? 0.38 : 0.16);
    const translateX = handheld ? Math.sin(request.time * 17.3) * 7
      : Math.sin(progress * Math.PI) * request.width * 0.05;
    const translateY = handheld ? Math.cos(request.time * 13.7) * 5
      : Math.cos(progress * Math.PI) * request.height * 0.025;
    resampleSource(source, output, request, scale, translateX, translateY);
    return true;
  }
  if (operation.includes("portal")) {
    const radius = Math.hypot(request.width, request.height) * progress * 0.62;
    const centerX = request.width / 2;
    const centerY = request.height / 2;
    for (let y = 0; y < request.height; y += 1) {
      for (let x = 0; x < request.width; x += 1) {
        const distance = Math.hypot(x - centerX, y - centerY);
        const offset = (y * request.width + x) * 4;
        if (distance > radius) {
          output[offset] = Math.round(output[offset]! * 0.15);
          output[offset + 1] = Math.round(output[offset + 1]! * 0.15);
          output[offset + 2] = Math.round(output[offset + 2]! * 0.15);
        } else if (Math.abs(distance - radius) < 5) {
          output[offset] = 72;
          output[offset + 1] = 224;
          output[offset + 2] = 255;
        }
      }
    }
    return true;
  }
  if (operation.includes("page_turn")) {
    const fold = Math.floor(request.width * (1 - progress));
    for (let y = 0; y < request.height; y += 1) {
      for (let x = fold; x < request.width; x += 1) {
        const offset = (y * request.width + x) * 4;
        const shade = 0.25 + 0.75 * Math.abs(Math.cos((x - fold) / Math.max(1, request.width - fold) * Math.PI));
        output[offset] = clampByte(output[offset]! * shade);
        output[offset + 1] = clampByte(output[offset + 1]! * shade);
        output[offset + 2] = clampByte(output[offset + 2]! * shade);
      }
    }
    return true;
  }
  if (operation.includes("tunnel")) {
    resampleSource(source, output, request, 1 + progress * 1.6, 0, 0);
    const radius = Math.min(request.width, request.height) * (0.1 + progress * 0.42);
    for (let angle = 0; angle < 360; angle += 2) {
      const radians = angle * Math.PI / 180;
      blendPixel(output, request.width, request.height,
        request.width / 2 + Math.cos(radians) * radius,
        request.height / 2 + Math.sin(radians) * radius,
        [72, 224, 255, 255], 0.72);
    }
    return true;
  }
  if (operation.includes("match") || operation.includes("transition")) {
    const boundary = Math.floor(request.width * progress);
    for (let y = 0; y < request.height; y += 1) {
      for (let x = 0; x < boundary; x += 1) {
        const offset = (y * request.width + x) * 4;
        output[offset] = clampByte(output[offset]! * 0.58 + 34);
        output[offset + 1] = clampByte(output[offset + 1]! * 0.74 + 20);
        output[offset + 2] = clampByte(output[offset + 2]! * 0.92 + 12);
      }
    }
    return true;
  }
  return false;
}

function dataVisualization(
  output: Uint8ClampedArray,
  value: Record<string, unknown>,
  request: FrameRequest,
  toolName: string
): void {
  const state = record(value.state);
  if (state !== undefined && Number.isInteger(state.gridSize) && Array.isArray(state.cells)) {
    const gridSize = Math.max(1, Number(state.gridSize));
    for (let y = 0; y < request.height; y += 1) {
      const row = Math.min(gridSize - 1, Math.floor(y / request.height * gridSize));
      for (let x = 0; x < request.width; x += 1) {
        const column = Math.min(gridSize - 1, Math.floor(x / request.width * gridSize));
        const cell = record(state.cells[row * gridSize + column]);
        const density = Math.max(0, Math.min(1, Number(cell?.density ?? 0)));
        const speed = Math.max(0, Math.min(1, Math.hypot(Number(cell?.vx ?? 0), Number(cell?.vy ?? 0))));
        const offset = (y * request.width + x) * 4;
        output[offset] = clampByte(18 + density * 42 + speed * 36);
        output[offset + 1] = clampByte(28 + density * 126 + speed * 54);
        output[offset + 2] = clampByte(42 + density * 192 + speed * 40);
        output[offset + 3] = 255;
      }
    }
  }
  const bars = Array.isArray(value.bars) ? value.bars
    : Array.isArray(value.items) ? value.items : undefined;
  if (bars !== undefined && bars.length > 0) {
    const gap = 4;
    const barWidth = Math.max(2, (request.width - gap * (bars.length + 1)) / bars.length);
    const rawValues = bars.map((entry) => {
      if (typeof entry === "number" && Number.isFinite(entry)) return Math.abs(entry);
      const item = record(entry);
      return typeof item?.value === "number" && Number.isFinite(item.value) ? Math.abs(item.value) : 1;
    });
    const maximum = Math.max(1e-9, ...rawValues);
    bars.forEach((entry, index) => {
      const item = record(entry);
      const reveal = Math.max(0, Math.min(1, Number(item?.reveal ?? 1)));
      const amount = Math.max(0, Math.min(1,
        (typeof entry === "number" ? Math.abs(entry) : rawValues[index]!) / maximum * reveal));
      const height = amount * request.height * 0.72;
      const startX = Math.floor(gap + index * (barWidth + gap));
      for (let y = Math.floor(request.height - 24 - height); y < request.height - 24; y += 1) {
        for (let x = startX; x < startX + barWidth; x += 1) {
          blendPixel(output, request.width, request.height, x, y, [72, 224, 255, 255], 0.86);
        }
      }
    });
  }
  const progress = numberAt(value, ["progress", "pulse", "energy", "triggerStrength", "value"]);
  if (progress !== undefined && /number|binding|beat|onset|vocal/u.test(toolName)) {
    const amount = Math.max(0, Math.min(1, Math.abs(progress)));
    const trackWidth = Math.floor(request.width * 0.72);
    const left = Math.floor((request.width - trackWidth) / 2);
    const top = Math.floor(request.height * 0.78);
    for (let x = 0; x < trackWidth; x += 1) {
      const active = x / trackWidth <= amount;
      for (let y = top; y < top + 12; y += 1) {
        blendPixel(output, request.width, request.height, left + x, y,
          active ? [72, 224, 255, 255] : [86, 92, 102, 255], active ? 0.92 : 0.5);
      }
    }
    if (/beat|onset|vocal/u.test(toolName)) {
      const radius = Math.min(request.width, request.height) * (0.12 + amount * 0.28);
      for (let angle = 0; angle < 360; angle += 3) {
        const radians = angle * Math.PI / 180;
        blendPixel(output, request.width, request.height,
          request.width / 2 + Math.cos(radians) * radius,
          request.height / 2 + Math.sin(radians) * radius,
          [120, 238, 255, 255], 0.8);
      }
    }
  }
}

function adapterPreview(
  output: Uint8ClampedArray,
  source: Uint8Array | undefined,
  request: FrameRequest,
  toolName: string
): void {
  const phase = request.time * Math.PI * 2;
  if (source !== undefined && toolName === "background_remove_compose") {
    for (let offset = 0; offset < output.length; offset += 4) {
      const luminance = source[offset]! * 0.2126 + source[offset + 1]! * 0.7152 + source[offset + 2]! * 0.0722;
      const foreground = Math.max(0, Math.min(1, Math.abs(luminance - 128) / 72));
      output[offset] = clampByte(source[offset]! * foreground + 24 * (1 - foreground));
      output[offset + 1] = clampByte(source[offset + 1]! * foreground + 46 * (1 - foreground));
      output[offset + 2] = clampByte(source[offset + 2]! * foreground + 58 * (1 - foreground));
    }
  } else if (source !== undefined && toolName === "echo_trail") {
    for (let trail = 4; trail >= 1; trail -= 1) {
      shiftedSource(source, output, request, Math.round(Math.sin(phase - trail * 0.4) * trail * 7), trail * 3, 0.1);
    }
  } else if (source !== undefined && toolName === "image_depth_parallax") {
    for (let y = 0; y < request.height; y += 1) {
      const shift = Math.round(Math.sin(phase + y / request.height * Math.PI) * 10);
      for (let x = 0; x < request.width; x += 1) {
        const sx = Math.max(0, Math.min(request.width - 1, x - shift));
        const from = (y * request.width + sx) * 4;
        const to = (y * request.width + x) * 4;
        output[to] = source[from]!;
        output[to + 1] = source[from + 1]!;
        output[to + 2] = source[from + 2]!;
        output[to + 3] = 255;
      }
    }
  } else if (source !== undefined && toolName === "object_explode") {
    const tile = 32;
    const progress = Math.min(1, request.time / 2);
    const snapshot = new Uint8ClampedArray(output);
    output.fill(0);
    for (let ty = 0; ty < request.height; ty += tile) {
      for (let tx = 0; tx < request.width; tx += tile) {
        const dx = Math.round((tx - request.width / 2) * progress * 0.35);
        const dy = Math.round((ty - request.height / 2) * progress * 0.35 + progress * progress * 28);
        for (let y = 0; y < tile && ty + y < request.height; y += 1) {
          for (let x = 0; x < tile && tx + x < request.width; x += 1) {
            const targetX = tx + x + dx;
            const targetY = ty + y + dy;
            if (targetX < 0 || targetY < 0 || targetX >= request.width || targetY >= request.height) continue;
            const from = ((ty + y) * request.width + tx + x) * 4;
            const to = (targetY * request.width + targetX) * 4;
            output.set(snapshot.subarray(from, from + 4), to);
          }
        }
      }
    }
  } else if (source !== undefined && toolName === "photo_stack") {
    output.fill(0);
    const progress = Math.min(1, request.time / 1.4);
    for (let copy = 3; copy >= 0; copy -= 1) {
      const scale = 0.76 + copy * 0.045;
      const width = Math.floor(request.width * scale);
      const height = Math.floor(request.height * scale);
      const left = Math.floor((request.width - width) / 2 + (copy - 1.5) * 14 * progress);
      const top = Math.floor((request.height - height) / 2 + (copy - 1.5) * 9 * progress);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const sourceX = Math.min(request.width - 1, Math.floor(x / width * request.width));
          const sourceY = Math.min(request.height - 1, Math.floor(y / height * request.height));
          const targetX = left + x;
          const targetY = top + y;
          if (targetX < 0 || targetY < 0 || targetX >= request.width || targetY >= request.height) continue;
          const from = (sourceY * request.width + sourceX) * 4;
          const to = (targetY * request.width + targetX) * 4;
          output.set(source.subarray(from, from + 4), to);
        }
      }
    }
  } else if (source !== undefined && (toolName === "smart_crop_animate" || toolName === "speed_ramp")) {
    const speed = toolName === "speed_ramp" ? 1.8 + Math.sin(request.time * 2.2) * 0.8 : 0.45;
    const progress = (request.time * speed) % 1;
    resampleSource(source, output, request, 1.04 + progress * 0.32,
      Math.sin(progress * Math.PI * 2) * request.width * 0.04,
      Math.cos(progress * Math.PI) * request.height * 0.025);
  }
  if (/text|typewriter|character|word|logo|handwriting|path_/u.test(toolName)) {
    const reveal = Math.min(1, request.time / 1.5);
    const boundary = Math.floor(request.width * reveal);
    for (let y = 0; y < request.height; y += 1) {
      for (let x = boundary; x < request.width; x += 1) {
        const offset = (y * request.width + x) * 4;
        output[offset] = Math.round(output[offset]! * 0.16);
        output[offset + 1] = Math.round(output[offset + 1]! * 0.16);
        output[offset + 2] = Math.round(output[offset + 2]! * 0.16);
      }
    }
  }
  if (/wipe|reveal|freeze/u.test(toolName)) {
    const boundary = Math.floor(request.width * ((request.time * 0.45) % 1));
    for (let y = 0; y < request.height; y += 1) {
      for (let x = boundary; x < request.width; x += 1) {
        const offset = (y * request.width + x) * 4;
        output[offset] = Math.round(output[offset]! * 0.38);
        output[offset + 1] = Math.round(output[offset + 1]! * 0.38);
        output[offset + 2] = Math.round(output[offset + 2]! * 0.38);
      }
    }
  }
  const scanline = Math.floor(((request.time * 90) % (request.height + 40)) - 20);
  for (let y = Math.max(0, scanline - 2); y <= Math.min(request.height - 1, scanline + 2); y += 1) {
    for (let x = 0; x < request.width; x += 1) {
      blendPixel(output, request.width, request.height, x, y, [96, 220, 255, 255], 0.22);
    }
  }
}

export function composeEffectToolFrame(
  result: EffectRenderResult | undefined,
  request: FrameRequest,
  toolName: string,
  source: Uint8Array | undefined
): Uint8Array {
  if (result !== undefined) {
    const exact = exactFrame(result, request);
    if (exact !== undefined) {
      return source !== undefined && source.length === exact.length && TEXT_OVERLAY_TOOLS.has(toolName)
        ? compositeExactTextFrame(source, exact, request)
        : exact;
    }
  }
  const output = sourceFrame(source, request, toolName);
  const value = result === undefined ? undefined : record(result.output);
  if (value !== undefined) {
    operationFrame(output, source, value, request);
    const fieldRendered = scalarField(output, value, request);
    const state = record(value.state);
    const simulationGrid = state !== undefined && Number.isInteger(state.gridSize) && Array.isArray(state.cells);
    particleFrame(output, value, request);
    if (!fieldRendered && !simulationGrid) {
      drawGeometry(output, value, request);
      drawStructuredOutput(output, value, request);
    }
    dataVisualization(output, value, request, toolName);
  }
  adapterPreview(output, source, request, toolName);
  return new Uint8Array(output.buffer, output.byteOffset, output.byteLength);
}
