import {
  EngineError,
  ERROR_CODES,
  RENDERER_API_VERSION,
  type AlphaMode,
  type BlendMode,
  type ColorSpace,
  type JsonObject,
  type LayerDefinition
} from "@codemotion/core";
import type {
  CompositeOptions,
  FrameContext,
  RendererAdapter,
  RendererCapabilities,
  RendererInitialization,
  RenderOutput,
  TextureDescriptor,
  TextureHandle
} from "@codemotion/renderer-api";

type GlObject = object;
type GlUniformLocation = object;

export interface WebGL2ContextLike {
  readonly VERTEX_SHADER: number;
  readonly FRAGMENT_SHADER: number;
  readonly COMPILE_STATUS: number;
  readonly LINK_STATUS: number;
  readonly TEXTURE_2D: number;
  readonly TEXTURE0: number;
  readonly TEXTURE_MIN_FILTER: number;
  readonly TEXTURE_MAG_FILTER: number;
  readonly TEXTURE_WRAP_S: number;
  readonly TEXTURE_WRAP_T: number;
  readonly LINEAR: number;
  readonly CLAMP_TO_EDGE: number;
  readonly RGBA: number;
  readonly RED: number;
  readonly RGBA8: number;
  readonly RGBA16F: number;
  readonly RGBA32F: number;
  readonly R8: number;
  readonly UNSIGNED_BYTE: number;
  readonly HALF_FLOAT: number;
  readonly FLOAT: number;
  readonly FRAMEBUFFER: number;
  readonly COLOR_ATTACHMENT0: number;
  readonly FRAMEBUFFER_COMPLETE: number;
  readonly TRIANGLES: number;
  readonly COLOR_BUFFER_BIT: number;
  readonly MAX_TEXTURE_SIZE: number;
  readonly UNPACK_PREMULTIPLY_ALPHA_WEBGL: number;
  readonly UNPACK_COLORSPACE_CONVERSION_WEBGL: number;
  readonly UNPACK_ALIGNMENT: number;
  readonly NONE: number;
  readonly NO_ERROR: number;
  createTexture(): GlObject | null;
  deleteTexture(texture: GlObject): void;
  bindTexture(target: number, texture: GlObject | null): void;
  texParameteri(target: number, parameter: number, value: number): void;
  texImage2D(target: number, level: number, internalFormat: number, width: number, height: number, border: number, format: number, type: number, pixels: ArrayBufferView | null): void;
  texSubImage2D(target: number, level: number, x: number, y: number, width: number, height: number, format: number, type: number, pixels: ArrayBufferView): void;
  pixelStorei(parameter: number, value: number | boolean): void;
  createFramebuffer(): GlObject | null;
  deleteFramebuffer(framebuffer: GlObject): void;
  bindFramebuffer(target: number, framebuffer: GlObject | null): void;
  framebufferTexture2D(target: number, attachment: number, textureTarget: number, texture: GlObject | null, level: number): void;
  checkFramebufferStatus(target: number): number;
  createShader(type: number): GlObject | null;
  shaderSource(shader: GlObject, source: string): void;
  compileShader(shader: GlObject): void;
  getShaderParameter(shader: GlObject, parameter: number): unknown;
  getShaderInfoLog(shader: GlObject): string | null;
  deleteShader(shader: GlObject): void;
  createProgram(): GlObject | null;
  attachShader(program: GlObject, shader: GlObject): void;
  linkProgram(program: GlObject): void;
  getProgramParameter(program: GlObject, parameter: number): unknown;
  getProgramInfoLog(program: GlObject): string | null;
  deleteProgram(program: GlObject): void;
  useProgram(program: GlObject | null): void;
  getUniformLocation(program: GlObject, name: string): GlUniformLocation | null;
  uniform1i(location: GlUniformLocation | null, value: number): void;
  uniform1f(location: GlUniformLocation | null, value: number): void;
  uniform2fv(location: GlUniformLocation | null, value: readonly number[]): void;
  uniform3fv(location: GlUniformLocation | null, value: readonly number[]): void;
  uniform4fv(location: GlUniformLocation | null, value: readonly number[]): void;
  activeTexture(texture: number): void;
  viewport(x: number, y: number, width: number, height: number): void;
  drawArrays(mode: number, first: number, count: number): void;
  clearColor(red: number, green: number, blue: number, alpha: number): void;
  clear(mask: number): void;
  readPixels(x: number, y: number, width: number, height: number, format: number, type: number, pixels: ArrayBufferView): void;
  createVertexArray(): GlObject | null;
  bindVertexArray(vertexArray: GlObject | null): void;
  deleteVertexArray(vertexArray: GlObject): void;
  getParameter(parameter: number): unknown;
  getExtension(name: string): unknown;
  getError(): number;
  isContextLost(): boolean;
}

export type WebGLContextFactory = (initialization: RendererInitialization) => WebGL2ContextLike | null;

export interface WebGLRendererOptions {
  readonly id?: string;
  readonly contextFactory: WebGLContextFactory;
  readonly maxTextureSizeHint?: number;
  readonly supportsFloatTexturesHint?: boolean;
}

export type WebGLEffectUniform = number | readonly [number, number] | readonly [number, number, number] | readonly [number, number, number, number];

export interface WebGLEffectPass {
  readonly id: string;
  readonly fragmentSource: string;
  readonly uniforms?: Readonly<Record<string, WebGLEffectUniform>>;
  readonly catalogContribution: false;
}

export interface WebGLEffectFailure {
  readonly effectId: string;
  readonly error: EngineError;
}

export interface WebGLEffectStackResult {
  readonly output: TextureHandle;
  readonly failures: readonly WebGLEffectFailure[];
}

export interface WebGLMaskOptions {
  readonly mode: "add" | "subtract" | "intersect";
  readonly inverted?: boolean;
  readonly opacity?: number;
  readonly target?: TextureHandle;
}

export interface WebGLMaskPass {
  readonly texture: TextureHandle;
  readonly mode: "add" | "subtract" | "intersect" | "none";
  readonly inverted?: boolean;
  readonly opacity?: number;
}

const VERTEX_SHADER = `#version 300 es
precision highp float;
out vec2 v_uv;
void main() {
  vec2 position = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  v_uv = position;
  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}`;

const COLOR_FUNCTIONS = `
vec3 toLinear(vec3 value, bool encoded) {
  if (!encoded) return value;
  bvec3 low = lessThanEqual(value, vec3(0.04045));
  return mix(pow((value + 0.055) / 1.055, vec3(2.4)), value / 12.92, low);
}
vec3 fromLinear(vec3 value, bool encoded) {
  value = clamp(value, 0.0, 1.0);
  if (!encoded) return value;
  bvec3 low = lessThanEqual(value, vec3(0.0031308));
  return mix(1.055 * pow(value, vec3(1.0 / 2.4)) - 0.055, value * 12.92, low);
}`;

const COPY_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_input;
in vec2 v_uv;
out vec4 outColor;
void main() { outColor = texture(u_input, v_uv); }`;

const COMPOSITE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_backdrop;
uniform sampler2D u_source;
uniform float u_opacity;
uniform int u_blend_mode;
uniform bool u_backdrop_encoded;
uniform bool u_source_encoded;
uniform bool u_output_encoded;
in vec2 v_uv;
out vec4 outColor;
${COLOR_FUNCTIONS}
vec3 blend(vec3 base, vec3 source) {
  if (u_blend_mode == 1) return base * source;
  if (u_blend_mode == 2) return base + source - base * source;
  if (u_blend_mode == 3) return min(vec3(1.0), base + source);
  return source;
}
void main() {
  vec4 baseSample = texture(u_backdrop, v_uv);
  vec4 sourceSample = texture(u_source, v_uv);
  float baseAlpha = baseSample.a;
  float sourceAlpha = sourceSample.a * u_opacity;
  vec3 base = toLinear(baseAlpha > 0.0 ? baseSample.rgb / baseAlpha : vec3(0.0), u_backdrop_encoded);
  vec3 source = toLinear(sourceSample.a > 0.0 ? sourceSample.rgb / sourceSample.a : vec3(0.0), u_source_encoded);
  float alpha = sourceAlpha + baseAlpha * (1.0 - sourceAlpha);
  vec3 premultiplied = (1.0 - sourceAlpha) * baseAlpha * base
    + (1.0 - baseAlpha) * sourceAlpha * source
    + baseAlpha * sourceAlpha * blend(base, source);
  vec3 straight = alpha > 0.0 ? premultiplied / alpha : vec3(0.0);
  outColor = vec4(fromLinear(straight, u_output_encoded) * alpha, alpha);
}`;

const MASK_COMBINE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_previous;
uniform sampler2D u_mask;
uniform float u_opacity;
uniform bool u_inverted;
uniform bool u_mask_red;
uniform bool u_has_previous;
uniform int u_mode;
in vec2 v_uv;
out vec4 outColor;
void main() {
  vec4 maskSample = texture(u_mask, v_uv);
  float maskAlpha = (u_mask_red ? maskSample.r : maskSample.a) * u_opacity;
  if (u_inverted) maskAlpha = 1.0 - maskAlpha;
  float previous = u_has_previous ? texture(u_previous, v_uv).r : (u_mode == 1 ? 1.0 : 0.0);
  float coverage = maskAlpha;
  if (u_has_previous && u_mode == 0) coverage = previous + maskAlpha - previous * maskAlpha;
  if (u_mode == 1) coverage = previous * (1.0 - maskAlpha);
  if (u_has_previous && u_mode == 2) coverage = previous * maskAlpha;
  outColor = vec4(coverage, 0.0, 0.0, 1.0);
}`;

const MASK_APPLY_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform sampler2D u_coverage;
in vec2 v_uv;
out vec4 outColor;
void main() {
  outColor = texture(u_input, v_uv) * texture(u_coverage, v_uv).r;
}`;

const VALIDATION_TINT_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_input;
uniform vec3 u_tint;
in vec2 v_uv;
out vec4 outColor;
void main() {
  vec4 source = texture(u_input, v_uv);
  outColor = vec4(source.rgb * u_tint, source.a);
}`;

export const WEBGL_PIPELINE_VALIDATION_EFFECT: WebGLEffectPass = Object.freeze({
  id: "internal.pipeline.tint-validation",
  fragmentSource: VALIDATION_TINT_FRAGMENT,
  uniforms: Object.freeze({ u_tint: Object.freeze([0.5, 0.75, 1] as const) }),
  catalogContribution: false
});

interface TextureResource {
  readonly handle: TextureHandle;
  readonly texture: GlObject;
  readonly framebuffer: GlObject;
  alphaMode: AlphaMode;
}

type RendererState = "new" | "ready" | "frame" | "disposed";

function lifecycleError(message: string, phase: string, cause?: unknown): EngineError {
  return new EngineError(ERROR_CODES.RENDERER_LIFECYCLE, message, { cause, details: { phase } });
}

function encoded(colorSpace: ColorSpace): boolean {
  return colorSpace !== "linear-srgb";
}

function parseColor(value: unknown): [number, number, number, number] {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(value)) return [0, 0, 0, 0];
  const alpha = value.length === 9 ? Number.parseInt(value.slice(7, 9), 16) / 255 : 1;
  return [
    Number.parseInt(value.slice(1, 3), 16) / 255,
    Number.parseInt(value.slice(3, 5), 16) / 255,
    Number.parseInt(value.slice(5, 7), 16) / 255,
    alpha
  ];
}

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export class WebGLRendererAdapter implements RendererAdapter {
  readonly id: string;
  readonly backend = "webgl" as const;
  readonly apiVersion = RENDERER_API_VERSION;
  readonly capabilities: RendererCapabilities;

  private readonly contextFactory: WebGLContextFactory;
  private state: RendererState = "new";
  private gl: WebGL2ContextLike | undefined;
  private vertexArray: GlObject | undefined;
  private textureSequence = 0;
  private readonly textures = new Map<string, TextureResource>();
  private readonly programs = new Map<string, GlObject>();
  private frameContext: FrameContext | undefined;
  private lastOutput: TextureHandle | undefined;

  constructor(options: WebGLRendererOptions) {
    this.id = options.id ?? "renderer.webgl2";
    this.contextFactory = options.contextFactory;
    this.capabilities = {
      maxTextureSize: options.maxTextureSizeHint ?? 4096,
      supportsAlpha: true,
      supportsFloatTextures: options.supportsFloatTexturesHint ?? true,
      supportedColorSpaces: ["srgb", "linear-srgb"],
      supportedBlendModes: ["normal", "multiply", "screen", "add"]
    };
  }

  initialize(options: RendererInitialization): void {
    if (this.state !== "new") throw lifecycleError("WebGL renderer can only be initialized once.", "initialize");
    options.signal?.throwIfAborted();
    const gl = this.contextFactory(options);
    if (gl === null) throw lifecycleError("WebGL2 context creation failed.", "context-create");
    this.gl = gl;
    try {
      const reportedSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      if (typeof reportedSize === "number" && Number.isFinite(reportedSize)) this.capabilities.maxTextureSize = reportedSize;
      this.capabilities.supportsFloatTextures = gl.getExtension("EXT_color_buffer_float") !== null;
      this.vertexArray = gl.createVertexArray() ?? undefined;
      if (this.vertexArray === undefined) throw new Error("Vertex array creation failed.");
      gl.bindVertexArray(this.vertexArray);
      this.programs.set("copy", this.compileProgram(COPY_FRAGMENT, "copy"));
      this.programs.set("composite", this.compileProgram(COMPOSITE_FRAGMENT, "composite"));
      this.programs.set("mask-combine", this.compileProgram(MASK_COMBINE_FRAGMENT, "mask-combine"));
      this.programs.set("mask-apply", this.compileProgram(MASK_APPLY_FRAGMENT, "mask-apply"));
      this.state = "ready";
    } catch (cause) {
      this.releaseGpuObjects();
      this.gl = undefined;
      throw cause instanceof EngineError ? cause : lifecycleError("WebGL pipeline initialization failed.", "initialize", cause);
    }
  }

  createTexture(descriptor: TextureDescriptor): TextureHandle {
    const gl = this.requireContext("create-texture");
    if (!Number.isInteger(descriptor.width) || descriptor.width < 1 || !Number.isInteger(descriptor.height) || descriptor.height < 1) {
      throw new RangeError("Texture dimensions must be positive integers.");
    }
    if (descriptor.width > this.capabilities.maxTextureSize || descriptor.height > this.capabilities.maxTextureSize) {
      throw lifecycleError("Texture dimensions exceed the WebGL limit.", "create-texture");
    }
    if (descriptor.samples !== 1) throw lifecycleError("The Stage 3 WebGL backend supports single-sample RenderTextures only.", "create-texture");
    if (!this.capabilities.supportedColorSpaces.includes(descriptor.colorSpace)) {
      throw lifecycleError("Texture color space is unsupported by this WebGL backend.", "create-texture");
    }
    const formats: readonly TextureDescriptor["format"][] = ["rgba8", "rgba16f", "rgba32f", "alpha8"];
    if (!formats.includes(descriptor.format)) throw lifecycleError("Texture format is unsupported by this WebGL backend.", "create-texture");
    const usages: readonly TextureDescriptor["usage"][] = ["input", "output", "intermediate", "mask"];
    if (!usages.includes(descriptor.usage)) throw lifecycleError("Texture usage is unsupported by this WebGL backend.", "create-texture");
    const format = this.textureFormat(descriptor);
    let texture: GlObject | undefined;
    let framebuffer: GlObject | undefined;
    let failure: unknown;
    try {
      texture = gl.createTexture() ?? undefined;
      if (texture === undefined) throw new Error("Texture allocation failed.");
      framebuffer = gl.createFramebuffer() ?? undefined;
      if (framebuffer === undefined) throw new Error("Framebuffer allocation failed.");
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, format.internal, descriptor.width, descriptor.height, 0, format.external, format.type, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("Framebuffer is incomplete.");
      this.assertNoGlError("create-texture");
    } catch (cause) {
      failure = cause;
    }
    try { gl.bindFramebuffer(gl.FRAMEBUFFER, null); } catch (cause) { failure ??= cause; }
    try { gl.bindTexture(gl.TEXTURE_2D, null); } catch (cause) { failure ??= cause; }
    if (failure !== undefined || texture === undefined || framebuffer === undefined) {
      this.deleteUnregisteredTextureObjects(gl, texture, framebuffer);
      throw lifecycleError("RenderTexture allocation failed.", "create-texture", failure);
    }
    const id = `${this.id}.texture.${++this.textureSequence}`;
    const handle: TextureHandle = Object.freeze({
      id,
      backend: this.backend,
      descriptor: Object.freeze({ ...descriptor })
    });
    this.textures.set(id, { handle, texture, framebuffer, alphaMode: descriptor.format === "alpha8" ? "straight" : "premultiplied" });
    return handle;
  }

  uploadTexture(texture: TextureHandle, pixels: ArrayBufferView, alphaMode: AlphaMode): void {
    const gl = this.requireContext("upload-texture");
    const resource = this.requireTexture(texture, "upload-texture");
    const format = this.textureFormat(texture.descriptor);
    const uploadPixels = this.prepareUploadPixels(texture.descriptor, pixels, alphaMode);
    gl.bindTexture(gl.TEXTURE_2D, resource.texture);
    this.assertNoGlError("upload-bind");
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.assertNoGlError("upload-alpha");
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    this.assertNoGlError("upload-color-space");
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.assertNoGlError("upload-alignment");
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, texture.descriptor.width, texture.descriptor.height, format.external, format.type, uploadPixels);
    this.assertNoGlError("upload-pixels");
    gl.bindTexture(gl.TEXTURE_2D, null);
    resource.alphaMode = texture.descriptor.format === "alpha8" ? "straight" : "premultiplied";
  }

  releaseTexture(texture: TextureHandle): void {
    const resource = this.textures.get(texture.id);
    if (resource === undefined) return;
    this.textures.delete(texture.id);
    const gl = this.gl;
    if (gl !== undefined && !gl.isContextLost()) {
      gl.deleteFramebuffer(resource.framebuffer);
      gl.deleteTexture(resource.texture);
    }
    if (this.lastOutput?.id === texture.id) this.lastOutput = undefined;
  }

  readTexturePixels(texture: TextureHandle): Uint8Array {
    if (texture.descriptor.format !== "rgba8") throw lifecycleError("Stage 3 readback supports RGBA8 RenderTextures only.", "read-texture");
    const gl = this.requireContext("read-texture");
    const resource = this.requireTexture(texture, "read-texture");
    const pixels = new Uint8Array(texture.descriptor.width * texture.descriptor.height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, resource.framebuffer);
    gl.readPixels(0, 0, texture.descriptor.width, texture.descriptor.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    this.assertNoGlError("read-texture");
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return pixels;
  }

  beginFrame(context: FrameContext): void {
    if (this.state !== "ready") throw lifecycleError("A frame cannot begin in the current renderer state.", "begin-frame");
    context.signal?.throwIfAborted();
    this.requireContext("begin-frame");
    this.state = "frame";
    this.frameContext = context;
    this.lastOutput = undefined;
  }

  renderLayer(layer: LayerDefinition, context: FrameContext): RenderOutput {
    this.requireFrame(context, "render-layer");
    const target = this.createFrameTexture("intermediate");
    const resource = this.requireTexture(target, "render-layer");
    const gl = this.requireContext("render-layer");
    const color = parseColor(layer.properties.color ?? layer.properties.fill);
    const outputColor = context.colorSpace === "linear-srgb"
      ? [srgbToLinear(color[0]), srgbToLinear(color[1]), srgbToLinear(color[2]), color[3]] as const
      : color;
    gl.bindFramebuffer(gl.FRAMEBUFFER, resource.framebuffer);
    gl.viewport(0, 0, target.descriptor.width, target.descriptor.height);
    gl.clearColor(outputColor[0] * outputColor[3], outputColor[1] * outputColor[3], outputColor[2] * outputColor[3], outputColor[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.lastOutput = target;
    return { type: "texture", texture: target };
  }

  composite(inputs: readonly TextureHandle[], options: CompositeOptions, context: FrameContext): TextureHandle {
    this.requireFrame(context, "composite");
    if (inputs.length === 0) throw new RangeError("Composite requires at least one input texture.");
    let output = inputs[0]!;
    let ownedOutput = false;
    if (inputs.length === 1 && options.target !== undefined && options.target.id !== output.id) {
      this.copyTexture(output, options.target);
      output = options.target;
    }
    for (let index = 1; index < inputs.length; index += 1) {
      const source = inputs[index]!;
      const requestedTarget = index === inputs.length - 1 ? options.target : undefined;
      const target = requestedTarget !== undefined && requestedTarget.id !== output.id && requestedTarget.id !== source.id
        ? requestedTarget
        : this.createFrameTexture("intermediate");
      this.compositePair(output, source, target, options.blendMode, options.opacity);
      if (ownedOutput) this.releaseTexture(output);
      output = target;
      ownedOutput = requestedTarget?.id !== target.id;
    }
    this.lastOutput = output;
    return output;
  }

  applyMask(source: TextureHandle, mask: TextureHandle, options: WebGLMaskOptions): TextureHandle {
    return this.applyMaskStack(source, [{
      texture: mask,
      mode: options.mode,
      ...(options.inverted === undefined ? {} : { inverted: options.inverted }),
      ...(options.opacity === undefined ? {} : { opacity: options.opacity })
    }], options.target);
  }

  applyMaskStack(source: TextureHandle, masks: readonly WebGLMaskPass[], target?: TextureHandle): TextureHandle {
    this.requireActiveFrame("mask-stack");
    const enabledMasks = masks.filter((mask) => mask.mode !== "none");
    if (enabledMasks.length === 0) {
      if (target !== undefined && target.id !== source.id) this.copyTexture(source, target);
      return target ?? source;
    }
    let coverage: TextureHandle | undefined;
    let internalOutput: TextureHandle | undefined;
    try {
      for (const mask of enabledMasks) {
        if (source.descriptor.width !== mask.texture.descriptor.width || source.descriptor.height !== mask.texture.descriptor.height) {
          throw new RangeError("Mask and source texture dimensions must match.");
        }
        const nextCoverage = this.createMaskFrameTexture();
        const previous = coverage;
        const inputs = previous === undefined ? [mask.texture, mask.texture] : [previous, mask.texture];
        const mode = mask.mode === "add" ? 0 : mask.mode === "subtract" ? 1 : 2;
        try {
          this.runPass(this.requireProgram("mask-combine"), inputs, nextCoverage, (gl, program) => {
            gl.uniform1i(gl.getUniformLocation(program, "u_previous"), 0);
            gl.uniform1i(gl.getUniformLocation(program, "u_mask"), 1);
            gl.uniform1f(gl.getUniformLocation(program, "u_opacity"), Math.min(1, Math.max(0, mask.opacity ?? 1)));
            gl.uniform1i(gl.getUniformLocation(program, "u_inverted"), mask.inverted === true ? 1 : 0);
            gl.uniform1i(gl.getUniformLocation(program, "u_mask_red"), mask.texture.descriptor.format === "alpha8" ? 1 : 0);
            gl.uniform1i(gl.getUniformLocation(program, "u_has_previous"), previous === undefined ? 0 : 1);
            gl.uniform1i(gl.getUniformLocation(program, "u_mode"), mode);
          });
        } catch (cause) {
          this.releaseTexture(nextCoverage);
          throw cause;
        }
        if (previous !== undefined) this.releaseTexture(previous);
        coverage = nextCoverage;
      }
      const output = target !== undefined
        && target.id !== source.id
        && target.id !== coverage?.id
        ? target
        : this.createFrameTexture("intermediate");
      if (output !== target) internalOutput = output;
      if (coverage === undefined) throw lifecycleError("Mask coverage generation failed.", "mask-stack");
      this.runPass(this.requireProgram("mask-apply"), [source, coverage], output, (gl, program) => {
        gl.uniform1i(gl.getUniformLocation(program, "u_input"), 0);
        gl.uniform1i(gl.getUniformLocation(program, "u_coverage"), 1);
      });
      this.lastOutput = output;
      internalOutput = undefined;
      return output;
    } finally {
      if (internalOutput !== undefined) this.releaseTexture(internalOutput);
      if (coverage !== undefined) this.releaseTexture(coverage);
    }
  }

  applyEffectStack(source: TextureHandle, effects: readonly WebGLEffectPass[]): WebGLEffectStackResult {
    this.requireActiveFrame("effect-stack");
    let output = source;
    let ownedOutput = false;
    const failures: WebGLEffectFailure[] = [];
    for (const effect of effects) {
      let target: TextureHandle | undefined;
      try {
        const cacheKey = `effect:${effect.id}:${effect.fragmentSource}`;
        let program = this.programs.get(cacheKey);
        if (program === undefined) {
          program = this.compileProgram(effect.fragmentSource, `effect:${effect.id}`);
          this.programs.set(cacheKey, program);
        }
        target = this.createFrameTexture("intermediate");
        this.runPass(program, [output], target, (gl, currentProgram) => {
          gl.uniform1i(gl.getUniformLocation(currentProgram, "u_input"), 0);
          this.applyUniforms(gl, currentProgram, effect.uniforms ?? {});
        });
        if (ownedOutput) this.releaseTexture(output);
        output = target;
        ownedOutput = true;
      } catch (cause) {
        if (target !== undefined) this.releaseTexture(target);
        failures.push({
          effectId: effect.id,
          error: new EngineError(ERROR_CODES.EFFECT_EXECUTION_FAILED, "WebGL effect pass failed.", {
            cause,
            details: { effectId: effect.id, backend: this.backend }
          })
        });
      }
    }
    this.lastOutput = output;
    return { output, failures: Object.freeze(failures) };
  }

  endFrame(context: FrameContext): RenderOutput {
    this.requireFrame(context, "end-frame");
    const output = this.lastOutput;
    this.state = "ready";
    this.frameContext = undefined;
    return output === undefined ? { type: "metadata", data: {} } : { type: "texture", texture: output };
  }

  dispose(): void {
    if (this.state === "disposed") return;
    this.releaseGpuObjects();
    this.gl = undefined;
    this.frameContext = undefined;
    this.lastOutput = undefined;
    this.state = "disposed";
  }

  private createFrameTexture(usage: TextureDescriptor["usage"]): TextureHandle {
    const context = this.frameContext;
    if (context === undefined) throw lifecycleError("No frame is active.", "create-frame-texture");
    return this.createTexture({
      width: context.width,
      height: context.height,
      format: "rgba8",
      colorSpace: context.colorSpace,
      samples: 1,
      usage
    });
  }

  private createMaskFrameTexture(): TextureHandle {
    const context = this.frameContext;
    if (context === undefined) throw lifecycleError("No frame is active.", "create-mask-texture");
    return this.createTexture({
      width: context.width,
      height: context.height,
      format: "alpha8",
      colorSpace: context.colorSpace,
      samples: 1,
      usage: "mask"
    });
  }

  private textureFormat(descriptor: TextureDescriptor): { internal: number; external: number; type: number } {
    const gl = this.requireContext("texture-format");
    if (descriptor.format === "rgba16f" && !this.capabilities.supportsFloatTextures) {
      throw lifecycleError("Float RenderTextures are unavailable.", "texture-format");
    }
    if (descriptor.format === "rgba32f" && !this.capabilities.supportsFloatTextures) {
      throw lifecycleError("Float RenderTextures are unavailable.", "texture-format");
    }
    switch (descriptor.format) {
      case "rgba16f": return { internal: gl.RGBA16F, external: gl.RGBA, type: gl.HALF_FLOAT };
      case "rgba32f": return { internal: gl.RGBA32F, external: gl.RGBA, type: gl.FLOAT };
      case "alpha8": return { internal: gl.R8, external: gl.RED, type: gl.UNSIGNED_BYTE };
      default: return { internal: gl.RGBA8, external: gl.RGBA, type: gl.UNSIGNED_BYTE };
    }
  }

  private prepareUploadPixels(descriptor: TextureDescriptor, pixels: ArrayBufferView, alphaMode: AlphaMode): ArrayBufferView {
    if (descriptor.format === "alpha8" || alphaMode === "premultiplied") return pixels;
    const pixelCount = descriptor.width * descriptor.height;
    if (descriptor.format === "rgba8") {
      if (pixels.byteLength !== pixelCount * 4) throw new RangeError("RGBA8 upload byte length does not match the texture.");
      const data = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
      const output = new Uint8Array(data);
      for (let offset = 0; offset < output.length; offset += 4) {
        const alpha = alphaMode === "none" ? 255 : output[offset + 3]!;
        if (alphaMode === "straight") {
          output[offset] = Math.round(output[offset]! * alpha / 255);
          output[offset + 1] = Math.round(output[offset + 1]! * alpha / 255);
          output[offset + 2] = Math.round(output[offset + 2]! * alpha / 255);
        }
        output[offset + 3] = alpha;
      }
      return output;
    }
    if (descriptor.format === "rgba32f") {
      if (!(pixels instanceof Float32Array) || pixels.length !== pixelCount * 4) {
        throw new RangeError("RGBA32F uploads require a matching Float32Array.");
      }
      const output = new Float32Array(pixels);
      for (let offset = 0; offset < output.length; offset += 4) {
        const alpha = alphaMode === "none" ? 1 : output[offset + 3]!;
        if (alphaMode === "straight") {
          output[offset] = output[offset]! * alpha;
          output[offset + 1] = output[offset + 1]! * alpha;
          output[offset + 2] = output[offset + 2]! * alpha;
        }
        output[offset + 3] = alpha;
      }
      return output;
    }
    throw lifecycleError("Straight Alpha RGBA16F uploads must be premultiplied by the caller.", "upload-texture");
  }

  private copyTexture(source: TextureHandle, target: TextureHandle): void {
    this.runPass(this.requireProgram("copy"), [source], target, (gl, program) => {
      gl.uniform1i(gl.getUniformLocation(program, "u_input"), 0);
    });
  }

  private compositePair(backdrop: TextureHandle, source: TextureHandle, target: TextureHandle, blendMode: string, opacity: number): void {
    const modes: Record<string, number> = { normal: 0, multiply: 1, screen: 2, add: 3 };
    const mode = modes[blendMode];
    if (mode === undefined) throw lifecycleError("Blend mode is unsupported by this WebGL backend.", "composite");
    this.runPass(this.requireProgram("composite"), [backdrop, source], target, (gl, program) => {
      gl.uniform1i(gl.getUniformLocation(program, "u_backdrop"), 0);
      gl.uniform1i(gl.getUniformLocation(program, "u_source"), 1);
      gl.uniform1f(gl.getUniformLocation(program, "u_opacity"), Math.min(1, Math.max(0, opacity)));
      gl.uniform1i(gl.getUniformLocation(program, "u_blend_mode"), mode);
      gl.uniform1i(gl.getUniformLocation(program, "u_backdrop_encoded"), encoded(backdrop.descriptor.colorSpace) ? 1 : 0);
      gl.uniform1i(gl.getUniformLocation(program, "u_source_encoded"), encoded(source.descriptor.colorSpace) ? 1 : 0);
      gl.uniform1i(gl.getUniformLocation(program, "u_output_encoded"), encoded(target.descriptor.colorSpace) ? 1 : 0);
    });
  }

  private runPass(
    program: GlObject,
    inputs: readonly TextureHandle[],
    target: TextureHandle,
    uniforms: (gl: WebGL2ContextLike, program: GlObject) => void
  ): void {
    const gl = this.requireContext("render-pass");
    const targetResource = this.requireTexture(target, "render-pass");
    if (inputs.some((input) => input.id === target.id)) throw lifecycleError("A RenderTexture cannot be sampled while attached as the pass target.", "render-pass");
    this.assertNoGlError("render-pass-start");
    let failure: unknown;
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, targetResource.framebuffer);
      gl.viewport(0, 0, target.descriptor.width, target.descriptor.height);
      gl.useProgram(program);
      inputs.forEach((input, index) => {
        const resource = this.requireTexture(input, "render-pass");
        gl.activeTexture(gl.TEXTURE0 + index);
        gl.bindTexture(gl.TEXTURE_2D, resource.texture);
      });
      uniforms(gl, program);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.assertNoGlError("render-pass-draw");
    } catch (cause) {
      failure = cause;
    }
    let cleanupFailure: unknown;
    for (let index = 0; index < inputs.length; index += 1) {
      try {
        gl.activeTexture(gl.TEXTURE0 + index);
        gl.bindTexture(gl.TEXTURE_2D, null);
      } catch (cause) {
        cleanupFailure ??= cause;
      }
    }
    try { gl.activeTexture(gl.TEXTURE0); } catch (cause) { cleanupFailure ??= cause; }
    try { gl.useProgram(null); } catch (cause) { cleanupFailure ??= cause; }
    try { gl.bindFramebuffer(gl.FRAMEBUFFER, null); } catch (cause) { cleanupFailure ??= cause; }
    try { this.assertNoGlError("render-pass-cleanup"); } catch (cause) { cleanupFailure ??= cause; }
    if (failure !== undefined) throw failure;
    if (cleanupFailure !== undefined) throw cleanupFailure;
  }

  private applyUniforms(gl: WebGL2ContextLike, program: GlObject, uniforms: Readonly<Record<string, WebGLEffectUniform>>): void {
    for (const [name, value] of Object.entries(uniforms)) {
      const location = gl.getUniformLocation(program, name);
      if (typeof value === "number") gl.uniform1f(location, value);
      else if (value.length === 2) gl.uniform2fv(location, value);
      else if (value.length === 3) gl.uniform3fv(location, value);
      else gl.uniform4fv(location, value);
    }
  }

  private compileProgram(fragmentSource: string, label: string): GlObject {
    const gl = this.requireContext("shader-compile", false);
    const vertex = this.compileShader(gl.VERTEX_SHADER, VERTEX_SHADER, `${label}:vertex`);
    let fragment: GlObject | undefined;
    let program: GlObject | undefined;
    try {
      fragment = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource, `${label}:fragment`);
      program = gl.createProgram() ?? undefined;
      if (program === undefined) throw new Error("Program allocation failed.");
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw lifecycleError("WebGL program link failed.", "shader-link", gl.getProgramInfoLog(program) ?? undefined);
      }
      return program;
    } catch (cause) {
      if (program !== undefined) gl.deleteProgram(program);
      throw cause;
    } finally {
      gl.deleteShader(vertex);
      if (fragment !== undefined) gl.deleteShader(fragment);
    }
  }

  private compileShader(type: number, source: string, label: string): GlObject {
    const gl = this.requireContext("shader-compile", false);
    const shader = gl.createShader(type);
    if (shader === null) throw lifecycleError("WebGL shader allocation failed.", "shader-compile");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? "No compiler log.";
      gl.deleteShader(shader);
      throw lifecycleError(`WebGL shader compile failed (${label}).`, "shader-compile", log);
    }
    return shader;
  }

  private requireProgram(name: string): GlObject {
    const program = this.programs.get(name);
    if (program === undefined) throw lifecycleError("Required WebGL program is unavailable.", "program");
    return program;
  }

  private assertNoGlError(phase: string): void {
    const gl = this.requireContext(phase);
    const codes: number[] = [];
    for (let index = 0; index < 16; index += 1) {
      const code = gl.getError();
      if (code === gl.NO_ERROR) break;
      codes.push(code);
    }
    if (codes.length > 0) throw lifecycleError(`WebGL ${phase} reported error ${codes.join(",")}.`, phase);
  }

  private deleteUnregisteredTextureObjects(
    gl: WebGL2ContextLike,
    texture: GlObject | undefined,
    framebuffer: GlObject | undefined
  ): void {
    if (framebuffer !== undefined) {
      try { gl.deleteFramebuffer(framebuffer); } catch { /* Best-effort driver cleanup; object is never registered. */ }
    }
    if (texture !== undefined) {
      try { gl.deleteTexture(texture); } catch { /* Best-effort driver cleanup; object is never registered. */ }
    }
  }

  private requireTexture(handle: TextureHandle, phase: string): TextureResource {
    if (handle.backend !== this.backend) throw lifecycleError("Texture belongs to another renderer backend.", phase);
    const resource = this.textures.get(handle.id);
    if (resource === undefined) throw lifecycleError("Texture is unknown or already released.", phase);
    return resource;
  }

  private requireContext(phase: string, requireInitialized = true): WebGL2ContextLike {
    if (this.state === "disposed") throw lifecycleError("WebGL renderer is disposed.", phase);
    if (requireInitialized && this.state === "new") throw lifecycleError("WebGL renderer is not initialized.", phase);
    const gl = this.gl;
    if (gl === undefined) throw lifecycleError("WebGL context is unavailable.", phase);
    if (gl.isContextLost()) throw lifecycleError("WebGL context is lost.", "context-lost");
    return gl;
  }

  private requireActiveFrame(phase: string): void {
    if (this.state !== "frame") throw lifecycleError("A render pass requires an active frame.", phase);
    this.requireContext(phase);
  }

  private requireFrame(context: FrameContext, phase: string): void {
    this.requireActiveFrame(phase);
    if (this.frameContext !== context) throw lifecycleError("Frame context does not match the active frame.", phase);
    context.signal?.throwIfAborted();
  }

  private releaseGpuObjects(): void {
    const gl = this.gl;
    if (gl === undefined) return;
    if (!gl.isContextLost()) {
      for (const resource of this.textures.values()) {
        gl.deleteFramebuffer(resource.framebuffer);
        gl.deleteTexture(resource.texture);
      }
      for (const program of this.programs.values()) gl.deleteProgram(program);
      if (this.vertexArray !== undefined) gl.deleteVertexArray(this.vertexArray);
    }
    this.textures.clear();
    this.programs.clear();
    this.vertexArray = undefined;
  }
}

export interface RendererInitializationFailure {
  readonly adapterId: string;
  readonly backend: string;
  readonly error: EngineError;
}

export interface InitializedRenderer {
  readonly adapter: RendererAdapter;
  readonly failures: readonly RendererInitializationFailure[];
}

export async function initializeFirstAvailableRenderer(
  adapters: readonly RendererAdapter[],
  initialization: RendererInitialization
): Promise<InitializedRenderer> {
  const failures: RendererInitializationFailure[] = [];
  for (const adapter of adapters) {
    try {
      await adapter.initialize(initialization);
      return { adapter, failures: Object.freeze(failures) };
    } catch (cause) {
      try { await adapter.dispose(); } catch { /* Preserve the initialization failure. */ }
      failures.push({
        adapterId: adapter.id,
        backend: adapter.backend,
        error: cause instanceof EngineError
          ? cause
          : lifecycleError("Renderer backend initialization failed.", "backend-fallback", cause)
      });
    }
  }
  throw new EngineError(ERROR_CODES.RENDERER_CAPABILITY_UNAVAILABLE, "Every renderer backend failed to initialize.", {
    details: {
      failures: failures.map((failure) => ({
        adapterId: failure.adapterId,
        backend: failure.backend,
        code: failure.error.code
      })) as unknown as JsonObject["failures"]
    }
  });
}
