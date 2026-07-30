import type { MotionProject } from "@codemotion/core";
import type { FrameContext, TextureHandle } from "@codemotion/renderer-api";
import {
  WEBGL_PIPELINE_VALIDATION_EFFECT,
  WebGLRendererAdapter,
  type WebGL2ContextLike
} from "@codemotion/renderer-webgl";
import { evaluateNumber, resolveLayerTime, secondsToFrame } from "@codemotion/timeline";
import { isLabPipelineEffect } from "./lab-effect.js";
import { preparePreviewProject } from "./preview-raster.js";

export interface PreviewStats {
  backend: "WebGL2" | "G5 Shared" | "Unavailable";
  cpuMs: number;
  drawCalls: number;
  textures: number;
  width: number;
  height: number;
  quality?: "draft" | "preview" | "final";
  timeContract?: "1.1.0";
  renderer?: string;
  error?: string;
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return ArrayBuffer.isView(value)
    ? Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
    : value;
}

export class ProjectPreviewRenderer {
  private controller: AbortController | undefined;

  dispose(): void {
    this.controller?.abort();
    this.controller = undefined;
  }

  async render(project: MotionProject, time: number, target: HTMLCanvasElement): Promise<PreviewStats> {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const started = performance.now();
    const aspect = project.width / project.height;
    const width = Math.min(240, project.width);
    const height = Math.max(1, Math.round(width / aspect));
    try {
      const previewProject = await preparePreviewProject(project, width, height, time);
      const response = await fetch("/api/editor-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project: previewProject, time, width, height, quality: "preview" }, jsonReplacer),
        signal: controller.signal
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as { error?: string };
        throw new Error(body.error ?? `Preview failed with HTTP ${response.status}.`);
      }
      const pixels = new Uint8ClampedArray(await response.arrayBuffer());
      if (pixels.length !== width * height * 4) throw new Error("Preview returned an invalid RGBA frame.");
      target.width = width;
      target.height = height;
      const display = target.getContext("2d");
      if (display === null) throw new Error("Canvas 2D output is unavailable.");
      display.putImageData(new ImageData(pixels, width, height), 0, 0);
      return {
        backend: "G5 Shared",
        cpuMs: Number(response.headers.get("x-cmfx-cpu-ms") ?? performance.now() - started),
        drawCalls: previewProject.compositions[0]?.layers.filter((layer) => layer.visible).length ?? 0,
        textures: previewProject.compositions[0]?.layers.filter((layer) => layer.visible).length ?? 0,
        width,
        height,
        quality: "preview",
        timeContract: "1.1.0",
        renderer: response.headers.get("x-cmfx-renderer") ?? "g5-createProjectFrameProducer"
      };
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
      return {
        backend: "Unavailable",
        cpuMs: performance.now() - started,
        drawCalls: 0,
        textures: 0,
        width,
        height,
        error: cause instanceof Error ? cause.message : String(cause)
      };
    }
  }
}

export class CorePreviewRenderer {
  private adapter: WebGLRendererAdapter | undefined;
  private readonly gpuCanvas = document.createElement("canvas");
  private width = 0;
  private height = 0;

  dispose(): void {
    this.adapter?.dispose();
    this.adapter = undefined;
  }

  private ensure(width: number, height: number): WebGLRendererAdapter {
    if (this.adapter && this.width === width && this.height === height) return this.adapter;
    this.dispose();
    this.width = width;
    this.height = height;
    this.gpuCanvas.width = width;
    this.gpuCanvas.height = height;
    const adapter = new WebGLRendererAdapter({
      id: "editor.preview.webgl2",
      contextFactory: () => this.gpuCanvas.getContext("webgl2", {
        alpha: true,
        antialias: false,
        depth: false,
        preserveDrawingBuffer: true
      }) as unknown as WebGL2ContextLike
    });
    adapter.initialize({ width, height, colorSpace: "srgb", quality: "preview" });
    this.adapter = adapter;
    return adapter;
  }

  render(project: MotionProject, time: number, target: HTMLCanvasElement, fragmentSource?: string): PreviewStats {
    const started = performance.now();
    const previewTime = Math.min(time, Math.max(0, project.duration - 1 / project.fps));
    const aspect = project.width / project.height;
    const width = Math.min(480, project.width);
    const height = Math.max(1, Math.round(width / aspect));
    target.width = width;
    target.height = height;
    const handles = new Map<string, TextureHandle>();
    let drawCalls = 0;

    try {
      const adapter = this.ensure(width, height);
      const composition = project.compositions[0];
      if (!composition) throw new Error("工程缺少主合成");
      const context: FrameContext = {
        time: previewTime,
        deltaTime: 0,
        frame: secondsToFrame(previewTime, project.fps),
        fps: project.fps,
        width,
        height,
        seed: project.seed,
        quality: "preview",
        colorSpace: "srgb"
      };
      adapter.beginFrame(context);
      const hasSolo = composition.layers.some((layer) => layer.solo && layer.visible);
      const active = composition.layers
        .filter((layer) => layer.visible && resolveLayerTime(layer, previewTime).active && (!hasSolo || layer.solo))
        .sort((left, right) => left.zIndex - right.zIndex);
      let output: TextureHandle | undefined;
      for (const layer of active) {
        const rendered = adapter.renderLayer(layer, context);
        drawCalls += 1;
        if (rendered.type !== "texture") continue;
        let layerTexture = rendered.texture;
        handles.set(layerTexture.id, layerTexture);
        if (layer.effects.some((effect) => effect.enabled && isLabPipelineEffect(effect))) {
          const effect = fragmentSource === undefined
            ? WEBGL_PIPELINE_VALIDATION_EFFECT
            : { ...WEBGL_PIPELINE_VALIDATION_EFFECT, fragmentSource };
          const result = adapter.applyEffectStack(layerTexture, [effect]);
          drawCalls += 1;
          layerTexture = result.output;
          handles.set(layerTexture.id, layerTexture);
          if (result.failures[0]) throw result.failures[0].error;
        }
        if (output === undefined) output = layerTexture;
        else {
          output = adapter.composite([output, layerTexture], {
            blendMode: layer.blendMode,
            opacity: evaluateNumber(layer.opacity, previewTime)
          }, context);
          handles.set(output.id, output);
          drawCalls += 1;
        }
      }
      adapter.endFrame(context);
      if (!output) throw new Error("当前时间没有可渲染图层");
      const pixels = adapter.readTexturePixels(output);
      const display = target.getContext("2d");
      if (!display) throw new Error("Canvas 2D 输出不可用");
      const image = display.createImageData(width, height);
      for (let y = 0; y < height; y += 1) {
        const sourceStart = (height - y - 1) * width * 4;
        image.data.set(pixels.subarray(sourceStart, sourceStart + width * 4), y * width * 4);
      }
      display.putImageData(image, 0, 0);
      for (const handle of handles.values()) adapter.releaseTexture(handle);
      return { backend: "WebGL2", cpuMs: performance.now() - started, drawCalls, textures: handles.size, width, height };
    } catch (cause) {
      for (const handle of handles.values()) this.adapter?.releaseTexture(handle);
      this.dispose();
      return {
        backend: "Unavailable",
        cpuMs: performance.now() - started,
        drawCalls,
        textures: handles.size,
        width,
        height,
        error: cause instanceof Error ? cause.message : String(cause)
      };
    }
  }
}
