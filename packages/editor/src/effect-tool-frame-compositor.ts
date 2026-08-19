import type { EffectRenderResult } from "@codemotion/effect-functions";
import type { FrameRequest } from "@codemotion/exporter";

type PixelBytes = Uint8Array | Uint8ClampedArray;

const TEXT_OVERLAY_TOOLS = new Set([
  "character_cascade", "handwriting", "kinetic_typography", "scramble_decode", "text_morph",
  "text_extrude_3d", "text_path_reveal", "typewriter", "word_explode"
]);

const POLISHED_STRUCTURED_TOOLS = new Set([
  "blob_morph", "dash_flow", "electric_arc", "lightning_trace", "marker_stroke",
  "shape_boolean_animate", "volumetric_ray", "wave_path", "neon_trace", "paint_on",
  "particle_dissolve", "particle_logo_assemble", "particle_snow_rain", "particle_spark",
  "particle_trail", "particle_emitter",
  "particle_flow_field", "particle_orbit_field", "sim_boids", "sim_cloth",
  "sim_collision_shatter", "sim_fluid_lite", "sim_rigid_body_2d", "sim_rope",
  "sim_soft_body", "sim_spring",
  "dolly", "dolly_zoom", "handheld", "object_match_cut", "orbit", "page_turn",
  "pan_tilt", "parallax_layers", "portal", "zoom_tunnel",
  "fractal", "l_system", "metaballs", "noise_field", "sacred_geometry",
  "spectrum_bars", "spiral_tunnel", "voronoi", "waveform", "wave_surface",
  "beat_pulse", "onset_trigger", "vocal_reactive_text", "texture_overlay",
  "chart_reveal", "live_binding", "number_counter", "glass", "hologram", "metal",
  "echo_trail"
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

type ScreenPoint = Readonly<{ x: number; y: number }>;
type TextureVertex = Readonly<{ x: number; y: number; u: number; v: number }>;

function simulationPointToPixel(point: ScreenPoint, request: FrameRequest): readonly [number, number] {
  return [
    (point.x + 1) * 0.5 * (request.width - 1),
    (point.y + 1) * 0.5 * (request.height - 1)
  ];
}

function shadeFrame(output: Uint8ClampedArray, amount: number, tint: readonly number[] = [5, 8, 14]): void {
  const safeAmount = Math.max(0, Math.min(1, amount));
  for (let offset = 0; offset < output.length; offset += 4) {
    output[offset] = clampByte(output[offset]! * safeAmount + tint[0]! * (1 - safeAmount));
    output[offset + 1] = clampByte(output[offset + 1]! * safeAmount + tint[1]! * (1 - safeAmount));
    output[offset + 2] = clampByte(output[offset + 2]! * safeAmount + tint[2]! * (1 - safeAmount));
    output[offset + 3] = 255;
  }
}

function clearFrame(output: Uint8ClampedArray, color: readonly number[]): void {
  for (let offset = 0; offset < output.length; offset += 4) {
    output[offset] = color[0]!;
    output[offset + 1] = color[1]!;
    output[offset + 2] = color[2]!;
    output[offset + 3] = 255;
  }
}

function drawScreenPolyline(
  output: Uint8ClampedArray,
  points: readonly ScreenPoint[],
  request: FrameRequest,
  color: readonly number[],
  opacity: number,
  thickness: number
): void {
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    drawLine(output, request.width, request.height, from.x, from.y, to.x, to.y, color, opacity, thickness);
  }
}

function fillScreenTriangle(
  output: Uint8ClampedArray,
  request: FrameRequest,
  a: ScreenPoint,
  b: ScreenPoint,
  c: ScreenPoint,
  color: readonly number[],
  opacity: number
): void {
  const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(denominator) < 1e-6) return;
  const minimumX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
  const maximumX = Math.min(request.width - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
  const minimumY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
  const maximumY = Math.min(request.height - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      const wa = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / denominator;
      const wb = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / denominator;
      const wc = 1 - wa - wb;
      if (wa >= -0.001 && wb >= -0.001 && wc >= -0.001) {
        blendPixel(output, request.width, request.height, x, y, color, opacity);
      }
    }
  }
}

function drawTexturedTriangle(
  output: Uint8ClampedArray,
  source: Uint8Array,
  request: FrameRequest,
  a: TextureVertex,
  b: TextureVertex,
  c: TextureVertex,
  opacity = 1,
  shade = 1
): void {
  const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(denominator) < 1e-6) return;
  const minimumX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
  const maximumX = Math.min(request.width - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
  const minimumY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
  const maximumY = Math.min(request.height - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      const wa = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / denominator;
      const wb = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / denominator;
      const wc = 1 - wa - wb;
      if (wa < -0.001 || wb < -0.001 || wc < -0.001) continue;
      const u = Math.max(0, Math.min(1, wa * a.u + wb * b.u + wc * c.u));
      const v = Math.max(0, Math.min(1, wa * a.v + wb * b.v + wc * c.v));
      const sourceX = Math.round(u * (request.width - 1));
      const sourceY = Math.round(v * (request.height - 1));
      const offset = (sourceY * request.width + sourceX) * 4;
      blendPixel(output, request.width, request.height, x, y, [
        source[offset]! * shade, source[offset + 1]! * shade,
        source[offset + 2]! * shade, source[offset + 3]!
      ], opacity);
    }
  }
}

function drawTexturedQuad(
  output: Uint8ClampedArray,
  source: Uint8Array,
  request: FrameRequest,
  vertices: readonly [TextureVertex, TextureVertex, TextureVertex, TextureVertex],
  opacity = 1,
  shade = 1
): void {
  drawTexturedTriangle(output, source, request, vertices[0], vertices[1], vertices[2], opacity, shade);
  drawTexturedTriangle(output, source, request, vertices[0], vertices[2], vertices[3], opacity, shade);
}

function drawTexturedDisc(
  output: Uint8ClampedArray,
  source: Uint8Array,
  request: FrameRequest,
  centerX: number,
  centerY: number,
  radius: number,
  opacity = 1
): void {
  const safeRadius = Math.max(2, Math.min(96, radius));
  for (let dy = -safeRadius; dy <= safeRadius; dy += 1) {
    const y = Math.round(centerY + dy);
    if (y < 0 || y >= request.height) continue;
    for (let dx = -safeRadius; dx <= safeRadius; dx += 1) {
      const distance = Math.hypot(dx, dy);
      if (distance > safeRadius) continue;
      const x = Math.round(centerX + dx);
      if (x < 0 || x >= request.width) continue;
      const u = dx / (safeRadius * 2) + 0.5;
      const v = dy / (safeRadius * 2) + 0.5;
      const sourceX = Math.max(0, Math.min(request.width - 1, Math.round(u * (request.width - 1))));
      const sourceY = Math.max(0, Math.min(request.height - 1, Math.round(v * (request.height - 1))));
      const offset = (sourceY * request.width + sourceX) * 4;
      const edge = Math.min(1, (safeRadius - distance) / Math.max(1, safeRadius * 0.12));
      blendPixel(output, request.width, request.height, x, y, [
        source[offset]!, source[offset + 1]!, source[offset + 2]!, source[offset + 3]!
      ], opacity * edge);
    }
  }
}

function drawRing(
  output: Uint8ClampedArray,
  request: FrameRequest,
  centerX: number,
  centerY: number,
  radius: number,
  color: readonly number[],
  opacity: number,
  thickness: number
): void {
  const steps = Math.max(36, Math.ceil(radius * 1.5));
  for (let index = 0; index < steps; index += 1) {
    const angle = index / steps * Math.PI * 2;
    drawDisc(output, request.width, request.height,
      centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius,
      thickness, color, opacity);
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

function pointArray(value: unknown): readonly { readonly x: number; readonly y: number }[] {
  if (!Array.isArray(value)) return [];
  const points = value.map(finitePoint);
  return points.every((point) => point !== undefined)
    ? points as readonly { readonly x: number; readonly y: number }[] : [];
}

function pixelPoints(
  points: readonly { readonly x: number; readonly y: number }[],
  request: FrameRequest,
  coordinateSpace: "auto" | "pixel" = "auto"
): readonly (readonly [number, number])[] {
  return coordinateSpace === "pixel"
    ? points.map((point) => [point.x, point.y] as const)
    : points.map((point) => pointToPixel(point, request.width, request.height));
}

function drawPolyline(
  output: Uint8ClampedArray,
  points: readonly { readonly x: number; readonly y: number }[],
  request: FrameRequest,
  color: readonly number[],
  opacity: number,
  thickness: number,
  closed = false,
  coordinateSpace: "auto" | "pixel" = "auto"
): void {
  if (points.length < 2) return;
  const pixels = pixelPoints(points, request, coordinateSpace);
  const segmentCount = pixels.length - 1 + (closed ? 1 : 0);
  for (let index = 0; index < segmentCount; index += 1) {
    const from = pixels[index % pixels.length]!;
    const to = pixels[(index + 1) % pixels.length]!;
    drawLine(output, request.width, request.height, from[0], from[1], to[0], to[1], color, opacity, thickness);
  }
}

function drawElectricPath(
  output: Uint8ClampedArray,
  points: readonly { readonly x: number; readonly y: number }[],
  request: FrameRequest,
  glow: number,
  intensity = 1,
  color: readonly number[] = [72, 224, 255, 255],
  coordinateSpace: "auto" | "pixel" = "auto"
): void {
  if (intensity <= 0) return;
  const energy = Math.max(0.2, Math.min(2.4, intensity));
  const shadow = [Math.round(color[0]! * 0.12), Math.round(color[1]! * 0.18), Math.round(color[2]! * 0.34), 255];
  const halo = [Math.round(color[0]! * 0.55), Math.round(color[1]! * 0.72), Math.round(color[2]! * 0.95), 255];
  if (glow > 0) {
    drawPolyline(output, points, request, shadow, 0.13 * energy, Math.max(2, glow * 0.72), false, coordinateSpace);
    drawPolyline(output, points, request, halo, 0.24 * energy, Math.max(1.4, glow * 0.38), false, coordinateSpace);
  }
  drawPolyline(output, points, request, color, 0.48 * energy, 1.35, false, coordinateSpace);
  drawPolyline(output, points, request, [238, 252, 255, 255], Math.min(1, 0.72 * energy), 0.5, false, coordinateSpace);
}

function fillPolygon(
  output: Uint8ClampedArray,
  points: readonly { readonly x: number; readonly y: number }[],
  request: FrameRequest
): void {
  if (points.length < 3) return;
  const pixels = pixelPoints(points, request);
  const minimumY = Math.max(0, Math.floor(Math.min(...pixels.map((point) => point[1]))));
  const maximumY = Math.min(request.height - 1, Math.ceil(Math.max(...pixels.map((point) => point[1]))));
  for (let y = minimumY; y <= maximumY; y += 1) {
    const intersections: number[] = [];
    for (let index = 0; index < pixels.length; index += 1) {
      const a = pixels[index]!;
      const b = pixels[(index + 1) % pixels.length]!;
      if ((a[1] > y) === (b[1] > y)) continue;
      intersections.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
    }
    intersections.sort((left, right) => left - right);
    for (let pair = 0; pair + 1 < intersections.length; pair += 2) {
      const fromX = Math.max(0, Math.ceil(intersections[pair]!));
      const toX = Math.min(request.width - 1, Math.floor(intersections[pair + 1]!));
      const vertical = (y - minimumY) / Math.max(1, maximumY - minimumY);
      for (let x = fromX; x <= toX; x += 1) {
        const sheen = 0.13 + (1 - vertical) * 0.11 + Math.sin(x * 0.031 + y * 0.019) * 0.015;
        blendPixel(output, request.width, request.height, x, y, [28, 210, 178, 255], sheen);
      }
    }
  }
}

function drawMarkerDab(
  output: Uint8ClampedArray,
  request: FrameRequest,
  dab: Record<string, unknown>,
  bleed: number,
  roughness: number,
  color: readonly number[],
  subjectMask?: Uint8Array
): void {
  const center = finitePoint(dab.center);
  const width = typeof dab.width === "number" ? Math.max(1, Math.min(400, dab.width)) : 1;
  const height = typeof dab.height === "number" ? Math.max(1, Math.min(400, dab.height)) : width * 0.75;
  const opacity = typeof dab.opacity === "number" ? Math.max(0, Math.min(1, dab.opacity)) : 0.8;
  const angle = typeof dab.angle === "number" && Number.isFinite(dab.angle) ? dab.angle : 0;
  if (center === undefined || opacity <= 0) return;
  const pixel = [center.x, center.y] as const;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const halfAlong = height * 0.5;
  const halfAcross = width * 0.5;
  const radius = Math.ceil(Math.hypot(halfAlong, halfAcross) * (1 + bleed * 0.45));
  for (let dy = -radius; dy <= radius; dy += 1) {
    const y = Math.round(pixel[1] + dy);
    if (y < 0 || y >= request.height) continue;
    for (let dx = -radius; dx <= radius; dx += 1) {
      const x = Math.round(pixel[0] + dx);
      if (x < 0 || x >= request.width) continue;
      const maskAlpha = subjectMask?.[y * request.width + x] ?? 255;
      if (maskAlpha <= 4) continue;
      const along = dx * cosine + dy * sine;
      const across = -dx * sine + dy * cosine;
      const roughEdge = halfAcross * (1 + roughness * Math.sin(along * 0.41 + y * 0.17));
      const edge = Math.max(Math.abs(along) / Math.max(1, halfAlong), Math.abs(across) / Math.max(1, roughEdge));
      const bleedEdge = 1 + bleed * (0.2 + 0.3 * (0.5 + 0.5 * Math.sin(x * 0.37 + y * 0.23)));
      if (edge > bleedEdge) continue;
      const body = edge <= 1 ? 1 - Math.max(0, edge - 0.78) / 0.22 : 0;
      const feather = edge > 1 ? (bleedEdge - edge) / Math.max(0.001, bleedEdge - 1) : 0;
      const paperGrain = 0.84 + 0.16 * (0.5 + 0.5 * Math.sin(x * 0.73 + y * 1.13));
      const alpha = opacity * paperGrain * (body * 0.46 + feather * 0.12) * maskAlpha / 255;
      blendPixel(output, request.width, request.height, x, y, color, alpha);
    }
  }
}

function numericGrid(
  value: Record<string, unknown>,
  key: string
): { readonly width: number; readonly height: number; readonly values: readonly number[] } | undefined {
  const width = typeof value.width === "number" && Number.isInteger(value.width) ? value.width : 0;
  const height = typeof value.height === "number" && Number.isInteger(value.height) ? value.height : 0;
  const values = value[key];
  if (width < 1 || height < 1 || !Array.isArray(values) || values.length !== width * height
    || values.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))) return undefined;
  return { width, height, values: values as number[] };
}

function bilinearGridValue(
  grid: Readonly<{ width: number; height: number; values: readonly number[] }>,
  x: number,
  y: number,
  request: FrameRequest
): number {
  const gx = Math.max(0, Math.min(grid.width - 1, x / Math.max(1, request.width - 1) * (grid.width - 1)));
  const gy = Math.max(0, Math.min(grid.height - 1, y / Math.max(1, request.height - 1) * (grid.height - 1)));
  const x0 = Math.floor(gx); const y0 = Math.floor(gy);
  const x1 = Math.min(grid.width - 1, x0 + 1); const y1 = Math.min(grid.height - 1, y0 + 1);
  const tx = gx - x0; const ty = gy - y0;
  const top = grid.values[y0 * grid.width + x0]! * (1 - tx) + grid.values[y0 * grid.width + x1]! * tx;
  const bottom = grid.values[y1 * grid.width + x0]! * (1 - tx) + grid.values[y1 * grid.width + x1]! * tx;
  return top * (1 - ty) + bottom * ty;
}

function wrappedFramePixel(
  frame: Uint8Array,
  request: FrameRequest,
  x: number,
  y: number
): readonly [number, number, number, number] {
  const px = ((Math.round(x) % request.width) + request.width) % request.width;
  const py = ((Math.round(y) % request.height) + request.height) % request.height;
  const offset = (py * request.width + px) * 4;
  return [frame[offset]!, frame[offset + 1]!, frame[offset + 2]!, frame[offset + 3]!];
}

function clampedFramePixel(
  frame: Uint8Array,
  request: FrameRequest,
  x: number,
  y: number
): readonly [number, number, number, number] {
  const px = Math.max(0, Math.min(request.width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(request.height - 1, Math.round(y)));
  const offset = (py * request.width + px) * 4;
  return [frame[offset]!, frame[offset + 1]!, frame[offset + 2]!, frame[offset + 3]!];
}

function bilinearFramePixel(
  frame: Uint8Array,
  request: FrameRequest,
  x: number,
  y: number
): readonly [number, number, number, number] {
  const sx = Math.max(0, Math.min(request.width - 1, x));
  const sy = Math.max(0, Math.min(request.height - 1, y));
  const x0 = Math.floor(sx); const y0 = Math.floor(sy);
  const x1 = Math.min(request.width - 1, x0 + 1); const y1 = Math.min(request.height - 1, y0 + 1);
  const tx = sx - x0; const ty = sy - y0;
  const sample = (px: number, py: number, channel: number) => frame[(py * request.width + px) * 4 + channel]!;
  return [0, 1, 2, 3].map((channel) => {
    const top = sample(x0, y0, channel) * (1 - tx) + sample(x1, y0, channel) * tx;
    const bottom = sample(x0, y1, channel) * (1 - tx) + sample(x1, y1, channel) * tx;
    return clampByte(top * (1 - ty) + bottom * ty);
  }) as unknown as readonly [number, number, number, number];
}

function blendChannel(base: number, overlay: number, mode: string): number {
  const a = base / 255;
  const b = overlay / 255;
  const value = mode === "multiply" ? a * b
    : mode === "screen" ? a + b - a * b
      : mode === "overlay" ? a <= 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b)
        : mode === "soft_light" ? b <= 0.5
          ? a - (1 - 2 * b) * a * (1 - a)
          : a + (2 * b - 1) * (Math.sqrt(a) - a)
        : b;
  return clampByte(value * 255);
}

const SEVEN_SEGMENTS: Readonly<Record<string, readonly number[]>> = Object.freeze({
  "0": [0, 1, 2, 3, 4, 5], "1": [1, 2], "2": [0, 1, 6, 4, 3],
  "3": [0, 1, 2, 3, 6], "4": [5, 6, 1, 2], "5": [0, 5, 6, 2, 3],
  "6": [0, 5, 4, 3, 2, 6], "7": [0, 1, 2], "8": [0, 1, 2, 3, 4, 5, 6],
  "9": [0, 1, 2, 3, 5, 6]
});

function drawSevenSegmentText(
  output: Uint8ClampedArray,
  request: FrameRequest,
  text: string,
  color: readonly number[],
  scale = 1
): void {
  const height = Math.max(28, Math.min(request.height * 0.34, 96 * scale));
  const width = height * 0.56;
  const gap = width * 0.2;
  const total = text.length * width + Math.max(0, text.length - 1) * gap;
  let left = (request.width - total) / 2;
  const top = request.height * 0.33;
  const thickness = Math.max(1.6, height * 0.045);
  const segments = [
    [0.12, 0.04, 0.88, 0.04], [0.92, 0.08, 0.92, 0.48],
    [0.92, 0.52, 0.92, 0.92], [0.12, 0.96, 0.88, 0.96],
    [0.08, 0.52, 0.08, 0.92], [0.08, 0.08, 0.08, 0.48],
    [0.12, 0.5, 0.88, 0.5]
  ] as const;
  for (const character of text) {
    if (character === ".") {
      drawDisc(output, request.width, request.height, left + width * 0.5, top + height * 0.96,
        thickness * 1.35, color, 0.96);
      left += width * 0.42;
      continue;
    }
    if (character === "%") {
      drawRing(output, request, left + width * 0.28, top + height * 0.28,
        width * 0.12, color, 0.9, thickness);
      drawRing(output, request, left + width * 0.72, top + height * 0.72,
        width * 0.12, color, 0.9, thickness);
      drawLine(output, request.width, request.height, left + width * 0.2, top + height * 0.82,
        left + width * 0.8, top + height * 0.18, color, 0.9, thickness);
      left += width + gap;
      continue;
    }
    for (const index of SEVEN_SEGMENTS[character] ?? []) {
      const segment = segments[index]!;
      drawLine(output, request.width, request.height, left + segment[0] * width, top + segment[1] * height,
        left + segment[2] * width, top + segment[3] * height, color, 0.92, thickness);
    }
    left += width + gap;
  }
}

function hueColor(hue: number): readonly [number, number, number, number] {
  const section = (((hue % 360) + 360) % 360) / 60;
  const chroma = 1;
  const x = chroma * (1 - Math.abs(section % 2 - 1));
  const colors: readonly (readonly [number, number, number])[] = [
    [chroma, x, 0], [x, chroma, 0], [0, chroma, x],
    [0, x, chroma], [x, 0, chroma], [chroma, 0, x]
  ];
  const color = colors[Math.floor(section) % 6]!;
  return [clampByte(color[0] * 255), clampByte(color[1] * 255), clampByte(color[2] * 255), 255];
}

function revealSourceDab(
  output: Uint8ClampedArray,
  source: Uint8Array,
  request: FrameRequest,
  dab: Record<string, unknown>,
  brushShape: string,
  hardness: number,
  feather: number
): void {
  const center = finitePoint(dab);
  const width = typeof dab.width === "number" ? Math.max(1, Math.min(400, dab.width)) : 1;
  const height = typeof dab.height === "number" ? Math.max(1, Math.min(400, dab.height)) : width;
  const angle = typeof dab.angle === "number" && Number.isFinite(dab.angle) ? dab.angle : 0;
  if (center === undefined) return;
  const pixel = pointToPixel(center, request.width, request.height);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const halfAlong = width * 0.5 + feather;
  const halfAcross = height * 0.5 + feather;
  const radius = Math.ceil(Math.hypot(halfAlong, halfAcross));
  const softness = Math.max(0.02, Math.min(0.9,
    (1 - hardness) * 0.5 + feather / Math.max(1, Math.max(width, height))));
  for (let dy = -radius; dy <= radius; dy += 1) {
    const y = Math.round(pixel[1] + dy);
    if (y < 0 || y >= request.height) continue;
    for (let dx = -radius; dx <= radius; dx += 1) {
      const x = Math.round(pixel[0] + dx);
      if (x < 0 || x >= request.width) continue;
      const along = dx * cosine + dy * sine;
      const across = -dx * sine + dy * cosine;
      const normalizedAlong = Math.abs(along) / Math.max(1, halfAlong);
      const normalizedAcross = Math.abs(across) / Math.max(1, halfAcross);
      const edge = brushShape === "flat"
        ? Math.max(normalizedAlong, normalizedAcross)
        : Math.hypot(normalizedAlong, normalizedAcross);
      if (edge > 1) continue;
      const feathered = edge <= 1 - softness ? 1 : (1 - edge) / softness;
      const grain = brushShape === "flat"
        ? 0.74 + 0.26 * (0.5 + 0.5 * Math.sin(x * 1.13 + y * 0.47)) : 1;
      const alpha = Math.max(0, Math.min(1, feathered * grain));
      const offset = (y * request.width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        output[offset + channel] = clampByte(
          output[offset + channel]! * (1 - alpha) + source[offset + channel]! * alpha
        );
      }
    }
  }
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
  const velocities = value.velocities instanceof Float32Array ? value.velocities : undefined;
  const count = typeof value.count === "number" ? Math.max(0, Math.floor(value.count)) : 0;
  if (positions === undefined || sizes === undefined || opacities === undefined
    || colors === undefined || velocities === undefined) return false;
  const sourceComposite = record(value.sourceComposite);
  if (sourceComposite === undefined) {
    for (let offset = 0; offset < output.length; offset += 4) {
      output[offset] = 5;
      output[offset + 1] = 8;
      output[offset + 2] = 14;
      output[offset + 3] = 255;
    }
  } else {
    const opacity = typeof sourceComposite.opacity === "number"
      ? Math.max(0, Math.min(1, sourceComposite.opacity)) : 1;
    const mask = sourceComposite.mask instanceof Uint8Array
      && sourceComposite.mask.length === request.width * request.height
      ? sourceComposite.mask : undefined;
    for (let pixelIndex = 0; pixelIndex < request.width * request.height; pixelIndex += 1) {
      const amount = opacity * (mask === undefined ? 1 : mask[pixelIndex]! / 255);
      const offset = pixelIndex * 4;
      output[offset] = clampByte(output[offset]! * amount);
      output[offset + 1] = clampByte(output[offset + 1]! * amount);
      output[offset + 2] = clampByte(output[offset + 2]! * amount);
      output[offset + 3] = clampByte(output[offset + 3]! * amount);
    }
  }
  const limit = Math.min(count, positions.length / 2, velocities.length / 2,
    sizes.length, opacities.length, colors.length / 4);
  const primitive = value.primitive === "streak" ? "streak" : value.primitive === "sprite" ? "sprite" : "disc";
  const glow = typeof value.glow === "number" ? Math.max(0, Math.min(5, value.glow)) : 0;
  let estimatedCost = 0;
  for (let index = 0; index < limit; index += 1) {
    const size = Math.max(0.25, Math.min(200, sizes[index]!));
    if (primitive === "streak") {
      const speed = Math.hypot(velocities[index * 2]!, velocities[index * 2 + 1]!);
      const length = Math.min(64, Math.max(6, size * 2.4 + speed * 0.022));
      const glowRadius = glow > 0 ? Math.min(32, Math.max(2, size * (1.3 + glow * 0.28))) : 0;
      const coreRadius = Math.min(32, Math.max(0.75, size * 0.7));
      const highlightRadius = Math.min(32, Math.max(0.45, size * 0.24));
      estimatedCost += length * 4 * (glowRadius ** 2 + coreRadius ** 2 + highlightRadius ** 2);
    } else {
      const outerRadius = glow > 0 ? Math.min(32, size * (2.1 + glow * 0.32)) : 0;
      const middleRadius = glow > 0 ? Math.min(32, size * 1.45) : 0;
      estimatedCost += 4 * (outerRadius ** 2 + middleRadius ** 2
        + Math.min(32, size) ** 2 + Math.min(32, Math.max(0.45, size * 0.3)) ** 2);
    }
  }
  const drawStep = Math.max(1, Math.ceil(estimatedCost / 8_000_000));
  for (let index = 0; index < limit; index += drawStep) {
    const rawX = positions[index * 2]!;
    const rawY = positions[index * 2 + 1]!;
    const x = rawX;
    const y = rawY;
    const offset = index * 4;
    const size = Math.max(0.25, Math.min(200, sizes[index]!));
    const opacity = Math.min(1, Math.max(0, opacities[index]!) * Math.sqrt(drawStep))
      * colors[offset + 3]! / 255;
    if (opacity <= 0.001 || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    const color = [
      colors[offset]!, colors[offset + 1]!, colors[offset + 2]!, colors[offset + 3]!
    ];
    if (primitive === "streak") {
      const vx = velocities[index * 2]!;
      const vy = velocities[index * 2 + 1]!;
      const speed = Math.max(0.000001, Math.hypot(vx, vy));
      const length = Math.min(64, Math.max(6, size * 2.4 + speed * 0.022));
      const tailX = x - vx / speed * length;
      const tailY = y - vy / speed * length;
      if (glow > 0) {
        drawLine(output, request.width, request.height, tailX, tailY, x, y,
          color, opacity * Math.min(0.34, glow * 0.13), Math.max(2, size * (1.3 + glow * 0.28)));
      }
      drawLine(output, request.width, request.height, tailX, tailY, x, y,
        color, opacity * 0.82, Math.max(0.75, size * 0.7));
      drawLine(output, request.width, request.height, x - vx / speed * length * 0.42,
        y - vy / speed * length * 0.42, x, y, [255, 250, 224, 255], opacity, Math.max(0.45, size * 0.24));
      continue;
    }
    if (glow > 0) {
      drawDisc(output, request.width, request.height, x, y, size * (2.1 + glow * 0.32),
        color, opacity * Math.min(0.24, glow * 0.09));
      drawDisc(output, request.width, request.height, x, y, size * 1.45,
        color, opacity * Math.min(0.42, glow * 0.16));
    }
    drawDisc(output, request.width, request.height, x, y, size, color, opacity * 0.9);
    drawDisc(output, request.width, request.height, x - size * 0.18, y - size * 0.2,
      Math.max(0.45, size * 0.3), [255, 255, 255, 255], opacity * 0.72);
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

function stateRecords(state: Record<string, unknown>, key: string): readonly Record<string, unknown>[] {
  const entries = state[key];
  return Array.isArray(entries) ? entries.flatMap((entry) => {
    const item = record(entry);
    return item === undefined ? [] : [item];
  }) : [];
}

function texturedPolygon(
  output: Uint8ClampedArray,
  source: Uint8Array,
  request: FrameRequest,
  points: readonly ScreenPoint[]
): void {
  if (points.length < 3) return;
  const minimumX = Math.max(0, Math.floor(Math.min(...points.map((point) => point.x))));
  const maximumX = Math.min(request.width - 1, Math.ceil(Math.max(...points.map((point) => point.x))));
  const minimumY = Math.max(0, Math.floor(Math.min(...points.map((point) => point.y))));
  const maximumY = Math.min(request.height - 1, Math.ceil(Math.max(...points.map((point) => point.y))));
  const spanX = Math.max(1, maximumX - minimumX);
  const spanY = Math.max(1, maximumY - minimumY);
  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      let inside = false;
      for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
        const a = points[index]!;
        const b = points[previous]!;
        if ((a.y > y) !== (b.y > y)
          && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      }
      if (!inside) continue;
      const sourceX = Math.round((x - minimumX) / spanX * (request.width - 1));
      const sourceY = Math.round((y - minimumY) / spanY * (request.height - 1));
      const offset = (sourceY * request.width + sourceX) * 4;
      const sheen = 0.9 + 0.1 * Math.sin((x - minimumX) / spanX * Math.PI);
      blendPixel(output, request.width, request.height, x, y, [
        source[offset]! * sheen, source[offset + 1]! * sheen,
        source[offset + 2]! * sheen, source[offset + 3]!
      ], 0.96);
    }
  }
}

function simulationFrame(
  output: Uint8ClampedArray,
  value: Record<string, unknown>,
  request: FrameRequest,
  toolName: string,
  source: Uint8Array | undefined
): boolean {
  const state = record(value.state);
  if (state === undefined) return false;

  if (toolName === "particle_flow_field" || toolName === "particle_orbit_field") {
    shadeFrame(output, source === undefined ? 0.3 : 0.48, toolName === "particle_orbit_field"
      ? [4, 5, 18] : [5, 12, 18]);
    const particles = stateRecords(state, "particles");
    if (toolName === "particle_orbit_field") {
      const center = simulationPointToPixel({ x: 0, y: 0 }, request);
      drawDisc(output, request.width, request.height, center[0], center[1], 30, [80, 42, 255, 255], 0.09);
      for (const radius of [0.18, 0.34, 0.5]) {
        drawRing(output, request, center[0], center[1], Math.min(request.width, request.height) * radius,
          [96, 92, 255, 255], 0.025, 1.2);
      }
    }
    particles.forEach((particle, index) => {
      const x = Number(particle.x);
      const y = Number(particle.y);
      const vx = Number(particle.vx);
      const vy = Number(particle.vy);
      if (![x, y, vx, vy].every(Number.isFinite)) return;
      const pixel = simulationPointToPixel({ x, y }, request);
      const speed = Math.hypot(vx, vy);
      const scale = Math.min(22, 5 + speed * 5.5);
      const velocityLength = Math.max(0.001, speed);
      const color = toolName === "particle_orbit_field"
        ? index % 3 === 0 ? [255, 108, 218, 255] : [102, 154, 255, 255]
        : index % 4 === 0 ? [108, 255, 193, 255] : [76, 205, 255, 255];
      const tailX = pixel[0] - vx / velocityLength * scale;
      const tailY = pixel[1] - vy / velocityLength * scale;
      drawLine(output, request.width, request.height, tailX, tailY, pixel[0], pixel[1], color, 0.18, 3.8);
      drawLine(output, request.width, request.height, tailX, tailY, pixel[0], pixel[1], color, 0.62, 1.15);
      drawDisc(output, request.width, request.height, pixel[0], pixel[1], 7.5, color, 0.1);
      drawDisc(output, request.width, request.height, pixel[0], pixel[1], 2.8, color, 0.9);
      drawDisc(output, request.width, request.height, pixel[0] - 0.7, pixel[1] - 0.7, 1.1,
        [248, 255, 255, 255], 0.96);
    });
    return true;
  }

  if (toolName === "sim_boids") {
    shadeFrame(output, 0.7, [4, 10, 16]);
    stateRecords(state, "boids").forEach((boid, index) => {
      const point = simulationPointToPixel({ x: Number(boid.x), y: Number(boid.y) }, request);
      const vx = Number(boid.vx);
      const vy = Number(boid.vy);
      const speed = Math.max(0.001, Math.hypot(vx, vy));
      const directionX = vx / speed;
      const directionY = vy / speed;
      const normalX = -directionY;
      const normalY = directionX;
      const length = 7 + Math.min(8, speed * 3.5);
      const width = 4.5 + index % 3;
      const nose = { x: point[0] + directionX * length, y: point[1] + directionY * length };
      const left = { x: point[0] - directionX * length * 0.55 + normalX * width,
        y: point[1] - directionY * length * 0.55 + normalY * width };
      const right = { x: point[0] - directionX * length * 0.55 - normalX * width,
        y: point[1] - directionY * length * 0.55 - normalY * width };
      fillScreenTriangle(output, request,
        { x: nose.x + 2, y: nose.y + 3 }, { x: left.x + 2, y: left.y + 3 },
        { x: right.x + 2, y: right.y + 3 }, [0, 0, 0, 255], 0.32);
      fillScreenTriangle(output, request, nose, left, right,
        index % 4 === 0 ? [255, 190, 82, 255] : [112, 231, 255, 255], 0.88);
      drawDisc(output, request.width, request.height, nose.x, nose.y, 1.2, [255, 255, 240, 255], 0.95);
    });
    return true;
  }

  if (toolName === "sim_cloth" && source !== undefined) {
    const vertices = stateRecords(state, "vertices");
    const resolution = Math.round(Math.sqrt(vertices.length));
    if (resolution < 2 || resolution * resolution !== vertices.length) return false;
    clearFrame(output, [7, 10, 18]);
    const vertex = (index: number): TextureVertex => {
      const item = vertices[index]!;
      const pixel = simulationPointToPixel({ x: Number(item.x), y: Number(item.y) }, request);
      return { x: pixel[0], y: pixel[1], u: index % resolution / (resolution - 1),
        v: Math.floor(index / resolution) / (resolution - 1) };
    };
    for (let row = 0; row < resolution - 1; row += 1) {
      for (let column = 0; column < resolution - 1; column += 1) {
        const topLeft = row * resolution + column;
        const quad = [vertex(topLeft), vertex(topLeft + 1), vertex(topLeft + resolution + 1),
          vertex(topLeft + resolution)] as const;
        const shade = 0.84 + column / Math.max(1, resolution - 1) * 0.2;
        drawTexturedQuad(output, source, request, quad, 1, shade);
      }
    }
    for (let row = 0; row < resolution; row += Math.max(2, Math.floor(resolution / 4))) {
      const points = Array.from({ length: resolution }, (_, column) => vertex(row * resolution + column));
      drawScreenPolyline(output, points, request, [240, 250, 255, 255], 0.08, 1.2);
    }
    return true;
  }

  if (toolName === "sim_collision_shatter" && source !== undefined) {
    const fragments = stateRecords(state, "fragments");
    shadeFrame(output, 0.13, [6, 8, 13]);
    const columns = Math.max(2, Math.ceil(Math.sqrt(fragments.length * request.width / request.height)));
    const rows = Math.max(1, Math.ceil(fragments.length / columns));
    fragments.forEach((fragment, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const sourceX = Number.isFinite(Number(fragment.sourceX))
        ? Number(fragment.sourceX) : -0.9 + (column + 0.5) / columns * 1.8;
      const sourceY = Number.isFinite(Number(fragment.sourceY))
        ? Number(fragment.sourceY) : -0.82 + (row + 0.5) / rows * 1.64;
      const center = simulationPointToPixel({
        x: sourceX + (Number(fragment.x) - sourceX) * 0.22,
        y: sourceY + (Number(fragment.y) - sourceY) * 0.72
      }, request);
      const rotation = Number(fragment.rotation) || 0;
      const halfWidth = request.width / columns * 0.48;
      const halfHeight = request.height / rows * 0.46;
      const cosine = Math.cos(rotation);
      const sine = Math.sin(rotation);
      const corners = [[-halfWidth, -halfHeight], [halfWidth, -halfHeight],
        [halfWidth, halfHeight], [-halfWidth, halfHeight]] as const;
      const uv = [[column / columns, row / rows], [(column + 1) / columns, row / rows],
        [(column + 1) / columns, (row + 1) / rows], [column / columns, (row + 1) / rows]] as const;
      const quad = corners.map((corner, cornerIndex) => ({
        x: center[0] + corner[0] * cosine - corner[1] * sine,
        y: center[1] + corner[0] * sine + corner[1] * cosine,
        u: uv[cornerIndex]![0], v: uv[cornerIndex]![1]
      })) as unknown as readonly [TextureVertex, TextureVertex, TextureVertex, TextureVertex];
      const shadow = quad.map((item) => ({ x: item.x + 5, y: item.y + 7 })) as unknown as
        readonly [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint];
      fillScreenTriangle(output, request, shadow[0], shadow[1], shadow[2], [0, 0, 0, 255], 0.35);
      fillScreenTriangle(output, request, shadow[0], shadow[2], shadow[3], [0, 0, 0, 255], 0.35);
      drawTexturedQuad(output, source, request, quad, 0.98, 0.92 + index % 3 * 0.05);
      drawScreenPolyline(output, [...quad, quad[0]!], request, [245, 250, 255, 255], 0.12, 0.8);
    });
    return true;
  }

  if (toolName === "sim_fluid_lite" && source !== undefined) {
    const gridSize = Number(state.gridSize);
    const cells = stateRecords(state, "cells");
    if (!Number.isInteger(gridSize) || gridSize < 2 || cells.length !== gridSize * gridSize) return false;
    const maximumDensity = Math.max(1e-6, ...cells.map((cell) => Number(cell.density) || 0));
    const snapshot = new Uint8Array(source);
    for (let y = 0; y < request.height; y += 1) {
      const row = Math.min(gridSize - 1, Math.floor(y / request.height * gridSize));
      for (let x = 0; x < request.width; x += 1) {
        const column = Math.min(gridSize - 1, Math.floor(x / request.width * gridSize));
        const cell = cells[row * gridSize + column]!;
        const density = Math.sqrt(Math.max(0, Number(cell.density) || 0) / maximumDensity);
        const vx = Number(cell.vx) || 0;
        const vy = Number(cell.vy) || 0;
        const sourceX = Math.max(0, Math.min(request.width - 1,
          Math.round(x - vx * request.width / gridSize * 2.4 * density)));
        const sourceY = Math.max(0, Math.min(request.height - 1,
          Math.round(y - vy * request.height / gridSize * 2.4 * density)));
        const from = (sourceY * request.width + sourceX) * 4;
        const to = (y * request.width + x) * 4;
        const tint = density * 0.34;
        output[to] = clampByte(snapshot[from]! * (1 - tint) + 35 * tint);
        output[to + 1] = clampByte(snapshot[from + 1]! * (1 - tint) + 178 * tint);
        output[to + 2] = clampByte(snapshot[from + 2]! * (1 - tint) + 218 * tint);
        output[to + 3] = 255;
      }
    }
    return true;
  }

  if (toolName === "sim_rigid_body_2d" && source !== undefined) {
    shadeFrame(output, 0.28, [6, 9, 15]);
    stateRecords(state, "bodies").forEach((body, index) => {
      const center = simulationPointToPixel({ x: Number(body.x), y: Number(body.y) }, request);
      const radius = Math.max(8, Number(body.radius) * Math.min(request.width, request.height) * 0.5);
      drawDisc(output, request.width, request.height, center[0] + 4, center[1] + 6,
        radius + 3, [0, 0, 0, 255], 0.34);
      drawDisc(output, request.width, request.height, center[0], center[1], radius + 4,
        index % 3 === 0 ? [255, 176, 74, 255] : [78, 198, 255, 255], 0.22);
      drawTexturedDisc(output, source, request, center[0], center[1], radius, 0.96);
      drawRing(output, request, center[0], center[1], radius, [242, 250, 255, 255], 0.12, 1.1);
    });
    return true;
  }

  if (toolName === "sim_rope") {
    shadeFrame(output, 0.58, [8, 7, 10]);
    const points = stateRecords(state, "points").map((point) => {
      const pixel = simulationPointToPixel({ x: Number(point.x), y: Number(point.y) }, request);
      return { x: pixel[0], y: pixel[1] };
    });
    if (points.length < 2) return false;
    drawScreenPolyline(output, points.map((point) => ({ x: point.x + 4, y: point.y + 6 })),
      request, [0, 0, 0, 255], 0.38, 8.5);
    drawScreenPolyline(output, points, request, [62, 31, 15, 255], 0.96, 7);
    drawScreenPolyline(output, points, request, [206, 132, 62, 255], 0.9, 4.8);
    drawScreenPolyline(output, points, request, [255, 222, 148, 255], 0.72, 1.2);
    points.forEach((point, index) => {
      if (index % 2 === 0) drawDisc(output, request.width, request.height, point.x, point.y,
        3.3, index % 4 === 0 ? [255, 228, 164, 255] : [128, 68, 30, 255], 0.62);
    });
    drawDisc(output, request.width, request.height, points[0]!.x, points[0]!.y, 9,
      [78, 86, 98, 255], 0.9);
    drawDisc(output, request.width, request.height, points[0]!.x - 2, points[0]!.y - 2, 3,
      [230, 238, 245, 255], 0.8);
    return true;
  }

  if (toolName === "sim_soft_body" && source !== undefined) {
    const points = stateRecords(state, "nodes").map((node) => {
      const pixel = simulationPointToPixel({ x: Number(node.x), y: Number(node.y) }, request);
      return { x: pixel[0], y: pixel[1] };
    });
    if (points.length < 3) return false;
    shadeFrame(output, 0.18, [5, 8, 13]);
    const shadow = points.map((point) => ({ x: point.x + 7, y: point.y + 10 }));
    fillScreenTriangle(output, request, shadow[0]!, shadow[Math.floor(shadow.length / 3)]!,
      shadow[Math.floor(shadow.length * 2 / 3)]!, [0, 0, 0, 255], 0.22);
    texturedPolygon(output, source, request, points);
    drawScreenPolyline(output, [...points, points[0]!], request, [26, 217, 187, 255], 0.34, 5.5);
    drawScreenPolyline(output, [...points, points[0]!], request, [232, 255, 248, 255], 0.56, 1.2);
    const top = points.reduce((best, point) => point.y < best.y ? point : best, points[0]!);
    drawDisc(output, request.width, request.height, top.x - 6, top.y + 8, 14,
      [255, 255, 255, 255], 0.08);
    return true;
  }

  if (toolName === "sim_spring") {
    shadeFrame(output, 0.46, [7, 8, 12]);
    const nodes = stateRecords(state, "nodes").map((node) => {
      const pixel = simulationPointToPixel({ x: Number(node.x), y: Number(node.y) }, request);
      return { x: pixel[0], y: pixel[1] };
    });
    if (nodes.length < 2) return false;
    const coil: ScreenPoint[] = [];
    for (let index = 0; index < nodes.length - 1; index += 1) {
      const from = nodes[index]!;
      const to = nodes[index + 1]!;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.max(0.001, Math.hypot(dx, dy));
      const normalX = -dy / length;
      const normalY = dx / length;
      const turns = 5;
      for (let step = 0; step < turns; step += 1) {
        const progress = step / turns;
        const offset = Math.sin(progress * Math.PI * 2) * 7;
        coil.push({ x: from.x + dx * progress + normalX * offset,
          y: from.y + dy * progress + normalY * offset });
      }
    }
    coil.push(nodes[nodes.length - 1]!);
    drawScreenPolyline(output, coil.map((point) => ({ x: point.x + 4, y: point.y + 5 })),
      request, [0, 0, 0, 255], 0.38, 6.5);
    drawScreenPolyline(output, coil, request, [116, 72, 22, 255], 0.95, 4.6);
    drawScreenPolyline(output, coil, request, [255, 190, 62, 255], 0.9, 2.8);
    drawScreenPolyline(output, coil, request, [255, 247, 198, 255], 0.78, 0.8);
    const anchor = nodes[0]!;
    drawDisc(output, request.width, request.height, anchor.x, anchor.y, 9, [86, 96, 112, 255], 0.92);
    const load = nodes[nodes.length - 1]!;
    if (source !== undefined) {
      drawDisc(output, request.width, request.height, load.x + 4, load.y + 6, 24, [0, 0, 0, 255], 0.32);
      drawTexturedDisc(output, source, request, load.x, load.y, 21, 0.95);
      drawRing(output, request, load.x, load.y, 21, [255, 224, 132, 255], 0.24, 1.2);
    }
    return true;
  }

  return false;
}

function batch0708Frame(
  output: Uint8ClampedArray,
  value: Record<string, unknown>,
  request: FrameRequest,
  toolName: string,
  source?: Uint8Array,
  inputFrames?: Readonly<Record<string, Uint8Array>>
): boolean {
  const colors = Array.isArray(value.colors) ? value.colors : [];
  const primary = hexColor(colors[0], [64, 226, 255, 255]);
  const secondary = hexColor(colors[1], [8, 16, 30, 255]);

  if (["fractal", "metaballs", "noise_field", "voronoi", "wave_surface"].includes(toolName)) {
    const key = toolName === "fractal" ? "escape" : toolName === "metaballs" ? "field"
      : toolName === "noise_field" ? "values" : toolName === "wave_surface" ? "heights" : "cells";
    const grid = numericGrid(value, key);
    if (grid === undefined) return false;
    const edges = Array.isArray(value.edges) ? value.edges as readonly number[] : undefined;
    const slopes = Array.isArray(value.slopes) ? value.slopes as readonly number[] : undefined;
    const minimum = Math.min(...grid.values);
    const maximum = Math.max(...grid.values);
    const range = Math.max(1e-6, maximum - minimum);
    const snapshot = source === undefined ? undefined : new Uint8Array(source);
    for (let y = 0; y < request.height; y += 1) {
      const gy = Math.min(grid.height - 1, Math.floor(y / request.height * grid.height));
      for (let x = 0; x < request.width; x += 1) {
        const gx = Math.min(grid.width - 1, Math.floor(x / request.width * grid.width));
        const index = gy * grid.width + gx;
        const raw = toolName === "fractal" || toolName === "metaballs"
          ? bilinearGridValue(grid, x, y, request) : grid.values[index]!;
        const normalized = (raw - minimum) / range;
        const offset = (y * request.width + x) * 4;
        if (toolName === "noise_field") {
          const displacement = (normalized - 0.5) * 18;
          const sample = snapshot === undefined
            ? secondary : wrappedFramePixel(snapshot, request, x + displacement, y + displacement * 0.58);
          const mist = 0.18 + normalized * 0.3;
          for (let channel = 0; channel < 3; channel += 1) {
            output[offset + channel] = clampByte(sample[channel]! * (1 - mist)
              + (secondary[channel]! + (primary[channel]! - secondary[channel]!) * normalized) * mist);
          }
        } else if (toolName === "metaballs") {
          const inside = smoothUnit((raw - 0.78) / 0.34);
          const edge = Math.exp(-Math.abs(raw - 1) * 10) * inside;
          const left = bilinearGridValue(grid, x - 2, y, request);
          const right = bilinearGridValue(grid, x + 2, y, request);
          const top = bilinearGridValue(grid, x, y - 2, request);
          const bottom = bilinearGridValue(grid, x, y + 2, request);
          const gradientLength = Math.max(1e-5, Math.hypot(right - left, bottom - top));
          const normalX = (right - left) / gradientLength;
          const normalY = (bottom - top) / gradientLength;
          const refraction = inside * (3.5 + edge * 5.5);
          const sample = snapshot === undefined ? secondary
            : bilinearFramePixel(snapshot, request, x + normalX * refraction, y + normalY * refraction);
          const depth = smoothUnit((raw - 0.92) / 0.8);
          const highlight = edge * (0.45 + Math.max(0, -normalX * 0.55 - normalY * 0.83) * 0.55);
          for (let channel = 0; channel < 3; channel += 1) {
            output[offset + channel] = clampByte(sample[channel]! * (1 - inside * 0.3)
              + primary[channel]! * inside * (0.18 + depth * 0.16) + 255 * highlight * 0.32);
          }
        } else if (toolName === "voronoi") {
          const edge = Math.max(0, Math.min(1, Number(edges?.[index] ?? 0)));
          const cellColor = hueColor((raw * 47 + request.time * 18) % 360);
          const base = snapshot === undefined ? secondary : [output[offset]!, output[offset + 1]!, output[offset + 2]!, 255];
          for (let channel = 0; channel < 3; channel += 1) {
            output[offset + channel] = clampByte(base[channel]! * (edge > 0 ? 0.28 : 0.7)
              + (edge > 0 ? primary[channel]! : cellColor[channel]!) * (edge > 0 ? 0.72 : 0.3));
          }
        } else if (toolName === "wave_surface") {
          const slope = Math.max(0, Math.min(1, Number(slopes?.[index] ?? 0) * 0.55));
          const displacement = (normalized - 0.5) * 22;
          const sample = snapshot === undefined ? secondary
            : wrappedFramePixel(snapshot, request, x + displacement * 0.34, y + displacement);
          const highlight = Math.max(0, normalized * 0.7 + slope * 0.5);
          for (let channel = 0; channel < 3; channel += 1) {
            output[offset + channel] = clampByte(sample[channel]! * 0.58
              + secondary[channel]! * (1 - normalized) * 0.22 + primary[channel]! * highlight * 0.48);
          }
        } else {
          const strength = Math.max(0, Math.min(1, Number(value.strength ?? 0.65)));
          const levels = Math.max(2, Math.min(10, Math.round(Number(value.levels ?? 6))));
          const recursionScale = Math.max(0.35, Math.min(0.85, Number(value.recursionScale ?? 0.62)));
          const rotationStep = Math.max(-90, Math.min(90, Number(value.rotationStep ?? 12)));
          const speed = Math.max(-2, Math.min(2, Number(value.speed ?? 0.18)));
          const left = bilinearGridValue(grid, x - 2, y, request);
          const right = bilinearGridValue(grid, x + 2, y, request);
          const top = bilinearGridValue(grid, x, y - 2, request);
          const bottom = bilinearGridValue(grid, x, y + 2, request);
          const gradientX = right - left;
          const gradientY = bottom - top;
          const edge = Math.min(1, Math.hypot(gradientX, gradientY) * 38);
          const displacement = strength * 8;
          let base = snapshot === undefined ? secondary
            : bilinearFramePixel(snapshot, request, x + gradientX * displacement, y + gradientY * displacement);
          if (snapshot !== undefined && strength > 0) {
            const centerX = (request.width - 1) / 2;
            const centerY = (request.height - 1) / 2;
            const localX = x - centerX; const localY = y - centerY;
            for (let level = 1; level <= levels; level += 1) {
              const scale = recursionScale ** level;
              const angle = (rotationStep * level + request.time * speed * 22) * Math.PI / 180;
              const cos = Math.cos(angle); const sin = Math.sin(angle);
              const rotatedX = localX * cos + localY * sin;
              const rotatedY = -localX * sin + localY * cos;
              const halfWidth = centerX * scale; const halfHeight = centerY * scale;
              if (Math.abs(rotatedX) > halfWidth || Math.abs(rotatedY) > halfHeight) continue;
              const sourceX = centerX + rotatedX / scale;
              const sourceY = centerY + rotatedY / scale;
              const recursive = bilinearFramePixel(snapshot, request, sourceX, sourceY);
              const edgeDistance = Math.min(halfWidth - Math.abs(rotatedX), halfHeight - Math.abs(rotatedY));
              const feather = Math.max(0, Math.min(1, edgeDistance / Math.max(1, Math.min(halfWidth, halfHeight) * 0.07)));
              const mix = strength * (0.72 + level / levels * 0.2) * feather;
              base = [
                clampByte(base[0]! * (1 - mix) + recursive[0]! * mix),
                clampByte(base[1]! * (1 - mix) + recursive[1]! * mix),
                clampByte(base[2]! * (1 - mix) + recursive[2]! * mix),
                255
              ];
            }
          }
          const detail = raw >= 0.999 ? 0.04
            : 0.5 + 0.5 * Math.sin(raw * 180 + Math.log1p(raw * 600) * 9);
          const overlayAmount = strength * (0.035 + detail * 0.045 + edge * 0.09);
          for (let channel = 0; channel < 3; channel += 1) {
            const color = secondary[channel]! + (primary[channel]! - secondary[channel]!) * detail;
            output[offset + channel] = clampByte(base[channel]! * (1 - overlayAmount)
              + color * overlayAmount + 238 * edge * strength * 0.06);
          }
        }
        output[offset + 3] = 255;
      }
    }
    return true;
  }

  if (toolName === "l_system") {
    const segments = (Array.isArray(value.segments) ? value.segments : []).map(record)
      .filter((entry): entry is Record<string, unknown> => entry !== undefined);
    if (segments.length === 0) return false;
    shadeFrame(output, source === undefined ? 0.38 : 0.64, [5, 14, 12]);
    const coordinates = segments.flatMap((segment) => [Number(segment.x1), Number(segment.y1), Number(segment.x2), Number(segment.y2)]);
    const xs = coordinates.filter((_, index) => index % 2 === 0);
    const ys = coordinates.filter((_, index) => index % 2 === 1);
    const minX = Math.min(...xs); const maxX = Math.max(...xs);
    const minY = Math.min(...ys); const maxY = Math.max(...ys);
    const scale = Math.min(request.width * 0.78 / Math.max(1, maxX - minX), request.height * 0.78 / Math.max(1, maxY - minY));
    const reveal = Math.min(1, 0.12 + request.time / 3);
    const count = Math.max(1, Math.floor(segments.length * reveal));
    const branchColor = hexColor(value.strokeColor, primary);
    segments.slice(0, count).forEach((segment, index) => {
      const x1 = (Number(segment.x1) - (minX + maxX) / 2) * scale + request.width / 2;
      const y1 = (Number(segment.y1) - (minY + maxY) / 2) * scale + request.height * 0.88;
      const x2 = (Number(segment.x2) - (minX + maxX) / 2) * scale + request.width / 2;
      const y2 = (Number(segment.y2) - (minY + maxY) / 2) * scale + request.height * 0.88;
      const depth = 1 - index / Math.max(1, segments.length);
      drawLine(output, request.width, request.height, x1, y1, x2, y2, [5, 38, 25, 255], 0.7, 4.6 * depth + 1.2);
      drawLine(output, request.width, request.height, x1, y1, x2, y2, branchColor, 0.72, 2.2 * depth + 0.7);
      if (index % Math.max(5, Math.floor(segments.length / 80)) === 0) {
        drawDisc(output, request.width, request.height, x2, y2, 2.5 + depth * 2.5,
          [132, 255, 154, 255], 0.42 + depth * 0.25);
      }
    });
    return true;
  }

  if (toolName === "sacred_geometry") {
    shadeFrame(output, source === undefined ? 0.25 : 0.55, secondary);
    const circles = Array.isArray(value.circles) ? value.circles : [];
    const lines = Array.isArray(value.lines) ? value.lines : [];
    const centerX = request.width / 2; const centerY = request.height / 2;
    const unit = Math.min(request.width, request.height) * 0.44;
    circles.forEach((entry, index) => {
      const circle = record(entry);
      if (circle === undefined) return;
      const x = centerX + Number(circle.x) * unit;
      const y = centerY - Number(circle.y) * unit;
      const radius = Math.abs(Number(circle.radius)) * unit;
      drawRing(output, request, x, y, radius, primary, 0.14, 4.5);
      drawRing(output, request, x, y, radius, index % 3 === 0 ? [255, 255, 246, 255] : primary, 0.74, 1.15);
    });
    lines.forEach((entry) => {
      const line = record(entry); const from = finitePoint(line?.from); const to = finitePoint(line?.to);
      if (from === undefined || to === undefined) return;
      drawLine(output, request.width, request.height, centerX + from.x * unit, centerY - from.y * unit,
        centerX + to.x * unit, centerY - to.y * unit, primary, 0.18, 5);
      drawLine(output, request.width, request.height, centerX + from.x * unit, centerY - from.y * unit,
        centerX + to.x * unit, centerY - to.y * unit, [255, 250, 224, 255], 0.72, 1.05);
    });
    drawRing(output, request, centerX, centerY, unit * 0.98, primary, 0.72, 1.6);
    drawRing(output, request, centerX, centerY, unit * 0.68, [255, 248, 214, 255], 0.34, 0.9);
    return true;
  }

  if (toolName === "spiral_tunnel") {
    const points = pointArray(value.points);
    if (points.length < 3) return false;
    shadeFrame(output, source === undefined ? 0.18 : 0.48, secondary);
    const centerX = request.width / 2; const centerY = request.height / 2;
    const scale = Math.min(request.width, request.height) * 0.48;
    for (let index = points.length - 2; index >= 0; index -= 1) {
      const a = points[index]!; const b = points[index + 1]!;
      const depth = 1 - index / points.length;
      drawLine(output, request.width, request.height, centerX + a.x * scale, centerY - a.y * scale,
        centerX + b.x * scale, centerY - b.y * scale, primary, 0.08 + depth * 0.72, 0.7 + depth * 4.5);
      if (index % 9 === 0) drawDisc(output, request.width, request.height,
        centerX + a.x * scale, centerY - a.y * scale, 1.2 + depth * 5,
        [255, 255, 245, 255], 0.35 + depth * 0.5);
    }
    for (let ring = 0; ring < 9; ring += 1) {
      const phase = (ring / 9 + request.time * 0.22) % 1;
      drawRing(output, request, centerX, centerY, 8 + phase * scale * 0.92,
        ring % 2 === 0 ? primary : [122, 118, 255, 255], (1 - phase) * 0.32, 1 + phase * 2.2);
    }
    return true;
  }

  if (toolName === "spectrum_bars") {
    const bars = Array.isArray(value.bars) ? value.bars.filter((entry): entry is number => typeof entry === "number") : [];
    if (bars.length === 0) return false;
    clearFrame(output, secondary);
    const gap = Math.max(1, request.width * 0.0025);
    const width = (request.width - gap * (bars.length + 1)) / bars.length;
    const baseline = request.height * 0.82;
    bars.forEach((entry, index) => {
      const amount = Math.max(0.025, Math.min(1, entry));
      const height = amount * request.height * 0.64;
      const left = gap + index * (width + gap);
      const color = index % 5 === 0 ? [255, 82, 170, 255] : primary;
      for (let x = Math.floor(left); x <= left + width; x += 1) {
        for (let y = Math.floor(baseline - height); y <= baseline; y += 1) {
          const vertical = (baseline - y) / Math.max(1, height);
          blendPixel(output, request.width, request.height, x, y, color, 0.45 + vertical * 0.5);
        }
      }
      drawDisc(output, request.width, request.height, left + width / 2,
        baseline - height - 5, Math.max(1.5, width * 0.32), color, 0.78);
    });
    drawLine(output, request.width, request.height, 0, baseline + 3, request.width, baseline + 3,
      [220, 250, 255, 255], 0.28, 1.2);
    return true;
  }

  if (toolName === "waveform") {
    const points = pointArray(value.points); const mirrored = pointArray(value.mirrored);
    if (points.length < 2) return false;
    clearFrame(output, secondary);
    const thickness = typeof value.thickness === "number" ? value.thickness : 2;
    const centerY = request.height / 2;
    for (let index = 1; index < points.length; index += 1) {
      const a = pointToPixel(points[index - 1]!, request.width, request.height);
      const b = pointToPixel(points[index]!, request.width, request.height);
      const from = Math.floor(Math.min(a[0], b[0])); const to = Math.ceil(Math.max(a[0], b[0]));
      for (let x = from; x <= to; x += 1) {
        const ratio = (x - a[0]) / Math.max(1, b[0] - a[0]);
        const y = a[1] + (b[1] - a[1]) * ratio;
        drawLine(output, request.width, request.height, x, centerY, x, y, primary, 0.12, 1);
      }
    }
    drawPolyline(output, points, request, primary, 0.24, thickness * 4.2);
    drawPolyline(output, points, request, [242, 255, 255, 255], 0.94, thickness);
    if (mirrored.length > 1) {
      drawPolyline(output, mirrored, request, [255, 92, 184, 255], 0.22, thickness * 4);
      drawPolyline(output, mirrored, request, [255, 210, 240, 255], 0.78, thickness);
    }
    return true;
  }

  if (toolName === "beat_pulse" || toolName === "onset_trigger" || toolName === "vocal_reactive_text") {
    const energy = Math.max(0, Math.min(1.5, Number(value.pulse ?? value.triggerStrength ?? value.energy ?? 0)));
    clearFrame(output, [5, 9, 18, 255]);
    const centerX = request.width / 2; const centerY = request.height / 2;
    const baseRadius = Math.min(request.width, request.height) * (0.12 + energy * 0.16);
    if (toolName === "vocal_reactive_text") {
      const columns = 11;
      for (let index = 0; index < columns; index += 1) {
        const local = energy * (0.55 + 0.45 * Math.sin(index * 1.7 + request.time * 6) ** 2);
        const height = request.height * (0.08 + local * 0.34);
        const x = centerX + (index - (columns - 1) / 2) * request.width * 0.045;
        drawLine(output, request.width, request.height, x, centerY - height / 2, x, centerY + height / 2,
          index % 2 === 0 ? [68, 236, 255, 255] : [255, 92, 196, 255], 0.74, 5);
        drawDisc(output, request.width, request.height, x, centerY - height / 2, 4,
          [245, 255, 255, 255], 0.72);
      }
      drawRing(output, request, centerX, centerY, baseRadius * 1.7, [82, 230, 255, 255], 0.26, 2);
      const glyphs: Readonly<Record<string, readonly string[]>> = {
        V: ["10001", "10001", "10001", "10001", "01010", "01010", "00100"],
        O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
        I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
        C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
        E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"]
      };
      const label = "VOICE";
      const cell = Math.max(3, Math.min(9, request.height * (0.011 + energy * 0.006)));
      const wordWidth = label.length * cell * 6 - cell;
      const startX = centerX - wordWidth / 2;
      const startY = centerY - cell * 3.5;
      [...label].forEach((character, letterIndex) => glyphs[character]!.forEach((row, rowIndex) => {
        [...row].forEach((bit, columnIndex) => {
          if (bit !== "1") return;
          const x = startX + (letterIndex * 6 + columnIndex) * cell;
          const y = startY + rowIndex * cell;
          drawDisc(output, request.width, request.height, x, y, cell * 0.82,
            letterIndex % 2 === 0 ? [74, 232, 255, 255] : [255, 104, 206, 255], 0.18 + energy * 0.28);
          drawDisc(output, request.width, request.height, x, y, cell * 0.42,
            [242, 255, 255, 255], 0.72 + energy * 0.18);
        });
      }));
    } else {
      for (let ring = 0; ring < 5; ring += 1) {
        const travel = (request.time * (toolName === "onset_trigger" ? 2.8 : 1.25) + ring / 5) % 1;
        drawRing(output, request, centerX, centerY, baseRadius + travel * Math.min(request.width, request.height) * 0.34,
          ring % 2 === 0 ? [66, 230, 255, 255] : [255, 78, 174, 255],
          Math.max(0.04, energy) * (1 - travel) * 0.75, 1.5 + energy * 3);
      }
      const spokes = toolName === "onset_trigger" ? 28 : 16;
      for (let index = 0; index < spokes; index += 1) {
        const angle = index / spokes * Math.PI * 2 + request.time * 0.35;
        const length = baseRadius * (1.1 + energy * (1 + (index % 4) * 0.18));
        drawLine(output, request.width, request.height,
          centerX + Math.cos(angle) * baseRadius * 0.38, centerY + Math.sin(angle) * baseRadius * 0.38,
          centerX + Math.cos(angle) * length, centerY + Math.sin(angle) * length,
          [210, 250, 255, 255], 0.18 + energy * 0.56, 1.1 + energy * 1.6);
      }
      drawDisc(output, request.width, request.height, centerX, centerY, baseRadius * 0.42,
        [80, 210, 255, 255], 0.2 + energy * 0.34);
    }
    return true;
  }

  if (toolName === "texture_overlay") {
    const base = inputFrames?.base_image ?? source;
    const overlay = inputFrames?.overlay_image;
    if (base === undefined || overlay === undefined || base.length !== output.length || overlay.length !== output.length) return false;
    const uvOffset = Array.isArray(value.uvOffset) ? value.uvOffset : [0, 0];
    const uvScale = Array.isArray(value.uvScale) ? Number(value.uvScale[0]) : 1;
    const opacity = Math.max(0, Math.min(1, Number(value.opacity ?? 0.45)));
    const mode = typeof value.blendMode === "string" ? value.blendMode : "overlay";
    for (let y = 0; y < request.height; y += 1) for (let x = 0; x < request.width; x += 1) {
      const offset = (y * request.width + x) * 4;
      const texture = wrappedFramePixel(overlay, request,
        x * uvScale + Number(uvOffset[0] ?? 0) * request.width,
        y * uvScale + Number(uvOffset[1] ?? 0) * request.height);
      const textureAlpha = opacity * texture[3] / 255;
      for (let channel = 0; channel < 3; channel += 1) {
        const blended = blendChannel(base[offset + channel]!, texture[channel]!, mode);
        output[offset + channel] = clampByte(base[offset + channel]! * (1 - textureAlpha) + blended * textureAlpha);
      }
      output[offset + 3] = 255;
    }
    return true;
  }

  if (toolName === "chart_reveal") {
    const items = (Array.isArray(value.items) ? value.items : []).map(record)
      .filter((entry): entry is Record<string, unknown> => entry !== undefined);
    if (items.length === 0) return false;
    clearFrame(output, [8, 14, 24, 255]);
    const values = items.map((item) => Math.max(0, Number(item.value ?? 0)) * Math.max(0, Math.min(1, Number(item.reveal ?? 1))));
    const maximum = Math.max(1e-6, ...values);
    const chartType = typeof value.chartType === "string" ? value.chartType : "bar";
    const palette = items.map((item, index) => hexColor(item.color,
      index % 2 === 0 ? [66, 220, 255, 255] : [255, 88, 176, 255]));
    const seriesColor = palette[0] ?? [66, 220, 255, 255];
    if (chartType === "pie") {
      const total = Math.max(1e-6, ...[values.reduce((sum, entry) => sum + entry, 0)]);
      let angle = -Math.PI / 2;
      const radius = Math.min(request.width, request.height) * 0.3;
      values.forEach((entry, index) => {
        const end = angle + entry / total * Math.PI * 2;
        for (let cursor = angle; cursor < end; cursor += 0.008) {
          drawLine(output, request.width, request.height, request.width / 2, request.height / 2,
            request.width / 2 + Math.cos(cursor) * radius, request.height / 2 + Math.sin(cursor) * radius,
            palette[index]!, 0.82, 1.5);
        }
        angle = end;
      });
      drawDisc(output, request.width, request.height, request.width / 2, request.height / 2,
        radius * 0.42, [8, 14, 24, 255], 1);
    } else {
      const left = request.width * 0.12; const right = request.width * 0.9;
      const bottom = request.height * 0.82; const top = request.height * 0.16;
      const points = values.map((entry, index) => ({
        x: left + index / Math.max(1, values.length - 1) * (right - left),
        y: bottom - entry / maximum * (bottom - top)
      }));
      if (chartType === "bar") points.forEach((point, index) => {
        const width = (right - left) / Math.max(2, values.length) * 0.62;
        for (let x = point.x - width / 2; x <= point.x + width / 2; x += 1) {
          drawLine(output, request.width, request.height, x, bottom, x, point.y,
            palette[index]!, 0.76, 1);
        }
      });
      else {
        if (chartType === "area") points.forEach((point, index) => {
          if (index === 0) return;
          const previous = points[index - 1]!;
          for (let x = Math.floor(previous.x); x <= point.x; x += 1) {
            const ratio = (x - previous.x) / Math.max(1, point.x - previous.x);
            const y = previous.y + (point.y - previous.y) * ratio;
            drawLine(output, request.width, request.height, x, bottom, x, y, seriesColor, 0.14, 1);
          }
        });
        drawScreenPolyline(output, points, request, seriesColor, 0.24, 7);
        drawScreenPolyline(output, points, request, [238, 255, 255, 255], 0.92, 2);
        points.forEach((point, index) => drawDisc(output, request.width, request.height,
          point.x, point.y, 4, palette[index]!, 0.9));
      }
      drawLine(output, request.width, request.height, left, bottom, right, bottom, [186, 204, 220, 255], 0.5, 1);
    }
    return true;
  }

  if (toolName === "live_binding") {
    const mapping = typeof value.mapping === "string" ? value.mapping : "normalized";
    const raw = Number(value.value ?? 0);
    const amount = Math.max(0, Math.min(1, Math.abs(raw)));
    const activeColor = mapping === "threshold" ? [255, 82, 86, 255] as const
      : mapping === "pulse" ? [255, 190, 68, 255] as const
        : [72, 226, 255, 255] as const;
    clearFrame(output, [7 + amount * 5, 13 + amount * 8, 22 + amount * 12, 255]);
    const centerX = request.width / 2; const centerY = request.height * 0.55;
    const radius = Math.min(request.width, request.height) * 0.27;
    drawDisc(output, request.width, request.height, centerX, centerY,
      radius * (0.38 + amount * 0.2), activeColor, 0.06 + amount * 0.12);
    if (mapping === "pulse" && amount > 0.01) {
      for (let ring = 0; ring < 3; ring += 1) {
        const ringRadius = radius * (0.42 + ring * 0.19 + amount * 0.12);
        const segments = 48;
        for (let index = 0; index < segments; index += 1) {
          const a = index / segments * Math.PI * 2;
          const b = (index + 1) / segments * Math.PI * 2;
          drawLine(output, request.width, request.height,
            centerX + Math.cos(a) * ringRadius, centerY + Math.sin(a) * ringRadius,
            centerX + Math.cos(b) * ringRadius, centerY + Math.sin(b) * ringRadius,
            activeColor, amount * (0.26 - ring * 0.055), 1.4);
        }
      }
    }
    for (let index = 0; index < 72; index += 1) {
      const ratio = index / 71; const angle = Math.PI * (0.75 + ratio * 1.5);
      const active = ratio <= amount;
      drawLine(output, request.width, request.height,
        centerX + Math.cos(angle) * radius * 0.78, centerY + Math.sin(angle) * radius * 0.78,
        centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius,
        active ? activeColor : [56, 68, 82, 255], active ? 0.92 : 0.38, 2.4);
    }
    const needle = Math.PI * (0.75 + amount * 1.5);
    drawLine(output, request.width, request.height, centerX, centerY,
      centerX + Math.cos(needle) * radius * 0.72, centerY + Math.sin(needle) * radius * 0.72,
      [248, 252, 255, 255], 0.9, 2.2);
    drawDisc(output, request.width, request.height, centerX, centerY, 7, activeColor, 0.95);
    return true;
  }

  if (toolName === "number_counter") {
    clearFrame(output, [7, 12, 20, 255]);
    const formatted = typeof value.formatted === "string" ? value.formatted : String(value.value ?? 0);
    const progress = Math.max(0, Math.min(1, Number(value.progress ?? 0)));
    drawSevenSegmentText(output, request, formatted.slice(0, 10), [104, 238, 255, 255], 1);
    drawSevenSegmentText(output, request, formatted.slice(0, 10), [238, 255, 255, 255], 0.96);
    const width = request.width * 0.58; const left = (request.width - width) / 2;
    drawLine(output, request.width, request.height, left, request.height * 0.72,
      left + width, request.height * 0.72, [54, 70, 88, 255], 0.7, 2.2);
    drawLine(output, request.width, request.height, left, request.height * 0.72,
      left + width * progress, request.height * 0.72, [255, 88, 174, 255], 0.9, 3.2);
    return true;
  }

  if (["glass", "hologram", "metal"].includes(toolName)) {
    const frame = inputFrames?.source_image ?? source;
    if (frame === undefined || frame.length !== output.length) return false;
    if (toolName === "glass") {
      const blur = Math.max(0, Math.min(18, Number(value.blurSigma ?? 4)));
      const refraction = Math.max(0, Number(value.indexOfRefraction ?? 1.2) - 1);
      const border = Math.max(0, Math.min(1, Number(value.borderHighlight ?? 0.2)));
      const transmission = Math.max(0, Math.min(1, Number(value.transmission ?? 0.3)));
      const tint = Array.isArray(value.tintRgb) ? value.tintRgb as readonly number[]
        : Array.isArray(value.rgba) ? value.rgba as readonly number[] : [1, 1, 1];
      const radius = blur * 0.72;
      const tintMix = 0.04 + (1 - transmission) * 0.08;
      const sampleOffsets = Object.freeze([
        [0, 0, 4], [-1, 0, 2], [1, 0, 2], [0, -1, 2], [0, 1, 2],
        [-0.72, -0.72, 1], [0.72, -0.72, 1], [-0.72, 0.72, 1], [0.72, 0.72, 1]
      ] as const);
      for (let y = 0; y < request.height; y += 1) for (let x = 0; x < request.width; x += 1) {
        const nx = x / Math.max(1, request.width - 1);
        const ny = y / Math.max(1, request.height - 1);
        const opticalX = (Math.sin(ny * 17.3 + Math.sin(nx * 5.7))
          + Math.sin((nx + ny) * 11.9) * 0.42) * refraction * 3.2;
        const opticalY = (Math.cos(nx * 15.1 + Math.cos(ny * 6.3))
          + Math.cos((nx - ny) * 10.7) * 0.38) * refraction * 3.2;
        const channelSums = [0, 0, 0];
        let totalWeight = 0;
        for (const [offsetX, offsetY, weight] of sampleOffsets) {
          const sample = clampedFramePixel(frame, request,
            x + opticalX + offsetX * radius, y + opticalY + offsetY * radius);
          totalWeight += weight;
          for (let channel = 0; channel < 3; channel += 1) channelSums[channel]! += sample[channel]! * weight;
        }
        const edgeDistance = Math.min(x, y, request.width - 1 - x, request.height - 1 - y);
        const edgeHighlight = Math.exp(-edgeDistance / Math.max(1, 1.5 + border * 5)) * border * 30;
        const target = (y * request.width + x) * 4;
        for (let channel = 0; channel < 3; channel += 1) {
          const average = channelSums[channel]! / totalWeight;
          output[target + channel] = clampByte(average * (1 - tintMix)
            + Number(tint[channel] ?? 1) * 255 * tintMix + edgeHighlight);
        }
        output[target + 3] = 255;
      }
    } else if (toolName === "hologram") {
      const emissive = Array.isArray(value.emissive) ? value.emissive as readonly number[] : [0.1, 0.9, 1, 0.7];
      const glitch = Number(value.glitchOffset ?? 0);
      const flicker = Math.max(0.55, Number(value.flickerLevel ?? 1));
      for (let y = 0; y < request.height; y += 1) {
        const scan = 0.48 + 0.52 * Math.sin(y * 0.31 - request.time * 18);
        const shift = Math.abs(glitch) > 0.01 && (y + request.frame * 7) % 47 < 7 ? glitch * request.width * 0.22 : 0;
        for (let x = 0; x < request.width; x += 1) {
          const sample = wrappedFramePixel(frame, request, x + shift, y);
          const luminance = (sample[0] * 0.21 + sample[1] * 0.72 + sample[2] * 0.07) / 255;
          const offset = (y * request.width + x) * 4;
          for (let channel = 0; channel < 3; channel += 1) {
            const sourceLift = sample[channel]! * (0.62 + luminance * 0.18);
            const emission = Number(emissive[channel] ?? 0.8) * 255
              * (0.22 + luminance * 0.42) * flicker * (0.76 + scan * 0.24);
            output[offset + channel] = clampByte(sourceLift + emission);
          }
          output[offset + 3] = 255;
        }
      }
      for (let y = request.frame % 18; y < request.height; y += 18) {
        drawLine(output, request.width, request.height, 0, y, request.width, y,
          [180, 255, 255, 255], 0.10, 0.55);
      }
    } else {
      const f0 = Array.isArray(value.f0) ? value.f0 as readonly number[] : [0.9, 0.9, 0.86, 1];
      const roughness = Math.max(0.02, Math.min(1, Number(value.roughness ?? 0.32)));
      const brush = Math.max(8, Number(value.brushFrequency ?? 48));
      const reflection = Math.max(0, Math.min(1, Number(value.reflectedLuminance ?? 0.7)));
      for (let y = 0; y < request.height; y += 1) for (let x = 0; x < request.width; x += 1) {
        const offset = (y * request.width + x) * 4;
        const luminance = (frame[offset]! * 0.21 + frame[offset + 1]! * 0.72 + frame[offset + 2]! * 0.07) / 255;
        const sweep = Math.max(0, Math.cos((x / request.width - (request.time * 0.17 % 1)) * Math.PI * 3)) ** (4 + roughness * 12);
        const brushed = 0.82 + Math.sin(y * brush / request.height * Math.PI * 2) * 0.08 * (1 - roughness);
        for (let channel = 0; channel < 3; channel += 1) {
          output[offset + channel] = clampByte((frame[offset + channel]! * 0.28
            + Number(f0[channel] ?? 0.8) * 255 * (0.3 + luminance * 0.34 + sweep * reflection * 0.55)) * brushed);
        }
        output[offset + 3] = 255;
      }
    }
    return true;
  }

  return false;
}

function polishedStructuredFrame(
  output: Uint8ClampedArray,
  value: Record<string, unknown>,
  request: FrameRequest,
  toolName: string,
  source?: Uint8Array,
  inputFrames?: Readonly<Record<string, Uint8Array>>
): boolean {
  if (toolName === "echo_trail") {
    const histories = Array.isArray(value.histories) ? [...value.histories].reverse() : [];
    const blendMode = typeof value.blendMode === "string" ? value.blendMode : "normal";
    const currentFrame = inputFrames?.source_video ?? source;
    if (currentFrame === undefined || currentFrame.length !== output.length) return false;
    const currentSnapshot = new Uint8Array(currentFrame);
    for (const entry of histories) {
      const history = record(entry);
      const frameKey = typeof history?.frameKey === "string" ? history.frameKey : "";
      const frame = inputFrames?.[frameKey];
      if (frame === undefined || frame.length !== output.length) continue;
      blendHistoricalFrame(
        frame,
        currentSnapshot,
        output,
        request,
        typeof history?.offsetX === "number" ? history.offsetX : 0,
        typeof history?.offsetY === "number" ? history.offsetY : 0,
        typeof history?.opacity === "number" ? history.opacity : 0,
        blendMode
      );
    }
    return true;
  }
  if (batch0708Frame(output, value, request, toolName, source, inputFrames)) return true;
  if (batch05Frame(output, value, request, toolName, source, inputFrames)) return true;
  if (simulationFrame(output, value, request, toolName, source)) return true;
  if (toolName === "shape_boolean_animate") {
    const grid = numericGrid(value, "alpha");
    if (grid === undefined) return false;
    const operation = typeof value.operation === "string" ? value.operation : "union";
    const palette = operation === "intersect" ? [255, 76, 190, 255]
      : operation === "subtract" ? [255, 104, 62, 255]
        : operation === "xor" ? [76, 158, 255, 255] : [42, 232, 180, 255];
    const progress = typeof value.progress === "number" ? Math.max(0, Math.min(1, value.progress)) : 1;
    for (let y = 0; y < request.height; y += 1) {
      const gridY = Math.min(grid.height - 1, Math.floor(y / request.height * grid.height));
      for (let x = 0; x < request.width; x += 1) {
        const gridX = Math.min(grid.width - 1, Math.floor(x / request.width * grid.width));
        const index = gridY * grid.width + gridX;
        const alpha = Math.max(0, Math.min(1, grid.values[index]!));
        if (alpha <= 0.001) continue;
        const right = grid.values[gridY * grid.width + Math.min(grid.width - 1, gridX + 1)]!;
        const down = grid.values[Math.min(grid.height - 1, gridY + 1) * grid.width + gridX]!;
        const boundary = Math.max(Math.abs(alpha - right), Math.abs(alpha - down));
        blendPixel(output, request.width, request.height, x, y, palette,
          alpha * (0.28 + progress * 0.48));
        if (boundary > 0.12) {
          blendPixel(output, request.width, request.height, x, y, [244, 255, 252, 255],
            Math.min(0.9, boundary * 1.6));
        }
      }
    }
    const shapeA = pointArray(value.shapeA);
    const shapeB = pointArray(value.shapeB);
    drawPolyline(output, shapeA, request, [106, 255, 218, 255], 0.34, 2.8, true);
    drawPolyline(output, shapeB, request, operation === "subtract"
      ? [255, 116, 82, 255] : [255, 116, 214, 255], 0.32 + progress * 0.2, 2.4, true);
    return true;
  }

  if (toolName === "volumetric_ray") {
    const grid = numericGrid(value, "radiance");
    if (grid === undefined) return false;
    const maximum = grid.values.reduce((current, entry) => Math.max(current, entry), 0);
    if (maximum <= Number.EPSILON) return true;
    for (let y = 0; y < request.height; y += 1) {
      const gridY = Math.min(grid.height - 1, Math.floor(y / request.height * grid.height));
      for (let x = 0; x < request.width; x += 1) {
        const gridX = Math.min(grid.width - 1, Math.floor(x / request.width * grid.width));
        const radiance = Math.max(0, grid.values[gridY * grid.width + gridX]!);
        const tone = 1 - Math.exp(-radiance * 0.42);
        if (tone <= 0.001) continue;
        const dust = 0.9 + 0.1 * Math.sin(x * 0.071 + y * 0.043 + request.time * 3.1);
        const warmth = y / Math.max(1, request.height - 1);
        blendPixel(output, request.width, request.height, x, y,
          [255, 238 - warmth * 24, 178 - warmth * 36, 255], Math.min(0.86, tone * dust * 0.78));
      }
    }
    const lightX = typeof value.lightX === "number" ? value.lightX * request.width : request.width * 0.5;
    const lightY = typeof value.lightY === "number" ? value.lightY * request.height : request.height * 0.2;
    drawDisc(output, request.width, request.height, lightX, lightY,
      Math.min(request.width, request.height) * 0.075, [255, 248, 218, 255], 0.32);
    return true;
  }

  if (toolName === "wave_path") {
    const points = pointArray(value.points);
    const sourcePoints = pointArray(value.sourcePoints);
    const amplitude = typeof value.amplitude === "number" ? Math.max(0, value.amplitude) : 0;
    if (points.length < 2) return false;
    if (amplitude <= Number.EPSILON) return true;
    if (sourcePoints.length === points.length && sourcePoints.length >= 2) {
      fillPolygon(output, [...sourcePoints, ...[...points].reverse()], request);
      drawPolyline(output, sourcePoints, request, [42, 116, 132, 255], 0.26, 2.2);
    }
    const ribbonWidth = Math.min(18, 4 + amplitude * 0.16);
    drawPolyline(output, points, request, [4, 34, 58, 255], 0.3, ribbonWidth + 5);
    drawPolyline(output, points, request, [34, 216, 196, 255], 0.52, ribbonWidth);
    drawPolyline(output, points, request, [104, 236, 255, 255], 0.72, Math.max(2.2, ribbonWidth * 0.42));
    drawPolyline(output, points, request, [237, 255, 252, 255], 0.84, 0.9);
    const stride = Math.max(4, Math.floor(points.length / 12));
    points.forEach((point, index) => {
      if (index % stride !== 0) return;
      const pixel = pointToPixel(point, request.width, request.height);
      const pulse = 0.12 + 0.06 * (0.5 + 0.5 * Math.sin(request.time * 4 + index));
      drawDisc(output, request.width, request.height, pixel[0], pixel[1], 4.5,
        [145, 255, 229, 255], pulse);
    });
    return true;
  }

  if (toolName === "neon_trace") {
    const points = pointArray(value.points);
    const coreIntensity = typeof value.coreIntensity === "number" ? Math.max(0, value.coreIntensity) : 0;
    if (coreIntensity <= Number.EPSILON || points.length < 2) return true;
    const hue = typeof value.hue === "number" ? value.hue : 190;
    const color = hueColor(hue);
    const glowLayers = Array.isArray(value.glowLayers) ? value.glowLayers : [];
    glowLayers.forEach((entry) => {
      const layer = record(entry);
      const radius = typeof layer?.radius === "number" ? Math.max(0, layer.radius) : 0;
      const intensity = typeof layer?.intensity === "number" ? Math.max(0, layer.intensity) : 0;
      if (radius > 0 && intensity > 0) {
        drawPolyline(output, points, request, color, Math.min(0.42, intensity * 0.12), Math.max(1.5, radius * 0.56));
      }
    });
    const coreWidth = typeof value.coreWidth === "number" ? Math.max(0.5, value.coreWidth) : 2;
    drawPolyline(output, points, request, color, Math.min(0.92, coreIntensity * 0.28), coreWidth * 2.2);
    drawPolyline(output, points, request, [248, 255, 255, 255], Math.min(1, coreIntensity * 0.48), coreWidth * 0.62);
    const head = points[points.length - 1]!;
    const pixel = pointToPixel(head, request.width, request.height);
    const outerRadius = Math.max(6, Math.min(28, coreWidth * 3.5));
    drawDisc(output, request.width, request.height, pixel[0], pixel[1], outerRadius, color, 0.34);
    drawDisc(output, request.width, request.height, pixel[0], pixel[1], 2.4, [255, 255, 255, 255], 1);
    return true;
  }

  if (toolName === "paint_on") {
    if (source === undefined || source.length !== output.length) return false;
    for (let offset = 0; offset < output.length; offset += 4) {
      output[offset] = clampByte(source[offset]! * 0.13 + 8);
      output[offset + 1] = clampByte(source[offset + 1]! * 0.13 + 10);
      output[offset + 2] = clampByte(source[offset + 2]! * 0.13 + 13);
      output[offset + 3] = source[offset + 3]!;
    }
    const dabs = Array.isArray(value.dabs) ? value.dabs : [];
    const brushShape = typeof value.brushShape === "string" ? value.brushShape : "round";
    const hardness = typeof value.hardness === "number" ? Math.max(0, Math.min(1, value.hardness)) : 0.7;
    const feather = typeof value.feather === "number" ? Math.max(0, value.feather) : 4;
    dabs.forEach((entry) => {
      const dab = record(entry);
      if (dab !== undefined) revealSourceDab(output, source, request, dab, brushShape, hardness, feather);
    });
    const tip = record(dabs[dabs.length - 1]);
    const tipPoint = finitePoint(tip);
    if (tipPoint !== undefined) {
      const pixel = pointToPixel(tipPoint, request.width, request.height);
      drawDisc(output, request.width, request.height, pixel[0], pixel[1], 4.2,
        [255, 218, 154, 255], 0.24);
    }
    return true;
  }

  if (toolName === "blob_morph") {
    const points = pointArray(value.points);
    if (points.length < 3) return false;
    fillPolygon(output, points, request);
    drawPolyline(output, points, request, [5, 45, 54, 255], 0.32, 8, true);
    drawPolyline(output, points, request, [32, 232, 191, 255], 0.5, 3.8, true);
    drawPolyline(output, points, request, [203, 255, 239, 255], 0.82, 1.1, true);
    const center = finitePoint(value.center);
    if (center !== undefined) {
      const pixel = pointToPixel(center, request.width, request.height);
      drawDisc(output, request.width, request.height, pixel[0] - request.width * 0.035,
        pixel[1] - request.height * 0.045, Math.min(request.width, request.height) * 0.055,
        [190, 255, 238, 255], 0.13);
    }
    points.filter((_, index) => index % Math.max(2, Math.floor(points.length / 8)) === 0)
      .forEach((point, index) => {
        const pixel = pointToPixel(point, request.width, request.height);
        const pulse = 0.08 + (Math.sin(request.time * 2.2 + index) + 1) * 0.025;
        drawDisc(output, request.width, request.height, pixel[0], pixel[1], 5, [128, 255, 218, 255], pulse);
      });
    return true;
  }

  if (toolName === "dash_flow") {
    const segments = Array.isArray(value.segments) ? value.segments : [];
    const color = hexColor(value.color, [32, 220, 255, 255]);
    const thickness = typeof value.thickness === "number"
      ? Math.max(0.5, Math.min(30, value.thickness)) : 3;
    let rendered = false;
    segments.forEach((entry) => {
      const segment = record(entry);
      const points = pointArray(segment?.points);
      if (points.length < 2) return;
      rendered = true;
      drawPolyline(output, points, request, [8, 18, 28, 255], 0.32, thickness + 2.4);
      drawPolyline(output, points, request, color, 0.88, thickness);
      drawPolyline(output, points, request, [255, 255, 255, 255], 0.42, Math.max(0.5, thickness * 0.28));
    });
    return rendered;
  }

  if (toolName === "electric_arc") {
    const glow = typeof value.glowRadius === "number" ? Math.max(0, value.glowRadius) : 10;
    const intensity = typeof value.intensity === "number" ? Math.max(0, value.intensity) : 1;
    const color = hexColor(value.color, [72, 216, 255, 255]);
    if (intensity <= 0) return true;
    const arcs = Array.isArray(value.arcs) ? value.arcs : [];
    let rendered = false;
    arcs.forEach((entry) => {
      const points = pointArray(record(entry)?.points);
      if (points.length < 2) return;
      rendered = true;
      drawElectricPath(output, points, request, glow, intensity, color, "pixel");
      for (const endpoint of [points[0]!, points[points.length - 1]!]) {
        const pixel = [endpoint.x, endpoint.y] as const;
        drawDisc(output, request.width, request.height, pixel[0], pixel[1], Math.max(3, glow * 0.45),
          color, 0.18);
        drawDisc(output, request.width, request.height, pixel[0], pixel[1], 1.4,
          [245, 255, 255, 255], 0.95);
      }
    });
    const branches = Array.isArray(value.branches) ? value.branches : [];
    branches.forEach((entry) => {
      const branch = record(entry);
      const points = pointArray(branch?.points);
      const branchIntensity = typeof branch?.intensity === "number" ? branch.intensity : intensity * 0.65;
      drawElectricPath(output, points, request, glow * 0.55, branchIntensity * 0.72, color, "pixel");
      const tip = points[points.length - 1];
      if (tip !== undefined) {
        const pixel = [tip.x, tip.y] as const;
        drawDisc(output, request.width, request.height, pixel[0], pixel[1], 3.4,
          [178, 241, 255, 255], 0.38);
      }
    });
    return rendered;
  }

  if (toolName === "lightning_trace") {
    const main = pointArray(value.main);
    const glow = typeof value.glowRadius === "number" ? Math.max(0, value.glowRadius) : 8;
    if (main.length >= 2) drawElectricPath(output, main, request, glow, 1.35);
    const branches = Array.isArray(value.branches) ? value.branches : [];
    branches.forEach((entry) => {
      const branch = record(entry);
      const points = pointArray(branch?.points);
      const intensity = typeof branch?.intensity === "number" ? branch.intensity : 0.55;
      drawElectricPath(output, points, request, glow * 0.52, intensity * 0.72);
    });
    const head = main[main.length - 1];
    if (head !== undefined) {
      const pixel = pointToPixel(head, request.width, request.height);
      drawDisc(output, request.width, request.height, pixel[0], pixel[1], Math.max(7, glow * 1.2),
        [42, 128, 255, 255], 0.32);
      drawDisc(output, request.width, request.height, pixel[0], pixel[1], 2.6,
        [248, 255, 255, 255], 1);
    }
    return true;
  }

  if (toolName === "marker_stroke") {
    const background = inputFrames?.source_image ?? source;
    if (background !== undefined && background.length === output.length) output.set(background);
    const dabs = Array.isArray(value.dabs) ? value.dabs : [];
    const reveal = typeof value.revealProgress === "number"
      ? Math.max(0, Math.min(1, value.revealProgress)) : 1;
    const visibleCount = Math.min(dabs.length, Math.ceil(dabs.length * reveal));
    const bleed = typeof value.bleed === "number" ? Math.max(0, Math.min(1, value.bleed)) : 0.12;
    const roughness = typeof value.edgeRoughness === "number"
      ? Math.max(0, Math.min(0.5, value.edgeRoughness)) : 0.08;
    const color = hexColor(value.color, [255, 78, 118, 255]);
    const subjectMask = inputFrames?.subject_mask;
    const boundedMask = subjectMask?.length === request.width * request.height ? subjectMask : undefined;
    for (let index = 0; index < visibleCount; index += 1) {
      const dab = record(dabs[index]);
      if (dab !== undefined) drawMarkerDab(output, request, dab, bleed, roughness, color, boundedMask);
    }
    const tip = record(dabs[Math.max(0, visibleCount - 1)]);
    const tipCenter = finitePoint(tip?.center);
    const tipOpacity = typeof tip?.opacity === "number" ? tip.opacity : 0;
    if (boundedMask === undefined && visibleCount > 0 && tipCenter !== undefined && tipOpacity > 0) {
      const pixel = [tipCenter.x, tipCenter.y] as const;
      drawDisc(output, request.width, request.height, pixel[0], pixel[1], 4,
        color, 0.34);
    }
    return true;
  }

  return false;
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

function blendHistoricalFrame(
  history: Uint8Array,
  current: Uint8Array,
  output: Uint8ClampedArray,
  request: FrameRequest,
  shiftX: number,
  shiftY: number,
  opacity: number,
  mode: string
): void {
  const alpha = Math.max(0, Math.min(1, opacity));
  const border = [0, 0, 0];
  let borderCount = 0;
  for (let y = 0; y < request.height; y += 1) {
    for (let x = 0; x < request.width; x += 1) {
      if (x !== 0 && y !== 0 && x !== request.width - 1 && y !== request.height - 1) continue;
      const offset = (y * request.width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) border[channel]! += current[offset + channel]!;
      borderCount += 1;
    }
  }
  for (let channel = 0; channel < 3; channel += 1) border[channel]! /= Math.max(1, borderCount);
  for (let y = 0; y < request.height; y += 1) {
    const sourceY = Math.round(y - shiftY);
    if (sourceY < 0 || sourceY >= request.height) continue;
    for (let x = 0; x < request.width; x += 1) {
      const sourceX = Math.round(x - shiftX);
      if (sourceX < 0 || sourceX >= request.width) continue;
      const sourceOffset = (sourceY * request.width + sourceX) * 4;
      const targetOffset = (y * request.width + x) * 4;
      const sourceAlpha = history[sourceOffset + 3]! / 255;
      const motionDifference = Math.hypot(
        history[sourceOffset]! - current[sourceOffset]!,
        history[sourceOffset + 1]! - current[sourceOffset + 1]!,
        history[sourceOffset + 2]! - current[sourceOffset + 2]!
      ) / 441.7;
      const foregroundDifference = Math.hypot(
        history[sourceOffset]! - border[0]!,
        history[sourceOffset + 1]! - border[1]!,
        history[sourceOffset + 2]! - border[2]!
      ) / 441.7;
      const motionMask = smoothUnit(Math.max(0, Math.min(1, (motionDifference - 0.025) / 0.16)));
      const foregroundMask = smoothUnit(Math.max(0, Math.min(1, (foregroundDifference - 0.035) / 0.2)));
      const mix = alpha * sourceAlpha * motionMask * foregroundMask;
      if (mix <= 0.001) continue;
      for (let channel = 0; channel < 3; channel += 1) {
        const base = output[targetOffset + channel]!;
        const historical = history[sourceOffset + channel]!;
        const blended = mode === "add" ? Math.min(255, base + historical)
          : mode === "screen" ? blendChannel(base, historical, "screen") : historical;
        output[targetOffset + channel] = clampByte(base * (1 - mix) + blended * mix);
      }
      output[targetOffset + 3] = 255;
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

function rgbaInputFrame(
  inputFrames: Readonly<Record<string, Uint8Array>> | undefined,
  slot: string,
  fallback: Uint8Array | undefined,
  request: FrameRequest
): Uint8Array | undefined {
  const candidate = inputFrames?.[slot];
  const expectedLength = request.width * request.height * 4;
  if (candidate?.length === expectedLength) return candidate;
  return fallback?.length === expectedLength ? fallback : undefined;
}

function sampledChannel(
  source: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  channel: number
): number {
  const safeX = Math.max(0, Math.min(width - 1, x));
  const safeY = Math.max(0, Math.min(height - 1, y));
  const x0 = Math.floor(safeX);
  const y0 = Math.floor(safeY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = safeX - x0;
  const ty = safeY - y0;
  const top = source[(y0 * width + x0) * 4 + channel]! * (1 - tx)
    + source[(y0 * width + x1) * 4 + channel]! * tx;
  const bottom = source[(y1 * width + x0) * 4 + channel]! * (1 - tx)
    + source[(y1 * width + x1) * 4 + channel]! * tx;
  return top * (1 - ty) + bottom * ty;
}

function renderAffineSource(
  source: Uint8Array,
  output: Uint8ClampedArray,
  request: FrameRequest,
  scale: number,
  translateX: number,
  translateY: number,
  rotationDegrees = 0
): void {
  const safeScale = Math.max(0.3, Math.min(4, scale));
  const radians = rotationDegrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const centerX = (request.width - 1) / 2;
  const centerY = (request.height - 1) / 2;
  for (let y = 0; y < request.height; y += 1) {
    for (let x = 0; x < request.width; x += 1) {
      const dx = x - centerX - translateX;
      const dy = y - centerY - translateY;
      const sourceX = (cosine * dx + sine * dy) / safeScale + centerX;
      const sourceY = (-sine * dx + cosine * dy) / safeScale + centerY;
      const offset = (y * request.width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        output[offset + channel] = clampByte(sampledChannel(
          source, request.width, request.height, sourceX, sourceY, channel
        ));
      }
    }
  }
}

function copyRgbaFrame(source: Uint8Array, output: Uint8ClampedArray): void {
  output.set(source);
}

function smoothUnit(value: number): number {
  const progress = Math.max(0, Math.min(1, value));
  return progress * progress * (3 - 2 * progress);
}

function maskSample(
  mask: Uint8Array | undefined,
  source: Uint8Array,
  pixelIndex: number,
  pixelCount: number
): number {
  if (mask?.length === pixelCount) return mask[pixelIndex]! / 255;
  if (mask?.length === pixelCount * 4) {
    const offset = pixelIndex * 4;
    return (mask[offset]! * 0.2126 + mask[offset + 1]! * 0.7152 + mask[offset + 2]! * 0.0722) / 255;
  }
  const offset = pixelIndex * 4;
  return (source[offset]! * 0.2126 + source[offset + 1]! * 0.7152 + source[offset + 2]! * 0.0722) / 255;
}

function batch05CameraFrame(
  output: Uint8ClampedArray,
  value: Record<string, unknown>,
  request: FrameRequest,
  toolName: string,
  source: Uint8Array
): boolean {
  const position = record(value.position) ?? {};
  const rotation = record(value.rotationDegrees) ?? {};
  const positionX = typeof position.x === "number" ? position.x : 0;
  const positionY = typeof position.y === "number" ? position.y : 0;
  const positionZ = typeof position.z === "number" ? position.z : 0;
  const pitch = typeof rotation.x === "number" ? rotation.x : 0;
  const yaw = typeof rotation.y === "number" ? rotation.y : 0;
  const roll = typeof rotation.z === "number" ? rotation.z : 0;

  if (toolName === "dolly") {
    const strength = Math.min(0.46, Math.abs(positionZ) * 0.045);
    const scale = positionZ <= 0 ? 1 + strength : 1 / (1 + strength);
    renderAffineSource(source, output, request, scale, 0, -positionY * request.height * 0.035);
    return true;
  }

  if (toolName === "dolly_zoom") {
    const strength = Math.min(0.72, Math.abs(positionZ) * 0.045);
    if (strength <= Number.EPSILON) {
      copyRgbaFrame(source, output);
      return true;
    }
    const forward = positionZ < 0;
    const centerX = (request.width - 1) / 2;
    const centerY = (request.height - 1) / 2;
    const maximumRadius = Math.max(1, Math.hypot(centerX, centerY));
    const radialBias = (forward ? 1 : -1) * strength * 1.35;
    for (let y = 0; y < request.height; y += 1) {
      for (let x = 0; x < request.width; x += 1) {
        const dx = x - centerX;
        const dy = y - centerY;
        const radial = Math.min(1, Math.hypot(dx, dy) / maximumRadius);
        const protection = smoothUnit(Math.max(0, Math.min(1, (radial - 0.12) / 0.88)));
        const sourceRadius = radial * Math.exp(radialBias * protection);
        const radialScale = radial <= Number.EPSILON ? 1 : sourceRadius / radial;
        const sourceX = centerX + dx * radialScale;
        const sourceY = centerY + dy * radialScale;
        const offset = (y * request.width + x) * 4;
        for (let channel = 0; channel < 4; channel += 1) {
          output[offset + channel] = clampByte(sampledChannel(
            source, request.width, request.height, sourceX, sourceY, channel
          ));
        }
      }
    }
    return true;
  }

  if (toolName === "handheld") {
    const movement = Math.abs(positionX) + Math.abs(positionY) + Math.abs(positionZ)
      + Math.abs(pitch) + Math.abs(yaw) + Math.abs(roll);
    if (movement <= Number.EPSILON) {
      copyRgbaFrame(source, output);
      return true;
    }
    renderAffineSource(
      source,
      output,
      request,
      1.025 + Math.min(0.04, movement * 0.002),
      positionX * request.width * 0.13 + yaw * request.width * 0.0012,
      -positionY * request.height * 0.13 - pitch * request.height * 0.0015,
      roll
    );
    return true;
  }

  if (toolName === "pan_tilt") {
    const amount = Math.abs(pitch) + Math.abs(yaw);
    if (amount <= Number.EPSILON) {
      copyRgbaFrame(source, output);
      return true;
    }
    renderAffineSource(
      source,
      output,
      request,
      1.06 + Math.min(0.12, amount / 900),
      -yaw / 180 * request.width * 0.68,
      pitch / 90 * request.height * 0.42
    );
    return true;
  }

  if (toolName === "orbit") {
    const amount = Math.abs(positionX) + Math.abs(positionY) + Math.abs(positionZ)
      + Math.abs(pitch) + Math.abs(yaw);
    if (amount <= Number.EPSILON) {
      copyRgbaFrame(source, output);
      return true;
    }
    const centerX = (request.width - 1) / 2;
    const centerY = (request.height - 1) / 2;
    const orbitSine = Math.sin(yaw * Math.PI / 180);
    const elevation = Math.sin(-pitch * Math.PI / 180);
    for (let y = 0; y < request.height; y += 1) {
      for (let x = 0; x < request.width; x += 1) {
        const pixel = y * request.width + x;
        const offset = pixel * 4;
        const luminance = (source[offset]! * 0.2126 + source[offset + 1]! * 0.7152
          + source[offset + 2]! * 0.0722) / 255;
        const depthDisparity = luminance - 0.5;
        const normalizedX = (x - centerX) / Math.max(1, centerX);
        const curve = Math.sin(normalizedX * Math.PI / 2);
        const sourceX = x + orbitSine * request.width * (depthDisparity * 0.2 + curve * 0.055);
        const sourceY = y - elevation * request.height * depthDisparity * 0.16;
        for (let channel = 0; channel < 4; channel += 1) {
          output[offset + channel] = clampByte(sampledChannel(
            source, request.width, request.height, sourceX, sourceY, channel
          ));
        }
      }
    }
    return true;
  }

  return false;
}

function parallaxFrame(
  output: Uint8ClampedArray,
  value: Record<string, unknown>,
  request: FrameRequest,
  source: Uint8Array,
  inputFrames: Readonly<Record<string, Uint8Array>> | undefined
): void {
  const position = record(value.position) ?? {};
  const moveX = typeof position.x === "number" ? position.x : 0;
  const moveY = typeof position.y === "number" ? position.y : 0;
  const moveZ = typeof position.z === "number" ? position.z : 0;
  if (Math.abs(moveX) + Math.abs(moveY) + Math.abs(moveZ) <= Number.EPSILON) {
    copyRgbaFrame(source, output);
    return;
  }
  const depthMap = inputFrames?.depth_map;
  const pixelCount = request.width * request.height;
  const centerX = (request.width - 1) / 2;
  const centerY = (request.height - 1) / 2;
  for (let y = 0; y < request.height; y += 1) {
    for (let x = 0; x < request.width; x += 1) {
      const pixel = y * request.width + x;
      const depth = maskSample(depthMap, source, pixel, pixelCount);
      const disparity = 1 - depth;
      const scale = Math.max(0.55, 1 + moveZ * disparity * 0.018);
      const sourceX = centerX + (x - centerX) / scale + moveX * disparity * request.width * 0.025;
      const sourceY = centerY + (y - centerY) / scale - moveY * disparity * request.height * 0.025;
      const offset = pixel * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        output[offset + channel] = clampByte(sampledChannel(
          source, request.width, request.height, sourceX, sourceY, channel
        ));
      }
    }
  }
}

function pageTurnFrame(
  output: Uint8ClampedArray,
  value: Record<string, unknown>,
  request: FrameRequest,
  outgoing: Uint8Array,
  incoming: Uint8Array
): void {
  const progress = Math.max(0, Math.min(1, typeof value.progress === "number" ? value.progress : 0));
  if (progress <= 0) {
    copyRgbaFrame(outgoing, output);
    return;
  }
  if (progress >= 1) {
    copyRgbaFrame(incoming, output);
    return;
  }
  copyRgbaFrame(incoming, output);
  const sheet = record(value.sheet) ?? {};
  const rotation = typeof sheet.rotationYDegrees === "number" ? sheet.rotationYDegrees : -180 * progress;
  const turnsLeft = rotation < 0;
  const fold = request.width * (1 - progress);
  const curlWidth = Math.max(2, request.width * (0.035 + 0.16 * Math.sin(Math.PI * progress)));
  const shadowOpacity = typeof sheet.shadowOpacity === "number" ? sheet.shadowOpacity : 0.4;
  for (let y = 0; y < request.height; y += 1) {
    for (let x = 0; x < request.width; x += 1) {
      const canonicalX = turnsLeft ? x : request.width - 1 - x;
      const offset = (y * request.width + x) * 4;
      if (canonicalX < fold) {
        const sourceX = turnsLeft ? canonicalX : request.width - 1 - canonicalX;
        const sourceOffset = (y * request.width + Math.max(0, Math.min(request.width - 1, Math.round(sourceX)))) * 4;
        output.set(outgoing.subarray(sourceOffset, sourceOffset + 4), offset);
      } else if (canonicalX < fold + curlWidth) {
        const curl = (canonicalX - fold) / curlWidth;
        const sourceCanonicalX = fold + curl * (request.width - fold);
        const sourceX = turnsLeft ? sourceCanonicalX : request.width - 1 - sourceCanonicalX;
        const shade = 0.48 + 0.46 * Math.abs(Math.cos(curl * Math.PI));
        for (let channel = 0; channel < 3; channel += 1) {
          const page = sampledChannel(outgoing, request.width, request.height, sourceX, y, channel);
          const paper = 236 - channel * 7;
          output[offset + channel] = clampByte(page * shade * 0.78 + paper * (1 - shade) * 0.22);
        }
        output[offset + 3] = 255;
      }
      const distanceToFold = Math.abs(canonicalX - fold);
      if (distanceToFold < curlWidth * 1.35) {
        const shadow = (1 - distanceToFold / (curlWidth * 1.35)) * shadowOpacity * 0.62;
        for (let channel = 0; channel < 3; channel += 1) {
          output[offset + channel] = clampByte(output[offset + channel]! * (1 - shadow));
        }
      }
    }
  }
}

function portalFrame(
  output: Uint8ClampedArray,
  value: Record<string, unknown>,
  request: FrameRequest,
  outgoing: Uint8Array,
  incoming: Uint8Array
): void {
  const progress = Math.max(0, Math.min(1, typeof value.progress === "number" ? value.progress : 0));
  if (progress <= 0) {
    copyRgbaFrame(outgoing, output);
    return;
  }
  if (progress >= 1) {
    copyRgbaFrame(incoming, output);
    return;
  }
  const aperture = record(value.aperture) ?? {};
  const radiusValue = typeof aperture.radius === "number" ? aperture.radius : progress;
  const featherValue = typeof aperture.featherWidth === "number" ? aperture.featherWidth : 0.06;
  const rotation = typeof aperture.rotationDegrees === "number" ? aperture.rotationDegrees : 0;
  const glow = typeof aperture.glowStrength === "number" ? aperture.glowStrength : 0.5;
  const centerX = (request.width - 1) / 2;
  const centerY = (request.height - 1) / 2;
  const unitRadius = Math.hypot(centerX, centerY);
  const radius = Math.max(1, radiusValue * unitRadius);
  const feather = Math.max(1, featherValue * unitRadius);
  const glowWidth = Math.max(3, Math.min(28, 5 + glow * 18));
  for (let y = 0; y < request.height; y += 1) {
    for (let x = 0; x < request.width; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      const distance = Math.hypot(dx, dy);
      const edgeMix = 1 - smoothUnit((distance - (radius - feather)) / feather);
      const angle = Math.atan2(dy, dx) - rotation * Math.PI / 180
        * Math.max(0, 1 - distance / radius) * 0.28;
      const sourceX = centerX + Math.cos(angle) * distance;
      const sourceY = centerY + Math.sin(angle) * distance;
      const offset = (y * request.width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const from = outgoing[offset + channel]!;
        const to = sampledChannel(incoming, request.width, request.height, sourceX, sourceY, channel);
        output[offset + channel] = clampByte(from * (1 - edgeMix) + to * edgeMix);
      }
      output[offset + 3] = 255;
      const edgeDistance = Math.abs(distance - radius);
      if (edgeDistance < glowWidth) {
        const light = (1 - edgeDistance / glowWidth) * glow;
        output[offset] = clampByte(output[offset]! * (1 - light * 0.45) + 76 * light * 0.45);
        output[offset + 1] = clampByte(output[offset + 1]! * (1 - light * 0.58) + 224 * light * 0.58);
        output[offset + 2] = clampByte(output[offset + 2]! * (1 - light * 0.72) + 255 * light * 0.72);
      }
    }
  }
  for (let spark = 0; spark < 28; spark += 1) {
    const angle = spark * 2.399963 + request.time * (0.3 + spark % 4 * 0.08);
    const spread = radius + Math.sin(spark * 4.17 + request.time * 5) * glowWidth * 1.4;
    drawDisc(output, request.width, request.height,
      centerX + Math.cos(angle) * spread, centerY + Math.sin(angle) * spread,
      1.2 + spark % 3, spark % 2 === 0 ? [104, 236, 255, 255] : [196, 112, 255, 255],
      0.18 + glow * 0.28);
  }
}

function zoomTunnelFrame(
  output: Uint8ClampedArray,
  value: Record<string, unknown>,
  request: FrameRequest,
  outgoing: Uint8Array,
  incoming: Uint8Array
): void {
  const progress = Math.max(0, Math.min(1, typeof value.progress === "number" ? value.progress : 0));
  if (progress <= 0) {
    copyRgbaFrame(outgoing, output);
    return;
  }
  if (progress >= 1) {
    copyRgbaFrame(incoming, output);
    return;
  }
  const outgoingState = record(value.outgoing) ?? {};
  const incomingState = record(value.incoming) ?? {};
  const outgoingScale = typeof outgoingState.scale === "number" ? outgoingState.scale : 1 + progress * 2;
  const incomingScale = typeof incomingState.scale === "number" ? incomingState.scale : 0.25 + progress * 0.75;
  const outgoingOpacity = typeof outgoingState.opacity === "number" ? outgoingState.opacity : 1 - progress;
  const incomingOpacity = typeof incomingState.opacity === "number" ? incomingState.opacity : progress;
  const twist = typeof value.twistDegrees === "number" ? value.twistDegrees : 0;
  const motionBlur = typeof value.motionBlur === "number" ? value.motionBlur : 0;
  const centerX = (request.width - 1) / 2;
  const centerY = (request.height - 1) / 2;
  const outgoingRadians = -twist * 0.35 * Math.PI / 180;
  const incomingRadians = twist * 0.65 * Math.PI / 180;
  const outgoingCosine = Math.cos(outgoingRadians);
  const outgoingSine = Math.sin(outgoingRadians);
  const incomingCosine = Math.cos(incomingRadians);
  const incomingSine = Math.sin(incomingRadians);
  const totalOpacity = Math.max(0.001, outgoingOpacity + incomingOpacity);
  const maximumRadius = Math.max(1, Math.hypot(centerX, centerY));
  for (let y = 0; y < request.height; y += 1) {
    for (let x = 0; x < request.width; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      const outgoingX = centerX + (outgoingCosine * dx + outgoingSine * dy) / outgoingScale;
      const outgoingY = centerY + (-outgoingSine * dx + outgoingCosine * dy) / outgoingScale;
      const incomingX = centerX + (incomingCosine * dx + incomingSine * dy) / incomingScale;
      const incomingY = centerY + (-incomingSine * dx + incomingCosine * dy) / incomingScale;
      const offset = (y * request.width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        output[offset + channel] = clampByte((
          sampledChannel(outgoing, request.width, request.height, outgoingX, outgoingY, channel) * outgoingOpacity
          + sampledChannel(incoming, request.width, request.height, incomingX, incomingY, channel) * incomingOpacity
        ) / totalOpacity);
      }
      const radial = Math.hypot(dx, dy) / maximumRadius;
      const streak = Math.max(0, Math.cos(Math.atan2(dy, dx) * 14 + request.time * 6)) ** 18
        * radial * radial * motionBlur * 0.42;
      output[offset] = clampByte(output[offset]! + 72 * streak);
      output[offset + 1] = clampByte(output[offset + 1]! + 168 * streak);
      output[offset + 2] = clampByte(output[offset + 2]! + 224 * streak);
      output[offset + 3] = 255;
    }
  }
}

function objectMatchFrame(
  output: Uint8ClampedArray,
  value: Record<string, unknown>,
  request: FrameRequest,
  outgoing: Uint8Array,
  incoming: Uint8Array,
  inputFrames: Readonly<Record<string, Uint8Array>> | undefined
): void {
  const blend = Math.max(0, Math.min(1, typeof value.blend === "number" ? value.blend : 0));
  if (blend <= 0) {
    copyRgbaFrame(outgoing, output);
    return;
  }
  if (blend >= 1) {
    copyRgbaFrame(incoming, output);
    return;
  }
  const outgoingState = record(value.outgoing) ?? {};
  const incomingState = record(value.incoming) ?? {};
  const outgoingScale = typeof outgoingState.scaleCorrection === "number" ? outgoingState.scaleCorrection : 1;
  const incomingScale = typeof incomingState.scaleCorrection === "number" ? incomingState.scaleCorrection : 1;
  const outgoingRotation = (typeof outgoingState.rotationCorrectionDegrees === "number"
    ? outgoingState.rotationCorrectionDegrees : 0) * Math.PI / 180;
  const incomingRotation = (typeof incomingState.rotationCorrectionDegrees === "number"
    ? incomingState.rotationCorrectionDegrees : 0) * Math.PI / 180;
  const outgoingCosine = Math.cos(outgoingRotation);
  const outgoingSine = Math.sin(outgoingRotation);
  const incomingCosine = Math.cos(incomingRotation);
  const incomingSine = Math.sin(incomingRotation);
  const centerX = (request.width - 1) / 2;
  const centerY = (request.height - 1) / 2;
  const pixelCount = request.width * request.height;
  const fromMask = inputFrames?.from_match_mask;
  const toMask = inputFrames?.to_match_mask;
  const activeAlignment = Math.sin(Math.PI * blend);
  for (let y = 0; y < request.height; y += 1) {
    for (let x = 0; x < request.width; x += 1) {
      const pixel = y * request.width + x;
      const dx = x - centerX;
      const dy = y - centerY;
      const outgoingX = centerX + (outgoingCosine * dx + outgoingSine * dy) / outgoingScale;
      const outgoingY = centerY + (-outgoingSine * dx + outgoingCosine * dy) / outgoingScale;
      const incomingX = centerX + (incomingCosine * dx + incomingSine * dy) / incomingScale;
      const incomingY = centerY + (-incomingSine * dx + incomingCosine * dy) / incomingScale;
      const maskDelta = maskSample(toMask, incoming, pixel, pixelCount)
        - maskSample(fromMask, outgoing, pixel, pixelCount);
      const localBlend = Math.max(0, Math.min(1, blend + maskDelta * activeAlignment * 0.22));
      const offset = pixel * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const from = sampledChannel(outgoing, request.width, request.height, outgoingX, outgoingY, channel);
        const to = sampledChannel(incoming, request.width, request.height, incomingX, incomingY, channel);
        output[offset + channel] = clampByte(from * (1 - localBlend) + to * localBlend);
      }
      output[offset + 3] = 255;
    }
  }
}

function batch05Frame(
  output: Uint8ClampedArray,
  value: Record<string, unknown>,
  request: FrameRequest,
  toolName: string,
  fallbackSource: Uint8Array | undefined,
  inputFrames: Readonly<Record<string, Uint8Array>> | undefined
): boolean {
  if (!["dolly", "dolly_zoom", "handheld", "object_match_cut", "orbit", "page_turn",
    "pan_tilt", "parallax_layers", "portal", "zoom_tunnel"].includes(toolName)) return false;
  const sourceSlot = toolName === "object_match_cut" || toolName === "page_turn"
    || toolName === "portal" || toolName === "zoom_tunnel" ? "from_video" : "source_video";
  const source = rgbaInputFrame(inputFrames, sourceSlot, fallbackSource, request);
  if (source === undefined) return false;
  if (["dolly", "dolly_zoom", "handheld", "orbit", "pan_tilt"].includes(toolName)) {
    return batch05CameraFrame(output, value, request, toolName, source);
  }
  if (toolName === "parallax_layers") {
    parallaxFrame(output, value, request, source, inputFrames);
    return true;
  }
  const incoming = rgbaInputFrame(inputFrames, "to_video", undefined, request);
  if (incoming === undefined) return false;
  if (toolName === "page_turn") pageTurnFrame(output, value, request, source, incoming);
  else if (toolName === "portal") portalFrame(output, value, request, source, incoming);
  else if (toolName === "zoom_tunnel") zoomTunnelFrame(output, value, request, source, incoming);
  else objectMatchFrame(output, value, request, source, incoming, inputFrames);
  return true;
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
  if (POLISHED_STRUCTURED_TOOLS.has(toolName)) return;
  const phase = request.time * Math.PI * 2;
  if (source !== undefined && toolName === "background_remove_compose") {
    for (let offset = 0; offset < output.length; offset += 4) {
      const luminance = source[offset]! * 0.2126 + source[offset + 1]! * 0.7152 + source[offset + 2]! * 0.0722;
      const foreground = Math.max(0, Math.min(1, Math.abs(luminance - 128) / 72));
      output[offset] = clampByte(source[offset]! * foreground + 24 * (1 - foreground));
      output[offset + 1] = clampByte(source[offset + 1]! * foreground + 46 * (1 - foreground));
      output[offset + 2] = clampByte(source[offset + 2]! * foreground + 58 * (1 - foreground));
    }
  } else if (source !== undefined && toolName === "image_depth_parallax") {
    for (let y = 0; y < request.height; y += 1) {
      for (let x = 0; x < request.width; x += 1) {
        const offset = (y * request.width + x) * 4;
        const luminance = (source[offset]! * 0.21 + source[offset + 1]! * 0.72 + source[offset + 2]! * 0.07) / 255;
        const layerFactor = 0.22 + Math.pow(luminance, 1.35) * 0.78;
        const shiftX = Math.round(Math.sin(phase) * 16 * layerFactor);
        const shiftY = Math.round(Math.cos(phase * 0.83) * 8 * layerFactor);
        const sx = Math.max(0, Math.min(request.width - 1, x - shiftX));
        const sy = Math.max(0, Math.min(request.height - 1, y - shiftY));
        const from = (sy * request.width + sx) * 4;
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
}

export function composeEffectToolFrame(
  result: EffectRenderResult | undefined,
  request: FrameRequest,
  toolName: string,
  source: Uint8Array | undefined,
  inputFrames?: Readonly<Record<string, Uint8Array>>
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
    const polished = polishedStructuredFrame(output, value, request, toolName, source, inputFrames);
    if (!polished) {
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
  }
  adapterPreview(output, source, request, toolName);
  return new Uint8Array(output.buffer, output.byteOffset, output.byteLength);
}
