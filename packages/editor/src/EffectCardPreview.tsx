import { Plus, Play } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent, type FocusEvent, type PointerEvent } from "react";
import { renderEffectCardFrame, type EffectCard, type PixelSurface } from "@codemotion/effects-2d";

interface EffectCardPreviewProps {
  readonly card: EffectCard;
  readonly canAdd: boolean;
  readonly selected?: boolean;
  readonly disabledReason?: string;
  readonly addTitle: string;
  readonly actionLabel?: string;
  readonly onAdd: () => void;
  readonly onDragStart: (event: DragEvent<HTMLElement>) => void;
}

interface PreviewSurfaces {
  readonly butterfly: PixelSurface;
  readonly phoenix: PixelSurface;
}

let previewSurfacesPromise: Promise<PreviewSurfaces> | undefined;

function loadSurface(source: string): Promise<PixelSurface> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      const width = 160;
      const height = 90;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return reject(new Error("卡片图片解码画布不可用。"));
      const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
      const drawWidth = image.naturalWidth * scale;
      const drawHeight = image.naturalHeight * scale;
      context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
      resolve({
        width,
        height,
        data: context.getImageData(0, 0, width, height).data,
        colorSpace: "srgb",
        alphaMode: "straight"
      });
    };
    image.onerror = () => reject(new Error("卡片演示图片加载失败。"));
    image.src = source;
  });
}

function previewSurfaces(): Promise<PreviewSurfaces> {
  previewSurfacesPromise ??= Promise.all([
    loadSurface("/sample-cards/butterfly.png"),
    loadSurface("/sample-cards/phoenix.png")
  ]).then(([butterfly, phoenix]) => ({ butterfly, phoenix }));
  return previewSurfacesPromise;
}

function over(background: PixelSurface, foreground: PixelSurface): PixelSurface {
  const data = new Uint8ClampedArray(background.data);
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = foreground.data[offset + 3]! / 255;
    const inverse = 1 - alpha;
    data[offset] = Math.round(foreground.data[offset]! * alpha + data[offset]! * inverse);
    data[offset + 1] = Math.round(foreground.data[offset + 1]! * alpha + data[offset + 1]! * inverse);
    data[offset + 2] = Math.round(foreground.data[offset + 2]! * alpha + data[offset + 2]! * inverse);
    data[offset + 3] = 255;
  }
  return { ...background, data };
}

function drawFrame(card: EffectCard, canvas: HTMLCanvasElement, progress: number, surfaces: PreviewSurfaces): void {
  const rendered = renderEffectCardFrame(card, progress, card.fixture.inputKind === "media" ? {
    primarySurface: surfaces.butterfly,
    ...(card.fixture.secondaryInput ? { secondarySurface: surfaces.phoenix } : {})
  } : {});
  const frame = card.fixture.inputKind === "text" ? over(surfaces.butterfly, rendered) : rendered;
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Card preview Canvas 2D is unavailable.");
  const image = context.createImageData(frame.width, frame.height);
  image.data.set(frame.data);
  context.putImageData(image, 0, 0);
  canvas.dataset.previewProgress = progress.toFixed(3);
}

export function EffectCardPreview({ card, canAdd, selected = false, disabledReason, addTitle, actionLabel = "添加", onAdd, onDragStart }: EffectCardPreviewProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string>();
  const [surfaces, setSurfaces] = useState<PreviewSurfaces>();

  useEffect(() => {
    let active = true;
    void previewSurfaces().then((value) => {
      if (active) setSurfaces(value);
    }, (cause) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const target = canvas.current;
    if (!target || !surfaces) return;
    let frameId = 0;
    let started = 0;
    const render = (progress: number) => {
      try {
        drawFrame(card, target, progress, surfaces);
        setError(undefined);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    if (!playing) {
      render(card.thumbnail.representativeProgress);
      return;
    }
    const tick = (now: number) => {
      if (started === 0) started = now;
      const progress = ((now - started) / (card.defaultDuration * 1000)) % 1;
      render(progress);
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [card, playing, surfaces]);

  const leaveFocus = (event: FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setPlaying(false);
  };
  const touchPreview = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== "mouse") setPlaying((current) => !current);
  };

  return <article
    className={`sample-effect-card${playing ? " previewing" : ""}${selected ? " selected" : ""}`}
    data-card-id={card.id}
    data-effect-id={card.effectId}
    data-preview-active={playing ? "true" : "false"}
    draggable={canAdd}
    onDragStart={onDragStart}
    onMouseEnter={() => setPlaying(true)}
    onMouseLeave={() => setPlaying(false)}
    onFocus={() => setPlaying(true)}
    onBlur={leaveFocus}
  >
    <button className="sample-card-preview" aria-label={`预览${card.name}`} onPointerDown={touchPreview}>
      <canvas ref={canvas} aria-label={card.preview.alt} />
      <span className="preview-state"><Play size={13} fill="currentColor" />实时预览</span>
      {error && <span className="preview-error" role="alert">预览失败</span>}
    </button>
    <div className="sample-card-copy">
      <div className="sample-card-title"><span><b>{card.name}</b><small>{card.effectId}</small></span><span className={`performance-chip ${card.performanceClass}`}>{card.performanceClass === "light" ? "轻量" : card.performanceClass === "medium" ? "标准" : "高性能"}</span></div>
      <p>{card.description}</p>
      <small className="sample-card-input">{card.fixture.secondaryInput ? "需要 2 个不同视觉素材" : card.fixture.inputKind === "text" ? "需要 1 个视觉素材和明确新增文字" : card.fixture.inputKind === "vector" ? "需要 1 个视觉素材；预览使用真实矢量路径" : "需要 1 个视觉素材"}</small>
      {!canAdd && disabledReason && <small className="sample-card-disabled" role="status">{disabledReason}</small>}
      <div className="sample-card-tags"><span>{card.categoryLabel}</span>{card.tags.slice(0, 3).map((tag) => <i key={tag}>{tag}</i>)}</div>
    </div>
    <button className="sample-card-add" disabled={!canAdd} aria-pressed={selected} title={addTitle} aria-label={`${addTitle}：${card.name}`} onClick={onAdd}>
      <Plus size={14} />{actionLabel}
    </button>
  </article>;
}
