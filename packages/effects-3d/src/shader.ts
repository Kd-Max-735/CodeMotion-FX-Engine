import type { RenderQuality } from "@codemotion/core";
import type { TextExtrude3DParams } from "./types.js";

export interface TextExtrude3DWebGLPass {
  readonly id: "fx.text.textExtrude3D";
  readonly fragmentSource: string;
  readonly uniforms: Readonly<Record<string, number | readonly [number, number]>>;
  readonly catalogContribution: false;
}

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform float u_depth;
uniform float u_bevel;
uniform float u_material;
uniform float u_light;
uniform float u_progress;
uniform float u_rotation_x;
uniform float u_rotation_y;
uniform float u_perspective;
uniform float u_samples;
in vec2 v_uv;
out vec4 outColor;

vec3 lightDirection(float profile) {
  if (profile < 0.5) return normalize(vec3(-0.45, -0.55, 0.8));
  if (profile < 1.5) return normalize(vec3(0.8, -0.2, 0.55));
  return normalize(vec3(0.0, -0.9, 0.45));
}

vec3 shade(vec3 color, vec3 normal, float material, float side) {
  vec3 lightDir = lightDirection(u_light);
  float diffuse = 0.24 + max(0.0, dot(normal, lightDir)) * 0.76;
  float specular = pow(max(0.0, dot(reflect(-lightDir, normal), vec3(0.0, 0.0, 1.0))), material < 0.5 ? 12.0 : 38.0);
  if (material < 0.5) return color * diffuse;
  if (material < 1.5) return color * (0.32 + diffuse * 0.58) + vec3(specular * 0.55);
  return mix(color, vec3(0.72, 0.9, 1.0), 0.38) * (0.45 + diffuse * 0.38) + vec3(specular * 0.72 + side * 0.05);
}

void main() {
  float rx = radians(u_rotation_x);
  float ry = radians(u_rotation_y);
  vec2 direction = vec2(sin(ry), -sin(rx));
  float depth = u_depth * u_progress * (0.08 + u_perspective * 0.08);
  vec4 front = texture(u_input, clamp(v_uv - direction * depth * 0.15, 0.0, 1.0));
  vec4 accumulated = vec4(0.0);
  for (int index = 24; index >= 1; --index) {
    if (float(index) > u_samples) continue;
    float layer = float(index) / u_samples;
    vec2 sampleUv = v_uv - direction * depth * layer;
    vec4 sampleColor = texture(u_input, clamp(sampleUv, 0.0, 1.0));
    float bevel = smoothstep(0.0, max(0.001, u_bevel), sampleColor.a);
    if (sampleColor.a > accumulated.a) {
      vec3 normal = normalize(vec3(-direction * (0.4 + u_bevel), 0.65));
      accumulated = vec4(shade(sampleColor.rgb, normal, u_material, layer), sampleColor.a * bevel);
    }
  }
  if (front.a > 0.0) accumulated = vec4(shade(front.rgb, vec3(0.0, 0.0, 1.0), u_material, 0.0), front.a);
  if (accumulated.a <= 0.0) accumulated.rgb = vec3(0.0);
  outColor = accumulated;
}`;

const materialIndex = Object.freeze({ matte: 0, metal: 1, glass: 2 });
const lightIndex = Object.freeze({ studio: 0, rim: 1, top: 2 });

export function qualityLayerCount(quality: RenderQuality): 6 | 12 | 24 {
  return quality === "draft" ? 6 : quality === "preview" ? 12 : 24;
}

export function createTextExtrude3DWebGLPass(
  params: TextExtrude3DParams,
  quality: RenderQuality
): TextExtrude3DWebGLPass {
  return Object.freeze({
    id: "fx.text.textExtrude3D",
    fragmentSource: FRAGMENT_SOURCE,
    uniforms: Object.freeze({
      u_depth: params.depth,
      u_bevel: params.bevel,
      u_material: materialIndex[params.material],
      u_light: lightIndex[params.light],
      u_progress: params.progress,
      u_rotation_x: params.rotationX,
      u_rotation_y: params.rotationY,
      u_perspective: params.perspective,
      u_samples: qualityLayerCount(quality)
    }),
    catalogContribution: false
  });
}
