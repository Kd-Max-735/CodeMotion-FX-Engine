import type { MotionProject } from "@codemotion/core";
import { P0_BROWSER_PROJECT_AUTHORITY_V1 } from "@codemotion/effects-2d";
import type { BrowserProjectEnvelopeV1, EditorPreviewRequestV1 } from "@codemotion/schema";
import type { FrameContext, TextureHandle } from "@codemotion/renderer-api";
import {
  WEBGL_PIPELINE_VALIDATION_EFFECT,
  WebGLRendererAdapter,
  type WebGL2ContextLike
} from "@codemotion/renderer-webgl";
import { evaluateNumber, resolveLayerTime, secondsToFrame } from "@codemotion/timeline";
import { isLabPipelineEffect } from "./lab-effect.js";
import { authenticatedPost } from "./ai-plan-client.js";

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

interface QueuedPreviewRender {
  editableProject: BrowserProjectEnvelopeV1;
  time: number;
  target: HTMLCanvasElement;
  waiters: Array<{ resolve: (stats: PreviewStats) => void; reject: (cause: unknown) => void }>;
}

export class ProjectPreviewRenderer {
  private controller: AbortController | undefined;
  private active = false;
  private pending: QueuedPreviewRender | undefined;
  private generation = 0;

  dispose(): void {
    this.generation += 1;
    this.controller?.abort();
    this.controller = undefined;
    const aborted = new DOMException("Preview renderer disposed.", "AbortError");
    for (const waiter of this.pending?.waiters ?? []) waiter.reject(aborted);
    this.pending = undefined;
  }

  render(editableProject: BrowserProjectEnvelopeV1, time: number, target: HTMLCanvasElement): Promise<PreviewStats> {
    return new Promise<PreviewStats>((resolve, reject) => {
      if (this.active) {
        if (this.pending) {
          this.pending.editableProject = editableProject;
          this.pending.time = time;
          this.pending.target = target;
          this.pending.waiters.push({ resolve, reject });
        } else {
          this.pending = { editableProject, time, target, waiters: [{ resolve, reject }] };
        }
        return;
      }
      this.active = true;
      void this.drain({ editableProject, time, target, waiters: [{ resolve, reject }] }, this.generation);
    });
  }

  private async drain(initial: QueuedPreviewRender, generation: number): Promise<void> {
    let current: QueuedPreviewRender | undefined = initial;
    while (current && generation === this.generation) {
      try {
        const stats = await this.perform(current.editableProject, current.time, current.target);
        for (const waiter of current.waiters) waiter.resolve(stats);
      } catch (cause) {
        for (const waiter of current.waiters) waiter.reject(cause);
      }
      current = this.pending;
      this.pending = undefined;
    }
    if (current) {
      const aborted = new DOMException("Preview renderer disposed.", "AbortError");
      for (const waiter of current.waiters) waiter.reject(aborted);
    }
    this.active = false;
    this.controller = undefined;
  }

  private async perform(editableProject: BrowserProjectEnvelopeV1, time: number, target: HTMLCanvasElement): Promise<PreviewStats> {
    const controller = new AbortController();
    this.controller = controller;
    const started = performance.now();
    const project = editableProject.project;
    const aspect = project.width / project.height;
    const width = Math.min(240, project.width);
    const height = Math.max(1, Math.round(width / aspect));
    try {
      const request: EditorPreviewRequestV1 = {
        contract: "preview-request/v1",
        editableProject,
        frame: { time, width, height, quality: "preview" }
      };
      const checked = P0_BROWSER_PROJECT_AUTHORITY_V1.validateEditorPreviewRequest(request);
      if (!checked.valid) throw new Error(checked.error.message);
      const response = await fetch("/api/editor-preview", {
        ...authenticatedPost(JSON.stringify(checked.value), "application/json", controller.signal)
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.dispatchEvent(new Event("cmfx:unauthenticated"));
          throw new Error("登录已失效，请重新登录。");
        }
        if (response.status === 403) throw new Error("当前会话缺少预览权限。");
        if ([404, 409, 422, 429, 503].includes(response.status)) throw new Error("预览暂时不可用，请检查工程或稍后重试。");
        throw new Error("预览请求失败。");
      }
      if ((response.headers.get("content-type") ?? "").toLowerCase() !== "application/octet-stream"
        || response.headers.get("x-content-type-options")?.toLowerCase() !== "nosniff"
        || !response.headers.get("cache-control")?.toLowerCase().includes("no-store")
        || response.headers.get("x-cmfx-width") !== String(width)
        || response.headers.get("x-cmfx-height") !== String(height)
        || response.headers.get("x-cmfx-quality") !== "preview"
        || response.headers.get("x-cmfx-time-contract") !== "1.1.0"
        || !Number.isFinite(Number(response.headers.get("x-cmfx-time")))
        || !response.headers.get("x-cmfx-renderer")) {
        throw new Error("预览响应未通过安全校验。");
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
        drawCalls: project.compositions[0]?.layers.filter((layer) => layer.visible).length ?? 0,
        textures: project.compositions[0]?.layers.filter((layer) => layer.visible).length ?? 0,
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
    } finally {
      if (this.controller === controller) this.controller = undefined;
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
