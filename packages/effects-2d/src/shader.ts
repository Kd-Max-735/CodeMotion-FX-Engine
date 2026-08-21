import {
  TIME_CONTRACT_VERSION,
  type EffectTimeSample,
  type RenderQuality
} from "@codemotion/core";
import type { LayerRasterizationInput } from "@codemotion/renderer-api";
import { createEffectRandom } from "@codemotion/timeline";
import { flattenVectorPath, parseSvgPathData } from "./inputs.js";
import type {
  EffectBlueprint,
  ParameterSpec,
  P0SourceId
} from "./types.js";

export interface CatalogWebGLPass {
  readonly id: string;
  readonly fragmentSource: string;
  readonly uniforms: Readonly<Record<
    string,
    number | readonly [number, number] | readonly [number, number, number, number]
  >>;
  readonly catalogContribution: false;
}

const COMMON = `#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_progress;
uniform float u_time;
uniform float u_seed;
uniform float u_quality;
uniform float u_encoded;
uniform vec2 u_texel;
uniform vec4 u_input_meta;
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
vec3 toLinear(vec3 value) {
  if (u_encoded < 0.5) return value;
  bvec3 low = lessThanEqual(value, vec3(0.04045));
  return mix(pow((value + 0.055) / 1.055, vec3(2.4)), value / 12.92, low);
}
vec3 fromLinear(vec3 value) {
  value = clamp(value, 0.0, 1.0);
  if (u_encoded < 0.5) return value;
  bvec3 low = lessThanEqual(value, vec3(0.0031308));
  return mix(1.055 * pow(value, vec3(1.0 / 2.4)) - 0.055, value * 12.92, low);
}
vec4 sampleAt(vec2 uv) {
  vec4 sampleValue = texture(u_input, clamp(uv, vec2(0.0), vec2(1.0)));
  vec3 straight = sampleValue.a > 0.0 ? sampleValue.rgb / sampleValue.a : vec3(0.0);
  return vec4(toLinear(straight), sampleValue.a);
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
  vec3 encoded = fromLinear(c.rgb);
  if (c.a <= 0.00001) encoded = vec3(0.0);
  outColor = vec4(encoded * c.a, c.a);
}`;

const BODIES: Readonly<Record<P0SourceId, string>> = Object.freeze({
  M01: `
  float durationSeconds = 0.01 + u_p2 * 59.99;
  float durationProgress = clamp(u_time / durationSeconds, 0.0, 1.0);
  float easedProgress = durationProgress;
  if (u_p3 < 0.167) easedProgress = durationProgress;
  else if (u_p3 < 0.5) easedProgress = durationProgress * durationProgress * durationProgress;
  else if (u_p3 < 0.834) easedProgress = 1.0 - pow(1.0 - durationProgress, 3.0);
  else easedProgress = durationProgress < 0.5
    ? 4.0 * pow(durationProgress, 3.0)
    : 1.0 - pow(-2.0 * durationProgress + 2.0, 3.0) / 2.0;
  c.a *= mix(u_p0, u_p1, easedProgress);`,
  M02: `
  float angle = u_p0 * 6.2831853;
  vec2 custom = (vec2(u_p3, u_p4) - 0.5) * 2.0;
  float distance = u_p1 * (1.0 - p);
  vec2 shift = (vec2(cos(angle), sin(angle)) + custom * 0.35) * distance;
  shift += normalize(shift + 0.0001) * sin(p * 3.14159) * u_p2 * 0.12;
  c = sampleAt(uv - shift);`,
  M03: `
  float durationSeconds = 0.05 + u_p5 * 59.95;
  float motionProgress = clamp(u_time / durationSeconds, 0.0, 1.0);
  vec2 pivot = vec2(u_p3, u_p4);
  float scale = max(0.03, mix(u_p0 * 4.0, u_p1 * 4.0, motionProgress)
    + sin(motionProgress * 9.4248) * u_p2 * (1.0 - motionProgress) * 0.35);
  c = sampleAt(pivot + (uv - pivot) / scale);`,
  M04: `
  float durationSeconds = 0.05 + u_p5 * 59.95;
  float motionProgress = clamp(u_time / durationSeconds, 0.0, 1.0);
  vec2 pivot = vec2(u_p1, u_p2);
  float angleDegrees = -720.0 + u_p0 * 1440.0;
  float turns = -4.0 + u_p4 * 8.0;
  float angle = radians(angleDegrees + turns * 360.0) * (1.0 - motionProgress);
  mat2 rotation = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
  vec2 rotated = pivot + rotation * (uv - pivot);
  c = mix(sampleAt(rotated), sampleAt(rotated + vec2(u_p3 * 0.03, 0.0)), u_p3);`,
  M05: `
  float height = max(0.001, u_p0 * 2.0);
  float gravity = 0.1 + u_p1 * 39.9;
  float bounces = 1.0 + floor(u_p2 * 11.0 + 0.5);
  float flightSeconds = 2.0 * sqrt(2.0 * height / gravity);
  float bounceIndex = floor(u_time / flightSeconds);
  float localTime = mod(u_time, flightSeconds) / flightSeconds;
  float jump = bounceIndex < bounces
    ? sin(localTime * 3.14159) * height * pow(u_p3, bounceIndex)
    : 0.0;
  c = sampleAt(uv + vec2(0.0, jump));`,
  M06: `
  float period = 0.02 + u_p1 * 3.98;
  float displacement = u_p0 * 2.0 * sin(u_time * 6.283 / period)
    * exp(-(u_p2 * 20.0) * u_time);
  vec2 axis = u_p3 < 0.34 ? vec2(1.0, 0.0) : u_p3 < 0.67 ? vec2(0.0, 1.0) : normalize(uv - 0.5 + 0.001);
  c = sampleAt(uv - axis * displacement);`,
  M07: `
  float floatAngle = u_time * (u_p2 * 20.0) * 6.283 + (-6.283 + u_p3 * 12.566);
  float floatWave = sin(floatAngle);
  vec2 floatOffset = u_p0 < 0.125 ? vec2(floatWave, 0.0) * u_p1
    : u_p0 < 0.375 ? vec2(0.0, floatWave) * u_p1
    : u_p0 < 0.625 ? vec2(floatWave, cos(floatAngle)) * u_p1
    : u_p0 < 0.875 ? vec2(floatWave, floatWave) * (u_p1 * 0.70710678)
    : vec2(floatWave, -floatWave) * (u_p1 * 0.70710678);
  c = sampleAt(uv - floatOffset);`,
  M08: `
  float frequency = u_p1 * 60.0;
  float seedOffset = mod(u_p3 * 100000.0, 4093.0);
  float stepValue = floor(u_time * frequency * 10.0);
  vec2 jitter = vec2(hash(vec2(stepValue, seedOffset)), hash(vec2(seedOffset, stepValue))) * 2.0 - 1.0;
  jitter *= u_p0 * exp(-(u_p2 * 20.0) * u_time);
  c = sampleAt(uv - jitter);`,
  T01: `
  float sourceAlpha = c.a;
  float columns = max(1.0, u_input_meta.x);
  vec2 cell = floor(uv * vec2(columns, 1.0));
  float index = cell.x;
  if (u_p2 > 0.5) index = floor(index / 5.0) * 5.0;
  float revealedGlyphs = u_time * (0.1 + u_p0 * 119.9);
  float visible = step(index + 1.0, revealedGlyphs);
  float cursor = u_p1 * step(1.0 - u_p3, fract(uv.x * columns))
    * (1.0 - step(1.0, abs(index - revealedGlyphs)));
  c = mix(vec4(0.0), c, visible);
  c = mix(c, vec4(vec3(sourceAlpha), sourceAlpha), cursor);`,
  T02: `
  float columns = max(1.0, u_input_meta.x);
  vec2 cell = floor(uv * vec2(columns, 1.0));
  float index = cell.x;
  float groupSize = mix(1.0, columns, u_p3);
  index = floor(index / groupSize) * groupSize;
  float local = clamp((u_time - index * u_p0 * 2.0) / 0.25, 0.0, 1.0);
  vec2 axis = u_p1 < 0.5 ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  c = sampleAt(uv - axis * (u_p2 - 0.5) * 0.5 * (1.0 - local));
  c.a *= local;`,
  T03: `
  float columns = max(1.0, u_input_meta.x);
  vec2 cell = floor(uv * vec2(columns, 1.0));
  float phase = mix(cell.x + cell.y, atan(uv.y - 0.5, uv.x - 0.5) * 3.0, u_p0);
  float pulse = 1.0 + sin(phase + p * 6.283 * (1.0 + u_p1 * 3.0))
    * u_p3 * (0.12 + u_p2 * 0.28);
  vec2 center = (cell + 0.5) / vec2(columns, 1.0);
  c = sampleAt(center + (uv - center) / max(0.1, pulse));`,
  T04: `
  float pathY = 0.5 + sin(uv.x * 6.283 * (1.0 + u_p0 * 2.0) + u_p0 * 6.283) * (0.12 + u_p0 * 0.16);
  if (u_p2 < 0.5) {
    float tangent = cos(uv.x * 6.283 * (1.0 + u_p0 * 2.0)) * (0.1 + u_p0 * 0.35);
    vec2 delta = uv - vec2(0.5, pathY);
    c = sampleAt(vec2(0.5, pathY) + vec2(
      delta.x * cos(tangent) - delta.y * sin(tangent),
      delta.x * sin(tangent) + delta.y * cos(tangent)
    ));
  }
  float pathProgress = mix(uv.x, uv.x * 0.75 + uv.y * 0.25, u_p2);
  float visible = (1.0 - smoothstep(u_p1 - u_p3 * 0.25, u_p1 + u_p3 * 0.25, pathProgress))
    * band(uv.y, pathY, 0.025 + u_p3 * 0.1);
  c.a *= visible;`,
  T05: `
  float columns = max(1.0, u_input_meta.x);
  vec2 cell = floor(uv * vec2(columns, 1.0));
  float wobble = sin(cell.x * (1.0 + u_p0 * 3.0) + cell.y + u_p3 * 6.283 * (1.0 + u_p1 * 2.0))
    * (0.01 + u_p2 * 0.045) * sin(u_p3 * 3.14159);
  c = sampleAt(uv + vec2(wobble, -wobble));
  c.rb += vec2(u_p1 * u_p3, u_p0 * (1.0 - u_p3)) * 0.18;`,
  T06: `
  float columns = max(1.0, u_input_meta.x);
  vec2 cell = floor(uv * vec2(columns, 1.0));
  float threshold = mix(uv.x, hash(cell + u_p0 * 31.0), u_p2);
  float speed = 0.1 + u_p1 * 239.9;
  float decode = clamp(u_p3, 0.0, 1.0);
  float scrambled = step(decode, threshold);
  vec3 noiseColor = vec3(hash(cell + floor(u_time * speed)), 0.7 + u_p0 * 0.3, 1.0 - u_p0 * 0.4);
  c.rgb = mix(c.rgb, noiseColor, scrambled);
  c.rgb = mix(c.rgb, c.rgb * vec3(0.82 + u_p0 * 0.18, 1.0, 0.9 + u_p0 * 0.1), 0.35);
  c.a *= 1.0 - scrambled * 0.2;`,
  T07: `
  float columns = max(1.0, u_input_meta.x);
  vec2 cell = floor(uv * vec2(columns, 1.0));
  float index = mix(cell.x, floor(cell.x / 5.0) * 5.0, u_p3);
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
  float noise = hash(floor(uv / size));
  float coverage = 1.0 - smoothstep(u_p3 - size, u_p3 + size, uv.x + (noise - 0.5) * u_p2);
  coverage *= c.a;
  c = mix(c, vec4(0.93, 0.82, 0.62, 1.0), coverage);`,
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
  float flickerRate = 8.0 + u_p3 * 22.0;
  float flickerNoise = hash(vec2(floor(u_time * flickerRate), u_seed));
  float flicker = u_p3 <= 0.0 ? 1.0 : clamp(1.0 - u_p3 * (0.2 + flickerNoise * 0.8), 0.05, 1.0);
  c.rgb += neon * edge * u_p2 * 4.0 * flicker;`,
  L02: `
  float angle = (u_p0 - 0.5) * 12.56637061;
  float coordinate = dot(uv, vec2(-sin(angle), cos(angle)));
  float center = fract(u_time * (-10.0 + u_p3 * 20.0));
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
  float pulseCount = 1.0 + floor(u_p4 * 31.0 + 0.5);
  float durationSeconds = 0.1 + u_p5 * 59.9;
  float pulseLifetimeSeconds = min(1.4, max(0.45, durationSeconds / max(2.0, pulseCount)));
  float emissionSpan = max(0.0, durationSeconds - pulseLifetimeSeconds);
  float ring = 0.0;
  float refraction = 0.0;
  for (int i = 0; i < 32; i++) {
    float enabled = 1.0 - step(pulseCount, float(i) + 0.5);
    float emissionStart = pulseCount <= 1.0 ? 0.0 : emissionSpan * float(i) / (pulseCount - 1.0);
    float phase = (u_time - emissionStart) / pulseLifetimeSeconds;
    float active = step(0.0, phase) * step(phase, 1.0) * enabled;
    float envelope = pow(max(0.0, sin(3.14159265 * clamp(phase, 0.0, 1.0))), 0.42);
    float pulseRadius = u_p2 * 2.0 * clamp(phase, 0.0, 1.0);
    float crestWidth = 0.003 + u_p3 * 0.055;
    float delta = distance - pulseRadius;
    float crest = exp(-(delta * delta) / (2.0 * crestWidth * crestWidth));
    float glow = exp(-abs(delta) / (0.012 + u_p3 * 0.14));
    float wakeDelta = distance - pulseRadius * 0.78;
    float wakeWidth = crestWidth * 2.5;
    float wake = exp(-(wakeDelta * wakeDelta) / (2.0 * wakeWidth * wakeWidth));
    float core = exp(-distance / (0.018 + u_p3 * 0.09)) * exp(-phase * 5.5);
    ring += (crest * 1.15 + glow * 0.38 + wake * 0.22 + core * 0.9) * envelope * active;
    refraction += sign(delta) * crest * envelope * active * (0.0015 + u_p3 * 0.007);
  }
  vec2 direction = distance > 0.0001 ? (uv - center) / distance : vec2(0.0);
  c = sampleAt(uv - direction * refraction);
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
  float directionCode = floor(u_p0 * 7.0 + 0.5);
  vec2 direction = directionCode == 1.0 ? vec2(-1.0, 0.0)
    : directionCode == 2.0 ? vec2(0.0, 1.0)
    : directionCode == 3.0 ? vec2(0.0, -1.0)
    : directionCode == 4.0 ? vec2(1.0, 1.0)
    : directionCode == 5.0 ? vec2(1.0, -1.0)
    : directionCode == 6.0 ? vec2(-1.0, 1.0)
    : directionCode == 7.0 ? vec2(-1.0, -1.0)
    : vec2(1.0, 0.0);
  float angle = (u_p2 - 0.5) * 6.283;
  direction = mat2(cos(angle), sin(angle), -sin(angle), cos(angle)) * direction;
  float coordinate = dot(uv - 0.5, direction) / max(0.0001, abs(direction.x) + abs(direction.y)) + 0.5;
  float wipe = 1.0 - smoothstep(u_p3 - u_p1 * 0.25, u_p3 + u_p1 * 0.25, coordinate);
  c.rgb *= 0.65 + wipe * 0.35;
  c.a *= wipe;`,
  C02: `
  float angle = fract(atan(uv.y - u_p1, uv.x - u_p0) / 6.283 - (u_p2 - 0.5) * 2.0 + 1.0);
  angle = mix(1.0 - angle, angle, u_p3);
  float wipe = step(angle, p * u_p4);
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
  vec2 cellUv = (cell + 0.5) / grid;
  float randomOrder = hash(cell + vec2(u_p2 * 997.0, u_p2 * 541.0));
  float directionCode = floor(u_p2 * 100000.0 + 0.5);
  float linearOrder = directionCode == 2.0 ? 1.0 - cellUv.x
    : directionCode == 3.0 ? cellUv.y
    : directionCode == 4.0 ? 1.0 - cellUv.y
    : cellUv.x;
  float radialOrder = length(cellUv - 0.5) * 1.414;
  float threshold = u_p1 < 0.34 ? randomOrder : u_p1 < 0.67 ? linearOrder : radialOrder;
  float dissolve = step(threshold, p * u_p3);
  float cellEdge = min(fract(uv.x * grid), fract(uv.y * grid));
  c.rgb *= 0.53 + dissolve * 0.32 + step(cellEdge, 0.08) * u_p0 * 0.05
    + u_p0 * 0.04 + u_p2 * 0.06;
  c.a *= dissolve * (0.7 + u_p0 * 0.3) * (0.85 + u_p2 * 0.15);`,
  H01: `
  float coverage = c.a;
  coverage = mix(coverage, 1.0 - coverage, u_p3);
  float reveal = smoothstep(u_p1 - u_p2 * 0.25, u_p1 + u_p2 * 0.25, coverage);
  c.a *= reveal;`,
  H02: `
  vec4 matte = sampleAt(uv);
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
  vec4 mapValue = sampleAt(uv);
  float channel = u_p3 < 0.2 ? mapValue.r : u_p3 < 0.4 ? mapValue.g
    : u_p3 < 0.6 ? mapValue.b : u_p3 < 0.8 ? mapValue.a : dot(mapValue.rgb, vec3(0.2126, 0.7152, 0.0722));
  channel = floor(clamp(channel, 0.0, 1.0) * 7.0 + 0.5) / 7.0;
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
  if (spec.kind === "text") {
    const text = typeof value === "string" ? value : spec.default;
    if (spec.name === "path" || spec.name === "fromPath" || spec.name === "toPath") {
      const points = flattenVectorPath(parseSvgPathData(text));
      let length = 0;
      for (let index = 1; index < points.length; index += 1) {
        length += Math.hypot(
          points[index]!.x - points[index - 1]!.x,
          points[index]!.y - points[index - 1]!.y
        );
      }
      return [Math.min(1, length / 4)];
    }
    if (spec.name === "beatMap" || spec.name === "scaleMap") {
      const values = text.split(",").map((entry) => Number(entry.trim()));
      if (values.length === 0 || values.some((entry) => !Number.isFinite(entry))) {
        throw new TypeError(`${spec.name} must be a comma-separated finite-number map.`);
      }
      const average = values.reduce((sum, entry) => sum + entry, 0) / values.length;
      return [0.5 + Math.atan(average) / Math.PI];
    }
    if (spec.name === "mask" || spec.name === "matteLayer" || spec.name === "map"
      || spec.name === "brushTexture") {
      return [0];
    }
    const codePoints = [...text].map((entry) => entry.codePointAt(0)! / 0x10ffff);
    if (codePoints.length === 0) throw new TypeError(`${spec.name} must not be empty.`);
    return [codePoints.reduce((sum, entry) => sum + entry, 0) / codePoints.length];
  }
  const vector = Array.isArray(value) && value.length === 2 ? value : spec.default;
  return [0, 1].map((index) => {
    const numeric = typeof vector[index] === "number" ? vector[index] : spec.default[index]!;
    return (numeric - spec.min) / Math.max(Number.EPSILON, spec.max - spec.min);
  });
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
  timing: EffectTimeSample,
  seed: number,
  quality: RenderQuality,
  width: number,
  height: number,
  rasterInput?: LayerRasterizationInput
): CatalogWebGLPass {
  if (timing.effectId !== blueprint.effectId) {
    throw new TypeError(`WebGL timing effectId must equal ${blueprint.effectId}.`);
  }
  if (timing.contractVersion !== TIME_CONTRACT_VERSION
    || typeof timing.effectInstanceId !== "string"
    || timing.effectInstanceId.length === 0) {
    throw new TypeError(`WebGL timing requires EffectTimeSample ${TIME_CONTRACT_VERSION} with effectInstanceId.`);
  }
  const encoded = encodeWebGLParameters(blueprint, params);
  const temporalRandom = blueprint.sourceId === "M08"
    || blueprint.sourceId === "T06"
    || blueprint.sourceId === "L01";
  const randomTime = temporalRandom ? timing : {
    ...timing,
    effectTime: 0,
    progress: 0,
    deltaTime: 0
  };
  const randomSeed = createEffectRandom(
    seed >>> 0,
    randomTime,
    `webgl:${blueprint.sourceId}`,
    temporalRandom ? 60 : 1
  ).nextUint32();
  const source = rasterInput?.source;
  let inputMeta: readonly [number, number, number, number] = [1, 1, 0, 0];
  if (source?.kind === "text") {
    inputMeta = [source.glyphs.length, source.text.length, source.font.unitsPerEm / 4096, 1];
  } else if (source?.kind === "shape" || source?.kind === "svg") {
    inputMeta = [
      source.paths.length,
      source.paths.reduce((count, path) => count + path.commands.length, 0),
      source.viewport.width,
      source.viewport.height
    ];
  } else if (source?.kind === "image" || source?.kind === "video") {
    inputMeta = [source.pixels.width, source.pixels.height, source.frameTime, 1];
  }
  return {
    id: blueprint.effectId,
    fragmentSource: `${COMMON}${BODIES[blueprint.sourceId]}${END}`,
    uniforms: Object.freeze({
      u_progress: Math.min(1, Math.max(0, timing.progress)),
      u_time: Math.max(0, timing.effectTime),
      u_seed: randomSeed,
      u_quality: quality === "draft" ? 0 : quality === "preview" ? 0.5 : 1,
      u_encoded: rasterInput?.target.colorSpace === "linear-srgb" ? 0 : 1,
      u_texel: Object.freeze([1 / Math.max(1, width), 1 / Math.max(1, height)] as const),
      u_input_meta: Object.freeze(inputMeta),
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
