import type { WebGL2ContextLike } from "../src/index.js";

interface FakeObject {
  readonly id: number;
  readonly kind: string;
}

export class FakeWebGL2Context implements WebGL2ContextLike {
  readonly VERTEX_SHADER = 1;
  readonly FRAGMENT_SHADER = 2;
  readonly COMPILE_STATUS = 3;
  readonly LINK_STATUS = 4;
  readonly TEXTURE_2D = 5;
  readonly TEXTURE0 = 100;
  readonly TEXTURE_MIN_FILTER = 6;
  readonly TEXTURE_MAG_FILTER = 7;
  readonly TEXTURE_WRAP_S = 8;
  readonly TEXTURE_WRAP_T = 9;
  readonly LINEAR = 10;
  readonly CLAMP_TO_EDGE = 11;
  readonly RGBA = 12;
  readonly RED = 13;
  readonly RGBA8 = 14;
  readonly RGBA16F = 15;
  readonly RGBA32F = 16;
  readonly R8 = 17;
  readonly UNSIGNED_BYTE = 18;
  readonly HALF_FLOAT = 19;
  readonly FLOAT = 20;
  readonly FRAMEBUFFER = 21;
  readonly COLOR_ATTACHMENT0 = 22;
  readonly FRAMEBUFFER_COMPLETE = 23;
  readonly TRIANGLES = 24;
  readonly COLOR_BUFFER_BIT = 25;
  readonly MAX_TEXTURE_SIZE = 26;
  readonly UNPACK_PREMULTIPLY_ALPHA_WEBGL = 27;
  readonly UNPACK_COLORSPACE_CONVERSION_WEBGL = 28;
  readonly UNPACK_ALIGNMENT = 29;
  readonly NONE = 0;
  readonly NO_ERROR = 0;

  contextLost = false;
  supportsFloatTextures = true;
  framebufferComplete = true;
  failNextTextureCreation = false;
  failNextFramebufferCreation = false;
  throwNextTexImage2D = false;
  drawCalls = 0;
  activeTextureUnit = this.TEXTURE0;
  boundFramebuffer: object | null = null;
  currentProgram: object | null = null;
  readonly boundTextures = new Map<number, object | null>();
  readonly createdTextures: object[] = [];
  readonly createdFramebuffers: object[] = [];
  readonly deletedTextures: object[] = [];
  readonly deletedFramebuffers: object[] = [];
  readonly deletedPrograms: object[] = [];
  readonly drawInputTextures: Array<object | null> = [];
  readonly pixelStore = new Map<number, number | boolean>();
  lastUpload: ArrayBufferView | undefined;
  private sequence = 0;
  private drawErrorCall: number | undefined;
  private drawErrorCode = 1282;
  private readonly errors: number[] = [];
  private readonly shaderSources = new Map<object, string>();
  private readonly compiled = new Map<object, boolean>();

  private object(kind: string): FakeObject {
    return { id: ++this.sequence, kind };
  }

  injectDrawErrorOnce(drawCall: number, code = 1282): void {
    this.drawErrorCall = drawCall;
    this.drawErrorCode = code;
  }

  createTexture(): object | null {
    if (this.failNextTextureCreation) {
      this.failNextTextureCreation = false;
      return null;
    }
    const texture = this.object("texture");
    this.createdTextures.push(texture);
    return texture;
  }
  deleteTexture(texture: object): void { this.deletedTextures.push(texture); }
  bindTexture(_target: number, texture: object | null): void { this.boundTextures.set(this.activeTextureUnit, texture); }
  texParameteri(): void {}
  texImage2D(): void {
    if (this.throwNextTexImage2D) {
      this.throwNextTexImage2D = false;
      throw new Error("synthetic texImage2D failure");
    }
  }
  texSubImage2D(_target: number, _level: number, _x: number, _y: number, _width: number, _height: number, _format: number, _type: number, pixels: ArrayBufferView): void { this.lastUpload = pixels; }
  pixelStorei(parameter: number, value: number | boolean): void { this.pixelStore.set(parameter, value); }
  createFramebuffer(): object | null {
    if (this.failNextFramebufferCreation) {
      this.failNextFramebufferCreation = false;
      return null;
    }
    const framebuffer = this.object("framebuffer");
    this.createdFramebuffers.push(framebuffer);
    return framebuffer;
  }
  deleteFramebuffer(framebuffer: object): void { this.deletedFramebuffers.push(framebuffer); }
  bindFramebuffer(_target: number, framebuffer: object | null): void { this.boundFramebuffer = framebuffer; }
  framebufferTexture2D(): void {}
  checkFramebufferStatus(): number { return this.framebufferComplete ? this.FRAMEBUFFER_COMPLETE : -1; }
  createShader(): object { return this.object("shader"); }
  shaderSource(shader: object, source: string): void { this.shaderSources.set(shader, source); }
  compileShader(shader: object): void { this.compiled.set(shader, !this.shaderSources.get(shader)?.includes("INVALID_SHADER")); }
  getShaderParameter(shader: object): unknown { return this.compiled.get(shader) === true; }
  getShaderInfoLog(shader: object): string | null { return this.compiled.get(shader) === true ? null : "synthetic compiler failure"; }
  deleteShader(): void {}
  createProgram(): object { return this.object("program"); }
  attachShader(): void {}
  linkProgram(): void {}
  getProgramParameter(): unknown { return true; }
  getProgramInfoLog(): string | null { return null; }
  deleteProgram(program: object): void { this.deletedPrograms.push(program); }
  useProgram(program: object | null): void { this.currentProgram = program; }
  getUniformLocation(): object { return this.object("uniform"); }
  uniform1i(): void {}
  uniform1f(): void {}
  uniform2fv(): void {}
  uniform3fv(): void {}
  uniform4fv(): void {}
  activeTexture(texture: number): void { this.activeTextureUnit = texture; }
  viewport(): void {}
  drawArrays(): void {
    this.drawCalls += 1;
    this.drawInputTextures.push(this.boundTextures.get(this.TEXTURE0) ?? null);
    if (this.drawErrorCall === this.drawCalls) {
      this.errors.push(this.drawErrorCode);
      this.drawErrorCall = undefined;
    }
  }
  clearColor(): void {}
  clear(): void {}
  readPixels(_x: number, _y: number, _width: number, _height: number, _format: number, _type: number, pixels: ArrayBufferView): void {
    if (pixels instanceof Uint8Array) pixels.fill(0);
  }
  createVertexArray(): object { return this.object("vertex-array"); }
  bindVertexArray(): void {}
  deleteVertexArray(): void {}
  getParameter(): unknown { return 8192; }
  getExtension(name: string): unknown { return name === "EXT_color_buffer_float" && !this.supportsFloatTextures ? null : {}; }
  getError(): number { return this.errors.shift() ?? this.NO_ERROR; }
  isContextLost(): boolean { return this.contextLost; }
}
