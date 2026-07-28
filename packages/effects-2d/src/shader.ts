import type { RenderQuality } from "@codemotion/core";
import type {
  EffectBlueprint,
  ParameterSpec,
  P0SourceId
} from "./types.js";

export interface CatalogWebGLPass {
  readonly id: string;
  readonly fragmentSource: string;
  readonly uniforms: Readonly<Record<string, number | readonly [number, number]>>;
  readonly catalogContribution: false;
}

const COMMON = `#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_progress;
uniform float u_seed;
uniform float u_quality;
uniform vec2 u_texel;
uniform float u_p0;
uniform float u_p1;
uniform float u_p2;
uniform float u_p3;
uniform float u_p4;
uniform float u_p5;
in vec2 v_uv;
out vec4 outColor;
float hash(vec2 p) {
  vec2 stableSeed = vec2(mod(u_seed, 4093.0), mod(u_seed * 0.6180339, 4091.0));
  return fract(sin(dot(p + stableSeed, vec2(127.1, 311.7))) * 43758.5453);
}
float band(float value, float center, float width) {
  return 1.0 - smoothstep(width, width * 1.8, abs(value - center));
}
vec4 sampleAt(vec2 uv) {
  return texture(u_input, clamp(uv, vec2(0.0), vec2(1.0)));
}
void main() {
  vec2 uv = v_uv;
  float p = clamp(u_progress, 0.0, 1.0);
  vec4 c = sampleAt(uv);
`;

const END = `
  float gradeSteps = mix(96.0, 255.0, u_quality);
  c.rgb = floor(c.rgb * gradeSteps + 0.5) / gradeSteps;
  c = clamp(c, 0.0, 1.0);
  c.rgb = min(c.rgb, vec3(c.a));
  if (c.a <= 0.00001) c.rgb = vec3(0.0);
  outColor = c;
}`;

const BODIES: Readonly<Record<P0SourceId, string>> = Object.freeze({
  M01: `
  float durationProgress = clamp(p / (0.25 + u_p2 * 0.75), 0.0, 1.0);
  float easedProgress = mix(durationProgress, smoothstep(0.0, 1.0, durationProgress), u_p3);
  c.a *= mix(u_p0, u_p1, easedProgress);`,
  M02: `
  float angle = u_p0 * 6.2831853;
  vec2 custom = (vec2(u_p3, u_p4) - 0.5) * 2.0;
  float distance = u_p1 * (1.0 - p);
  vec2 shift = (vec2(cos(angle), sin(angle)) + custom * 0.35) * distance;
  shift += normalize(shift + 0.0001) * sin(p * 3.14159) * u_p2 * 0.12;
  c = sampleAt(uv - shift);`,
  M03: `
  vec2 pivot = vec2(u_p3, u_p4);
  float scale = max(0.03, mix(u_p0 * 2.0, u_p1 * 2.0, p)
    + sin(p * 9.4248) * u_p2 * (1.0 - p) * 0.35);
  c = sampleAt(pivot + (uv - pivot) / scale);`,
  M04: `
  vec2 pivot = vec2(u_p1, u_p2);
  float angle = ((u_p0 - 0.5) * 12.566 + (u_p4 - 0.5) * 25.132) * (1.0 - p);
  mat2 rotation = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
  vec2 rotated = pivot + rotation * (uv - pivot);
  c = mix(sampleAt(rotated), sampleAt(rotated + vec2(u_p3 * 0.03, 0.0)), u_p3);`,
  M05: `
  float bounces = 1.0 + floor(u_p2 * 11.0);
  float gravity = 0.25 + u_p1 * 3.75;
  float jump = abs(sin(p * 3.14159 * bounces * gravity)) * u_p0 * 0.45
    * pow(1.0 - p, 1.0 + u_p3 * 2.0);
  c = sampleAt(uv + vec2(0.0, jump));`,
  M06: `
  float period = 0.08 + u_p1 * 0.92;
  float displacement = u_p0 * 0.25 * sin(p * 6.283 / period) * exp(-u_p2 * 6.0 * p);
  vec2 axis = u_p3 < 0.34 ? vec2(1.0, 0.0) : u_p3 < 0.67 ? vec2(0.0, 1.0) : normalize(uv - 0.5 + 0.001);
  c = sampleAt(uv - axis * displacement);`,
  M07: `
  float amount = sin(p * (1.0 + u_p2 * 10.0) * 6.283 + (u_p3 - 0.5) * 6.283)
    * u_p1 * 0.18;
  vec2 axis = u_p0 < 0.34 ? vec2(1.0, 0.0) : u_p0 < 0.67 ? vec2(0.0, 1.0) : vec2(1.0);
  c = sampleAt(uv - axis * amount);`,
  M08: `
  float stepValue = floor(p * (1.0 + u_p1 * 60.0) * 10.0);
  vec2 jitter = vec2(hash(vec2(stepValue, u_p3 * 997.0)), hash(vec2(u_p3 * 997.0, stepValue))) * 2.0 - 1.0;
  jitter *= u_p0 * 1.5 * exp(-u_p2 * 4.0 * p);
  jitter += vec2(u_p1 - 0.2, u_p3) * u_p0 * 0.18;
  c = sampleAt(uv - jitter);`,
  T01: `
  vec2 cell = floor(uv * vec2(12.0, 5.0));
  float index = cell.y * 12.0 + cell.x;
  if (u_p2 > 0.5) index = floor(index / 5.0) * 5.0;
  float reveal = clamp(p * (0.5 + u_p0 * 2.5), 0.0, 1.0);
  float visible = step(index / 60.0, reveal);
  float cursor = u_p1 * step(1.0 - u_p3, fract(uv.x * 12.0)) * (1.0 - step(0.06, abs(index / 60.0 - reveal)));
  c = mix(vec4(0.0), c, visible);
  c = mix(c, vec4(1.0), cursor);`,
  T02: `
  vec2 cell = floor(uv * vec2(12.0, 5.0));
  float index = cell.y * 12.0 + cell.x;
  float groupSize = mix(1.0, 12.0, u_p3);
  index = floor(index / groupSize) * groupSize;
  float local = clamp(p * 1.5 - index * u_p0 * 0.025, 0.0, 1.0);
  vec2 axis = u_p1 < 0.5 ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  c = sampleAt(uv - axis * (u_p2 - 0.5) * 0.5 * (1.0 - local));
  c.a *= local;`,
  T03: `
  vec2 cell = floor(uv * vec2(12.0, 5.0));
  float phase = mix(cell.x + cell.y, atan(uv.y - 0.5, uv.x - 0.5) * 3.0, u_p0);
  float pulse = 1.0 + sin(phase + p * 6.283 * (1.0 + u_p1 * 3.0))
    * u_p3 * (0.12 + u_p2 * 0.28);
  vec2 center = (cell + 0.5) / vec2(12.0, 5.0);
  c = sampleAt(center + (uv - center) / max(0.1, pulse));`,
  T04: `
  float pathY = 0.5 + sin(uv.x * 6.283 * (1.0 + u_p0 * 2.0) + u_p0 * 6.283) * (0.12 + u_p0 * 0.16);
  float pathProgress = mix(uv.x, uv.x * 0.75 + uv.y * 0.25, u_p2);
  float visible = (1.0 - smoothstep(u_p1 - u_p3 * 0.25, u_p1 + u_p3 * 0.25, pathProgress))
    * band(uv.y, pathY, 0.025 + u_p3 * 0.1);
  c.a *= visible;`,
  T05: `
  vec2 cell = floor(uv * vec2(12.0, 5.0));
  float wobble = sin(cell.x * (1.0 + u_p0 * 3.0) + cell.y + u_p3 * 6.283 * (1.0 + u_p1 * 2.0))
    * (0.01 + u_p2 * 0.045) * sin(u_p3 * 3.14159);
  c = sampleAt(uv + vec2(wobble, -wobble));
  c.rb += vec2(u_p1 * u_p3, u_p0 * (1.0 - u_p3)) * 0.18;`,
  T06: `
  vec2 cell = floor(uv * vec2(12.0, 5.0));
  float threshold = mix(uv.x, hash(cell + u_p0 * 31.0), u_p2);
  float decode = clamp(u_p3 * (0.5 + u_p1 * 2.5), 0.0, 1.0);
  float scrambled = step(decode, threshold);
  vec3 noiseColor = vec3(hash(cell + floor(p * (2.0 + u_p1 * 80.0))), 0.7 + u_p0 * 0.3, 1.0 - u_p0 * 0.4);
  c.rgb = mix(c.rgb, noiseColor, scrambled);
  c.a *= 1.0 - scrambled * 0.2;`,
  T07: `
  vec2 cell = floor(uv * vec2(12.0, 5.0));
  float index = mix(cell.y * 12.0 + cell.x, floor((cell.y * 12.0 + cell.x) / 5.0) * 5.0, u_p3);
  float angle = hash(vec2(index, u_seed)) * 6.283 + (u_p1 - 0.5) * 6.283 * p;
  vec2 shift = vec2(cos(angle), sin(angle)) * u_p0 * p * p * 2.5;
  shift *= mix(1.0, 1.35, u_p3);
  c = sampleAt(uv - shift);
  c.a *= 1.0 - u_p2 * p * 0.6;`,
  V01: `
  vec2 delta = uv - 0.5;
  float angle = fract(atan(delta.y, delta.x) / 6.283 + 1.0 + (u_p2 - 0.5) * 2.0);
  float radius = length(delta);
  float coverage = band(radius, 0.31, 0.006 + u_p3 * 0.12)
    * step(u_p0, angle) * step(angle, u_p1);
  c = mix(c, vec4(0.2, 0.8, 1.0, 1.0), coverage);`,
  V02: `
  vec2 delta = uv - 0.5;
  delta.x *= mix(0.65 + u_p0 * 0.7, 1.0, u_p2);
  float diamond = (abs(delta.x) + abs(delta.y)) * (0.8 + u_p0 * 0.4);
  float circle = length(delta) * (0.8 + u_p1 * 0.4);
  float coverage = band(mix(diamond, circle, u_p3), 0.34, 0.035);
  c = mix(c, vec4(0.15, 0.75, 1.0, 1.0), coverage);`,
  V03: `
  float count = 2.0 + u_p0 * 62.0;
  float angle = (u_p3 - 0.5) * 6.283;
  float coordinate = dot(uv + vec2(u_p1, u_p2) - 0.5, vec2(cos(angle), sin(angle)));
  float stripe = band(fract(coordinate * count / (0.2 + u_p4 * 1.8)), 0.5, 0.06 + u_p4 * 0.08);
  c = mix(c, vec4(0.2, 0.85, 1.0, 1.0), stripe);`,
  V04: `
  vec2 delta = uv - 0.5;
  float count = 2.0 + u_p0 * 126.0;
  float spoke = min(fract((atan(delta.y, delta.x) / 6.283 + u_p2) * count), 1.0 - fract((atan(delta.y, delta.x) / 6.283 + u_p2) * count));
  float coverage = step(length(delta), u_p1 * 0.7) * (1.0 - smoothstep(0.002, 0.01 + u_p3 * 0.18, spoke));
  c = mix(c, vec4(0.2, 0.8, 1.0, 1.0), coverage);`,
  D01: `
  float pathY = 0.62 - sin(uv.x * 6.283 * (1.5 + u_p0 * 2.0)) * (0.15 + u_p0 * 0.2);
  float reveal = step(uv.x + sin(uv.x * 19.0) * u_p2 * 0.04, u_p3);
  float stroke = band(uv.y, pathY, 0.01 + u_p1 * 0.08) * reveal;
  c = mix(c, vec4(0.96, 0.88, 0.7, 1.0), stroke);`,
  D02: `
  float size = 0.01 + u_p1 * 0.25;
  float noise = hash(floor(uv / size) + u_p0 * 31.0);
  float coverage = 1.0 - smoothstep(u_p3 - size, u_p3 + size, uv.x + (noise - 0.5) * u_p2);
  vec3 brushColor = vec3(0.78 + u_p0 * 0.2, 0.65 + u_p0 * 0.18, 0.42 + u_p0 * 0.25);
  c = mix(c, vec4(brushColor, 1.0), coverage);`,
  D03: `
  float noise = (hash(floor(uv * (10.0 + u_p0 * 60.0))) - 0.5) * u_p1 * 0.3;
  float radius = u_p3 * (0.25 + u_p0 * 0.75);
  float coverage = 1.0 - smoothstep(radius - (0.02 + u_p2 * 0.15), radius + noise, length(uv - 0.5));
  c = mix(c, vec4(0.12, 0.08, 0.16, 1.0), coverage * (0.5 + u_p2 * 0.5));`,
  D04: `
  float pathY = 0.25 + uv.x * 0.5;
  float grain = hash(floor(uv * (40.0 + u_p0 * 100.0)));
  float scatter = (hash(floor(uv * 53.0)) - 0.5) * u_p1;
  float coverage = band(uv.y, pathY, 0.025 + u_p1 * 0.08) * step(uv.x + scatter, u_p3) * step(u_p0 * 0.45, grain) * u_p2;
  vec3 chalkColor = vec3(0.82 + u_p0 * 0.16, 0.76 + u_p0 * 0.18, 0.58 + u_p0 * 0.2);
  c = mix(c, vec4(chalkColor, 1.0), coverage);`,
  L01: `
  vec3 neon = vec3(fract(u_p0 * 3.1), fract(u_p0 * 5.3 + 0.3), fract(u_p0 * 7.7 + 0.6));
  vec4 neighbor = sampleAt(uv + u_texel * (1.0 + u_p1 * 18.0));
  float edge = abs(c.a - neighbor.a) + length(c.rgb - neighbor.rgb) * 0.5;
  float flicker = 1.0 - u_p3 * hash(vec2(floor(p * 30.0), u_seed));
  c.rgb += neon * edge * u_p2 * 4.0 * flicker;`,
  L02: `
  float angle = (u_p0 - 0.5) * 6.283;
  float coordinate = dot(uv, vec2(cos(angle), sin(angle)));
  float center = fract(p * (u_p3 * 4.0 - 2.0));
  float distance = abs(fract(coordinate - center + 0.5) - 0.5);
  float beam = 1.0 - smoothstep(u_p1 * (1.0 - u_p2), u_p1 * (1.0 + u_p2) + 0.002, distance);
  c.rgb += vec3(0.3, 0.75, 1.0) * beam;`,
  L03: `
  vec2 center = vec2(u_p0, u_p1);
  float distance = length(uv - center);
  float ghosts = 1.0 + u_p2 * 15.0;
  float flare = 1.0 - smoothstep(0.0, 0.24, distance);
  flare += max(0.0, sin(distance * ghosts * 35.0)) * 0.16;
  flare += exp(-abs(uv.y - center.y) * (20.0 / (0.05 + u_p3))) * u_p3;
  c.rgb += vec3(1.0, 0.72 - u_p4 * 0.35, 0.3 + u_p4 * 0.7) * flare;`,
  L04: `
  vec2 center = vec2(u_p0, u_p1);
  float distance = length(uv - center);
  float radius = u_p2 * (0.65 + p * 0.7);
  float ring = exp(-abs(distance - radius) * (6.0 / (0.01 + u_p3)));
  ring *= 0.65 + 0.35 * sin(distance * (1.0 + u_p4 * 31.0) * 60.0);
  c.rgb += vec3(0.55, 0.3, 1.0) * ring;`,
  P01: `
  vec4 sum = vec4(0.0);
  float weightSum = 0.0;
  float radius = u_p0 * 64.0 * (1.0 + u_p1 * 7.0);
  for (int i = 0; i < 9; i++) {
    float t = float(i) / 8.0 - 0.5;
    vec2 direction = vec2(cos(float(i) * 0.698), sin(float(i) * 0.698));
    vec2 sampleUv = uv + direction * u_texel * radius * abs(t);
    sampleUv = mix(clamp(sampleUv, 0.0, 1.0), fract(sampleUv + u_p2 * 0.5), u_p2);
    vec4 value = texture(u_input, sampleUv);
    float weight = exp(-t * t * 4.0) * mix(1.0, value.a, u_p3);
    sum += value * weight;
    weightSum += weight;
  }
  c = weightSum > 0.0 ? sum / weightSum : vec4(0.0);
  c.rgb *= mix(0.72 + c.a * 0.28, 1.0, u_p3);`,
  P02: `
  vec4 sum = vec4(0.0);
  float count = 2.0 + floor(u_p2 * 7.0);
  float angle = (u_p0 - 0.5) * 6.283;
  vec2 direction = vec2(cos(angle), sin(angle)) * u_p1 * 0.16;
  for (int i = 0; i < 9; i++) {
    float enabled = step(float(i), count);
    float t = float(i) / 8.0 - 0.5;
    vec2 sampleUv = uv + direction * t;
    sampleUv = mix(clamp(sampleUv, 0.0, 1.0), fract(sampleUv + u_p3 * 0.5), u_p3);
    sum += texture(u_input, sampleUv) * enabled;
  }
  c = sum / (count + 1.0);`,
  P03: `
  vec4 sum = vec4(0.0);
  float count = 2.0 + floor(u_p4 * 7.0);
  for (int i = 0; i < 9; i++) {
    float enabled = step(float(i), count);
    float t = (float(i) / 8.0 - 0.5) * u_p2;
    vec2 delta = uv - vec2(u_p0, u_p1);
    float angle = t * u_p3;
    vec2 zoomed = vec2(u_p0, u_p1) + delta * (1.0 + t * (1.0 - u_p3));
    vec2 spun = vec2(u_p0, u_p1) + mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * delta;
    sum += sampleAt(mix(zoomed, spun, u_p3)) * enabled;
  }
  c = sum / (count + 1.0);`,
  P04: `
  vec4 sum = vec4(0.0);
  float count = 2.0 + floor(u_p1 * 7.0);
  vec2 velocity = (vec2(u_p2, u_p3) - 0.5) * 0.8 * u_p0;
  for (int i = 0; i < 9; i++) {
    float enabled = step(float(i), count);
    float normalized = float(i) / 8.0;
    float t = mix(normalized, normalized - 0.5, u_p4);
    sum += sampleAt(uv + velocity * t) * enabled;
  }
  c = sum / (count + 1.0);`,
  C01: `
  float angle = (u_p2 - 0.5) * 6.283 + u_p0 * 6.283;
  float coordinate = dot(uv - 0.5, vec2(cos(angle), sin(angle))) + 0.5;
  float wipe = 1.0 - smoothstep(u_p3 - u_p1 * 0.25, u_p3 + u_p1 * 0.25, coordinate);
  c.rgb *= 0.65 + wipe * 0.35;
  c.a *= wipe;`,
  C02: `
  float angle = fract(atan(uv.y - u_p1, uv.x - u_p0) / 6.283 - (u_p2 - 0.5) + 1.0);
  angle = mix(1.0 - angle, angle, u_p3);
  float wipe = step(angle, u_p4);
  c.rgb *= 0.65 + wipe * 0.35;
  c.a *= wipe;`,
  C03: `
  float frequency = 8.0 + (1.0 - u_p1) * 48.0;
  float noise = (hash(floor(uv * frequency)) - 0.5) * u_p0;
  float softness = 0.01 + (1.0 - u_p1) * 0.12;
  float wipe = 1.0 - smoothstep(u_p3 - softness, u_p3 + softness, uv.x + noise);
  float glow = (1.0 - abs(wipe - 0.5) * 2.0) * u_p2;
  c.rgb += vec3(0.2, 0.55, 1.0) * glow;
  c.a *= wipe;`,
  C04: `
  float grid = 2.0 + u_p0 * 126.0;
  vec2 cell = floor(uv * grid);
  float randomOrder = hash(cell + vec2(u_p2 * 997.0, u_p2 * 541.0));
  float linearOrder = cell.x / grid;
  float radialOrder = length(uv - 0.5) * 1.414;
  float threshold = u_p1 < 0.34 ? randomOrder : u_p1 < 0.67 ? linearOrder : radialOrder;
  float dissolve = step(threshold, u_p3);
  float cellEdge = min(fract(uv.x * grid), fract(uv.y * grid));
  c.rgb *= 0.53 + dissolve * 0.32 + step(cellEdge, 0.08) * u_p0 * 0.05
    + u_p0 * 0.04 + u_p2 * 0.06;
  c.a *= dissolve * (0.7 + u_p0 * 0.3) * (0.85 + u_p2 * 0.15);`,
  H01: `
  float coverage = c.a + (u_p0 - 0.5) * 0.2;
  coverage = mix(coverage, 1.0 - coverage, u_p3);
  float reveal = smoothstep(u_p1 - u_p2 * 0.25, u_p1 + u_p2 * 0.25, coverage);
  c.a *= reveal;`,
  H02: `
  vec2 shifted = uv + vec2(u_p0 - 0.5, 0.5 - u_p0) * 0.1;
  vec4 matte = sampleAt(shifted);
  float coverage = mix(matte.a, dot(matte.rgb, vec3(0.2126, 0.7152, 0.0722)), u_p1);
  coverage = mix(coverage, 1.0 - coverage, u_p2);
  c.a *= coverage * u_p3;`,
  H03: `
  vec4 top = sampleAt(uv + vec2((u_p0 - 0.5) * 0.02));
  top.rgb *= mix(0.5 + top.a * 0.5, 1.0, u_p2);
  vec3 multiplied = c.rgb * top.rgb;
  vec3 screened = c.rgb + top.rgb - c.rgb * top.rgb;
  vec3 blended = mix(multiplied, screened, u_p0);
  c.rgb = mix(c.rgb, blended, u_p1 * u_p3);
  c.a = mix(c.a, top.a + c.a * (1.0 - top.a), u_p1 * u_p3);`,
  H04: `
  vec4 mapValue = sampleAt(uv + vec2((u_p0 - 0.5) * 0.08));
  float channel = u_p3 < 0.2 ? mapValue.r : u_p3 < 0.4 ? mapValue.g
    : u_p3 < 0.6 ? mapValue.b : u_p3 < 0.8 ? mapValue.a : dot(mapValue.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec2 displacement = vec2((u_p1 - 0.5) * 2.0, (u_p2 - 0.5) * 2.0) * (channel - 0.5);
  c = sampleAt(uv + displacement);`
});

function encodeValue(spec: ParameterSpec, value: unknown): readonly number[] {
  if (spec.kind === "number") {
    const numeric = typeof value === "number" && Number.isFinite(value) ? value : spec.default;
    return [(numeric - spec.min) / Math.max(Number.EPSILON, spec.max - spec.min)];
  }
  if (spec.kind === "enum") {
    const option = typeof value === "string" ? spec.options.indexOf(value) : -1;
    return [Math.max(0, option) / Math.max(1, spec.options.length - 1)];
  }
  if (spec.kind === "boolean") return [value === true ? 1 : 0];
  if (spec.kind === "text") return [hashStringForShader(typeof value === "string" ? value : spec.default)];
  const vector = Array.isArray(value) && value.length === 2 ? value : spec.default;
  return [0, 1].map((index) => {
    const numeric = typeof vector[index] === "number" ? vector[index] : spec.default[index]!;
    return (numeric - spec.min) / Math.max(Number.EPSILON, spec.max - spec.min);
  });
}

function hashStringForShader(value: string): number {
  let state = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    state ^= value.charCodeAt(index);
    state = Math.imul(state, 0x01000193);
  }
  return (state >>> 0) / 0xffffffff;
}

export function encodeWebGLParameters(
  blueprint: EffectBlueprint,
  params: Readonly<Record<string, unknown>>
): readonly number[] {
  const encoded = blueprint.parameters.flatMap((spec) => encodeValue(spec, params[spec.name]));
  if (encoded.length > 6) throw new RangeError(`${blueprint.effectId} exceeds six WebGL parameter slots.`);
  return Object.freeze([...encoded, ...Array.from({ length: 6 - encoded.length }, () => 0)]);
}

export function createCatalogWebGLPass(
  blueprint: EffectBlueprint,
  params: Readonly<Record<string, unknown>>,
  progress: number,
  seed: number,
  quality: RenderQuality,
  width: number,
  height: number
): CatalogWebGLPass {
  const encoded = encodeWebGLParameters(blueprint, params);
  return {
    id: blueprint.effectId,
    fragmentSource: `${COMMON}${BODIES[blueprint.sourceId]}${END}`,
    uniforms: Object.freeze({
      u_progress: Math.min(1, Math.max(0, progress)),
      u_seed: seed,
      u_quality: quality === "draft" ? 0 : quality === "preview" ? 0.5 : 1,
      u_texel: Object.freeze([1 / Math.max(1, width), 1 / Math.max(1, height)] as const),
      u_p0: encoded[0]!,
      u_p1: encoded[1]!,
      u_p2: encoded[2]!,
      u_p3: encoded[3]!,
      u_p4: encoded[4]!,
      u_p5: encoded[5]!
    }),
    catalogContribution: false
  };
}
