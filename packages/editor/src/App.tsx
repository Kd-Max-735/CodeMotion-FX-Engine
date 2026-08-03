import {
  Activity,
  ArrowDown,
  ArrowUp,
  Box,
  Check,
  ChevronDown,
  CirclePlay,
  Clock3,
  Copy,
  Download,
  Eye,
  EyeOff,
  FlaskConical,
  FolderOpen,
  Grid3X3,
  Image,
  KeyRound,
  Layers3,
  Lock,
  Maximize2,
  MousePointer2,
  Pause,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  Unlock,
  Upload,
  Users,
  X,
  Zap
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { evaluateAnimatable } from "@codemotion/timeline";
import type { JsonValue, LayerDefinition, MotionProject, Vector3 } from "@codemotion/core";
import { EFFECT_DRAG_MIME, isLabPipelineEffect } from "./lab-effect.js";
import {
  P0_EDITOR_EFFECTS,
  effectDefinition,
  effectParameterFields,
  projectResourceIds,
  type EffectParameterField
} from "./effect-catalog.js";
import { canvasLayerRect, findLayer, layerPropertySections, locateProjectError, mainLayers, pipelineEffect, topLayerInCanvasRect, type CanvasLayerRect, type PropertyFieldSchema } from "./model.js";
import { CorePreviewRenderer, ProjectPreviewRenderer, type PreviewStats } from "./preview-renderer.js";
import { RenderCenter } from "./RenderCenter.js";
import { AiPlanner } from "./AiPlanner.js";
import { EditorStore } from "./store.js";

interface AppProps { store: EditorStore }

const IconButton = ({ label, disabled, onClick, children, active = false, pressed }: {
  label: string;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  active?: boolean;
  pressed?: boolean;
}) => (
  <button className={`icon-button${active ? " active" : ""}`} aria-label={label} aria-pressed={pressed} title={label} disabled={disabled} onClick={onClick}>
    {children}
  </button>
);

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`brand${compact ? " compact" : ""}`}><span className="brand-mark">CM</span><span>CodeMotion <b>FX</b></span></div>;
}

export function App({ store }: AppProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return (
    <div className="app-shell">
      {snapshot.view === "workbench" && <Workbench store={store} />}
      {snapshot.view === "editor" && <Editor store={store} />}
      {snapshot.view === "lab" && <EffectLab store={store} />}
      {snapshot.view === "render-center" && <RenderCenter store={store} />}
      {snapshot.view === "ai-planner" && <AiPlanner store={store} />}
    </div>
  );
}

function Workbench({ store }: AppProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [preset, setPreset] = useState("16:9");
  const [name, setName] = useState("品牌动效 01");
  const [fps, setFps] = useState(30);
  const [customWidth, setCustomWidth] = useState(1920);
  const [customHeight, setCustomHeight] = useState(1080);
  const fileInput = useRef<HTMLInputElement>(null);
  const sizes: Record<string, [number, number]> = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080], "自定义": [customWidth, customHeight] };
  const [width, height] = sizes[preset]!;

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { store.importProject(await file.text()); }
    catch (error) { store.reportError(locateProjectError(error, snapshot.document.project)); }
  };

  return (
    <main className="workbench">
      <header className="workbench-header">
        <Brand />
        <nav className="workbench-nav" aria-label="工作台导航">
          <button className="nav-current">项目</button><button>素材库</button><button>团队空间</button>
        </nav>
        <button className="avatar-button" title="本地工作区">KD</button>
      </header>
      {snapshot.recoverable && (
        <section className="recovery-bar" role="status">
          <RotateCcw size={17} /><span>检测到最近的自动保存版本</span>
          <button className="text-button" onClick={() => store.recover()}>恢复</button>
          <IconButton label="忽略恢复版本" onClick={() => store.dismissRecovery()}><X size={16} /></IconButton>
        </section>
      )}
      {snapshot.error && <section className="error-strip" role="alert">{snapshot.error.message}</section>}
      <div className="workbench-content">
        <section className="new-project-band">
          <div className="section-heading"><div><span className="eyebrow">PROJECT WORKSPACE</span><h1>开始创作</h1></div><button className="secondary-command" onClick={() => fileInput.current?.click()}><Upload size={16} />导入工程</button></div>
          <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={importFile} />
          <div className="creator-grid">
            <div className="project-fields">
              <label>项目名称<input value={name} onChange={(event) => setName(event.target.value)} /></label>
              <div className="field-row">
                <label>帧率<select value={fps} onChange={(event) => setFps(Number(event.target.value))}><option>24</option><option>25</option><option>30</option><option>50</option><option>60</option></select></label>
                <label>尺寸<strong>{width} × {height}</strong></label>
              </div>
            </div>
            <div className="preset-selector" aria-label="画布比例">
              {Object.keys(sizes).map((item) => <button key={item} className={preset === item ? "selected" : ""} onClick={() => setPreset(item)}><span className={`ratio-shape ratio-${item.replace(":", "-")}`} /><b>{item}</b></button>)}
            </div>
            {preset === "自定义" && <div className="custom-size"><input aria-label="自定义宽度" type="number" value={customWidth} onChange={(event) => setCustomWidth(Number(event.target.value))} /><span>×</span><input aria-label="自定义高度" type="number" value={customHeight} onChange={(event) => setCustomHeight(Number(event.target.value))} /></div>}
            <button className="primary-command" onClick={() => store.newProject(name || "未命名项目", width, height, fps)}><Plus size={17} />新建工程</button>
          </div>
          <div className="ai-draft-bar"><Sparkles size={17} /><span>文本、图片、音频与视频规划</span><button onClick={() => store.setView("ai-planner")}>打开 AI 规划</button></div>
        </section>
        <section className="workspace-section">
          <div className="section-heading"><div><span className="eyebrow">RECENT</span><h2>最近项目</h2></div></div>
          <div className="recent-grid">
            <button className="project-tile featured" onClick={() => store.setView("editor")}>
              <span className="project-thumb"><span>CM</span><i /></span><span className="tile-meta"><b>{snapshot.document.project.name}</b><small>{snapshot.document.project.width} × {snapshot.document.project.height} · {snapshot.document.project.fps} FPS</small></span>
            </button>
            {store.recents().slice(0, 2).map((recent) => <button key={recent.id} className="project-tile" onClick={() => store.recover()}><span className="project-thumb alt"><Clock3 size={28} /></span><span className="tile-meta"><b>{recent.name}</b><small>{new Date(recent.savedAt).toLocaleString()}</small></span></button>)}
            <button className="project-tile empty" onClick={() => fileInput.current?.click()}><FolderOpen size={24} /><span>打开本地工程</span></button>
          </div>
        </section>
        <div className="workbench-lower">
          <section className="workspace-section templates"><div className="section-heading"><div><span className="eyebrow">TEMPLATES</span><h2>模板市场</h2></div></div><div className="template-row"><button onClick={() => store.newProject("数据发布", 1920, 1080, 30)}><Activity /><span><b>数据发布</b><small>16:9 · 8 秒</small></span></button><button onClick={() => store.newProject("竖屏标题", 1080, 1920, 30)}><Sparkles /><span><b>竖屏标题</b><small>9:16 · 8 秒</small></span></button><button onClick={() => store.setView("lab")}><FlaskConical /><span><b>特效实验室</b><small>WebGL 管线</small></span></button></div></section>
          <aside className="render-queue"><div className="section-heading"><div><span className="eyebrow">RENDER QUEUE</span><h2>渲染任务</h2></div></div><button className="queue-empty" onClick={() => store.setView("render-center")}><ShieldCheck size={21} /><span><b>打开渲染中心</b><small>本地真实 exporter / FFmpeg</small></span></button></aside>
        </div>
      </div>
    </main>
  );
}

function Editor({ store }: AppProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const project = snapshot.document.project;
  useEffect(() => {
    if (!snapshot.playing) return;
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const next = snapshot.currentTime + (now - previous) / 1000;
      previous = now;
      store.setTime(next >= project.duration ? 0 : next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [snapshot.playing, project.duration]);

  const downloadProject = () => {
    const url = URL.createObjectURL(new Blob([store.exportJson()], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project.name}.cmfx.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="editor-shell">
      <header className="editor-toolbar">
        <button className="brand-button" title="返回工作台" onClick={() => store.setView("workbench")}><Brand compact /></button>
        <div className="project-crumb"><small>项目</small><b>{project.name}</b><ChevronDown size={13} /></div>
        <span className={`save-indicator ${snapshot.saveStatus}`}><i />{snapshot.saveStatus === "saved" ? "已自动保存" : snapshot.saveStatus === "saving" ? "保存中" : snapshot.saveStatus === "error" ? "保存失败" : "有改动"}</span>
        <div className="toolbar-group"><IconButton label="撤销" disabled={!store.canUndo} onClick={() => store.undo()}><Undo2 size={17} /></IconButton><IconButton label="重做" disabled={!store.canRedo} onClick={() => store.redo()}><Redo2 size={17} /></IconButton></div>
        <div className="transport"><IconButton label={snapshot.playing ? "暂停" : "播放"} active={snapshot.playing} onClick={() => store.setPlaying(!snapshot.playing)}>{snapshot.playing ? <Pause size={17} /> : <Play size={17} />}</IconButton><b>{formatTime(snapshot.currentTime, project.fps)}</b></div>
        <div className="toolbar-meta"><span>PREVIEW</span><span>{project.width} × {project.height}</span><span>{project.fps} FPS</span></div>
        <div className="toolbar-group"><IconButton label="AI 动画规划" onClick={() => store.setView("ai-planner")}><Sparkles size={17} /></IconButton><IconButton label="特效实验室" onClick={() => store.setView("lab")}><FlaskConical size={17} /></IconButton><button className="secondary-command render-button" onClick={() => store.setView("render-center")}><CirclePlay size={16} />渲染</button><button className="export-button" onClick={downloadProject}><Download size={16} />工程</button></div>
      </header>
      {snapshot.error && <div className="error-strip" role="alert"><Zap size={16} /><button onClick={() => snapshot.error?.layerId && store.selectLayer(snapshot.error.layerId)}><b>{snapshot.error.message}</b><span>{[snapshot.error.layerId, snapshot.error.effectId, snapshot.error.parameter].filter(Boolean).join(" / ") || snapshot.error.path}</span></button><IconButton label="关闭错误" onClick={() => store.clearError()}><X size={15} /></IconButton></div>}
      <div className="editor-body">
        <LayerPanel store={store} />
        <CanvasViewport store={store} />
        <PropertyPanel store={store} />
      </div>
      <Timeline store={store} />
    </main>
  );
}

function LayerPanel({ store }: AppProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [tab, setTab] = useState<"layers" | "effects">("layers");
  const [search, setSearch] = useState("");
  const layers = [...mainLayers(snapshot.document.project)].sort((a, b) => b.zIndex - a.zIndex);
  const selectedLayerId = snapshot.document.selectedLayerId;
  const catalog = P0_EDITOR_EFFECTS.filter((effect) =>
    `${effect.sourceId} ${effect.displayName} ${effect.category} ${effect.tags.join(" ")}`
      .toLowerCase().includes(search.toLowerCase())
  );
  const dropEffect = (event: DragEvent, layerId: string) => {
    event.preventDefault();
    const effectId = event.dataTransfer.getData(EFFECT_DRAG_MIME);
    if (P0_EDITOR_EFFECTS.some((effect) => effect.effectId === effectId)) store.addEffect(layerId, effectId);
  };
  return (
    <aside className="left-panel panel-surface">
      <div className="panel-tabs"><button className={tab === "layers" ? "active" : ""} onClick={() => setTab("layers")}><Layers3 size={15} />图层</button><button className={tab === "effects" ? "active" : ""} onClick={() => setTab("effects")}><Zap size={15} />特效</button></div>
      {tab === "layers" ? <>
        <div className="panel-title"><span>{layers.length} 个图层</span><div><IconButton label="复制选中图层" disabled={!snapshot.document.selectedLayerId} onClick={() => snapshot.document.selectedLayerId && store.duplicateLayer(snapshot.document.selectedLayerId)}><Copy size={14} /></IconButton><IconButton label="删除选中图层" disabled={!snapshot.document.selectedLayerId || layers.length <= 1} onClick={() => snapshot.document.selectedLayerId && store.deleteLayer(snapshot.document.selectedLayerId)}><Trash2 size={14} /></IconButton><IconButton label="新建图层" onClick={() => store.addLayer()}><Plus size={15} /></IconButton></div></div>
        <div className="layer-list">{layers.map((layer) => (
          <div key={layer.id} className={`layer-row${snapshot.document.selectedLayerId === layer.id ? " selected" : ""}`} onClick={() => store.selectLayer(layer.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropEffect(event, layer.id)}>
            <span className={`layer-color color-${layer.zIndex % 3}`} />
            <span className="layer-icon">{layer.type === "text" ? "T" : <Box size={14} />}</span>
            <span className="layer-name"><b>{layer.name}</b><small>{layer.type}</small></span>
            <IconButton label={layer.visible ? "隐藏图层" : "显示图层"} onClick={() => store.toggleLayer(layer.id, "visible")}>{layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}</IconButton>
            <IconButton label={layer.locked ? "解锁图层" : "锁定图层"} onClick={() => store.toggleLayer(layer.id, "locked")}>{layer.locked ? <Lock size={14} /> : <Unlock size={14} />}</IconButton>
            <IconButton label={layer.solo ? "取消独奏" : "独奏图层"} active={layer.solo} onClick={() => store.toggleLayer(layer.id, "solo")}><span className="solo-icon">S</span></IconButton>
            <div className="layer-order"><IconButton label="上移图层" onClick={() => store.reorderLayer(layer.id, 1)}><ArrowUp size={13} /></IconButton><IconButton label="下移图层" onClick={() => store.reorderLayer(layer.id, -1)}><ArrowDown size={13} /></IconButton></div>
          </div>
        ))}</div>
      </> : <>
        <label className="search-box"><Search size={15} /><input placeholder="搜索效果" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <div className="effect-catalog">{catalog.map((effect) => <button
          key={effect.effectId}
          className="effect-item"
          draggable
          disabled={!selectedLayerId}
          title={selectedLayerId ? `添加到 ${selectedLayerId}` : "请先选择图层"}
          onClick={() => selectedLayerId && store.addEffect(selectedLayerId, effect.effectId)}
          onDragStart={(event) => event.dataTransfer.setData(EFFECT_DRAG_MIME, effect.effectId)}
        ><span className="effect-icon"><Zap size={16} /></span><span><b>{effect.displayName}</b><small>{effect.sourceId} · {effect.category}</small></span><span className="status-chip">P0</span></button>)}</div>
        <div className="catalog-note"><span>效果目录</span><b>{P0_EDITOR_EFFECTS.length} / 40</b><small>点击或拖拽添加正式 P0 效果</small></div>
      </>}
    </aside>
  );
}

function CanvasViewport({ store }: AppProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useMemo(() => new ProjectPreviewRenderer(), []);
  const [stats, setStats] = useState<PreviewStats>({ backend: "Unavailable", cpuMs: 0, drawCalls: 0, textures: 0, width: 0, height: 0 });
  const [tool, setTool] = useState<"pointer" | "frame">("pointer");
  const [grid, setGrid] = useState(false);
  const [marquee, setMarquee] = useState<{ pointerId: number; startX: number; startY: number; x: number; y: number }>();
  const resize = useRef<{ pointerId: number; corner: "nw" | "ne" | "sw" | "se"; clientX: number; clientY: number; rect: CanvasLayerRect } | undefined>(undefined);
  const project = snapshot.document.project;
  const selected = findLayer(project, snapshot.document.selectedLayerId);
  useEffect(() => {
    let active = true;
    const frame = requestAnimationFrame(() => {
      if (active && canvas.current) {
        void renderer.render(project, snapshot.currentTime, canvas.current)
          .then((next) => { if (active) setStats(next); })
          .catch((cause) => {
            if (active && (!(cause instanceof DOMException) || cause.name !== "AbortError")) {
              setStats({ backend: "Unavailable", cpuMs: 0, drawCalls: 0, textures: 0, width: 0, height: 0, error: String(cause) });
            }
          });
      }
    });
    return () => {
      active = false;
      cancelAnimationFrame(frame);
    };
  }, [renderer, project, snapshot.currentTime, snapshot.revision]);
  useEffect(() => () => renderer.dispose(), [renderer]);
  const selectionRect = selected ? canvasLayerRect(project, selected, snapshot.currentTime) : undefined;
  const dropEffect = (event: DragEvent) => {
    event.preventDefault();
    const effectId = event.dataTransfer.getData(EFFECT_DRAG_MIME);
    if (selected && P0_EDITOR_EFFECTS.some((effect) => effect.effectId === effectId)) store.addEffect(selected.id, effectId);
  };
  const canvasPoint = (event: ReactPointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(project.width, (event.clientX - rect.left) / rect.width * project.width)),
      y: Math.max(0, Math.min(project.height, (event.clientY - rect.top) / rect.height * project.height))
    };
  };
  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (tool === "pointer") { store.clearSelection(); return; }
    const point = canvasPoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    setMarquee({ pointerId: event.pointerId, startX: point.x, startY: point.y, x: point.x, y: point.y });
  };
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!marquee || marquee.pointerId !== event.pointerId) return;
    const point = canvasPoint(event);
    setMarquee({ ...marquee, x: point.x, y: point.y });
  };
  const finishMarquee = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    if (!marquee || marquee.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!cancelled) {
      const left = Math.min(marquee.startX, marquee.x);
      const top = Math.min(marquee.startY, marquee.y);
      const area = { left, top, width: Math.abs(marquee.x - marquee.startX), height: Math.abs(marquee.y - marquee.startY) };
      const hit = area.width < project.width * 0.005 && area.height < project.height * 0.005
        ? undefined : topLayerInCanvasRect(project, snapshot.currentTime, area);
      if (hit) store.selectLayer(hit.id); else store.clearSelection();
    }
    setMarquee(undefined);
  };
  const resizeDown = (corner: "nw" | "ne" | "sw" | "se", event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!selectionRect || !selected || selected.locked || event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    resize.current = { pointerId: event.pointerId, corner, clientX: event.clientX, clientY: event.clientY, rect: selectionRect };
  };
  const resizeMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = resize.current;
    if (!drag || drag.pointerId !== event.pointerId || !selected) return;
    event.stopPropagation();
    const frame = event.currentTarget.closest(".canvas-frame")?.getBoundingClientRect();
    if (!frame) return;
    const dx = (event.clientX - drag.clientX) / frame.width * project.width;
    const dy = (event.clientY - drag.clientY) / frame.height * project.height;
    let left = drag.rect.left;
    let right = drag.rect.left + drag.rect.width;
    let top = drag.rect.top;
    let bottom = drag.rect.top + drag.rect.height;
    const minWidth = project.width * 0.02;
    const minHeight = project.height * 0.02;
    if (drag.corner.includes("w")) left = Math.max(0, Math.min(right - minWidth, left + dx));
    else right = Math.min(project.width, Math.max(left + minWidth, right + dx));
    if (drag.corner.includes("n")) top = Math.max(0, Math.min(bottom - minHeight, top + dy));
    else bottom = Math.min(project.height, Math.max(top + minHeight, bottom + dy));
    store.updateLayerGeometry(
      selected.id,
      (left + right) / 2 - project.width / 2,
      (top + bottom) / 2 - project.height / 2,
      (right - left) / (project.width * 0.36) * 100,
      (bottom - top) / (project.height * 0.36) * 100
    );
  };
  const resizeEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (resize.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    resize.current = undefined;
  };
  const marqueeRect = marquee ? {
    left: Math.min(marquee.startX, marquee.x), top: Math.min(marquee.startY, marquee.y),
    width: Math.abs(marquee.x - marquee.startX), height: Math.abs(marquee.y - marquee.startY)
  } : undefined;
  return (
    <section className="canvas-workspace" onDragOver={(event) => event.preventDefault()} onDrop={dropEffect}>
      <div className="canvas-toolbar"><div className="tool-segment"><IconButton label="选择工具" active={tool === "pointer"} pressed={tool === "pointer"} onClick={() => setTool("pointer")}><MousePointer2 size={16} /></IconButton><IconButton label="框选工具" active={tool === "frame"} pressed={tool === "frame"} onClick={() => setTool("frame")}><Square size={16} /></IconButton><IconButton label="网格" active={grid} pressed={grid} onClick={() => setGrid((value) => !value)}><Grid3X3 size={16} /></IconButton></div><span className={`backend-status ${stats.backend === "G5 Shared" ? "ok" : "fail"}`}><i />{stats.backend}{stats.timeContract && ` · Time ${stats.timeContract}`}</span><div className="zoom-control"><IconButton label="适合画布" onClick={() => store.setZoom(52)}><Maximize2 size={15} /></IconButton><input aria-label="画布缩放" type="range" min="15" max="200" value={snapshot.zoom} onChange={(event) => store.setZoom(Number(event.target.value))} /><b>{snapshot.zoom}%</b></div></div>
      <div className="canvas-stage">
        <div className={`canvas-frame tool-${tool}`} style={{ width: `${snapshot.zoom}%`, aspectRatio: `${project.width}/${project.height}` }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={(event) => finishMarquee(event)} onPointerCancel={(event) => finishMarquee(event, true)}>
          <canvas ref={canvas} aria-label="WebGL 合成预览" />
          {grid && <div className="canvas-grid" aria-hidden="true" />}
          <div className="safe-area" />
          {selected && selectionRect && <div className="selection-box" onPointerDown={(event) => event.stopPropagation()} style={{ left: `${selectionRect.left / project.width * 100}%`, top: `${selectionRect.top / project.height * 100}%`, width: `${selectionRect.width / project.width * 100}%`, height: `${selectionRect.height / project.height * 100}%` }}><button aria-label="左上缩放控制柄" className="handle nw" onPointerDown={(event) => resizeDown("nw", event)} onPointerMove={resizeMove} onPointerUp={resizeEnd} onPointerCancel={resizeEnd} /><button aria-label="右上缩放控制柄" className="handle ne" onPointerDown={(event) => resizeDown("ne", event)} onPointerMove={resizeMove} onPointerUp={resizeEnd} onPointerCancel={resizeEnd} /><button aria-label="左下缩放控制柄" className="handle sw" onPointerDown={(event) => resizeDown("sw", event)} onPointerMove={resizeMove} onPointerUp={resizeEnd} onPointerCancel={resizeEnd} /><button aria-label="右下缩放控制柄" className="handle se" onPointerDown={(event) => resizeDown("se", event)} onPointerMove={resizeMove} onPointerUp={resizeEnd} onPointerCancel={resizeEnd} /><label>{selected.name}</label></div>}
          {marqueeRect && <div className="marquee-box" style={{ left: `${marqueeRect.left / project.width * 100}%`, top: `${marqueeRect.top / project.height * 100}%`, width: `${marqueeRect.width / project.width * 100}%`, height: `${marqueeRect.height / project.height * 100}%` }} />}
          {stats.error && <div className="canvas-error"><Zap size={20} /><b>预览失败</b><span>{stats.error}</span></div>}
        </div>
      </div>
      <div className="canvas-footer"><span><Activity size={14} />CPU {stats.cpuMs.toFixed(1)} ms</span><span>{stats.drawCalls} Draw Calls</span><span>{stats.textures} Textures</span><span>安全区 90%</span></div>
    </section>
  );
}

function PropertyPanel({ store }: AppProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const selected = findLayer(snapshot.document.project, snapshot.document.selectedLayerId);
  if (!selected) return <aside className="right-panel panel-surface empty-panel"><Settings2 /><span>未选择图层</span></aside>;
  const selectedEffect = selected.effects.find((effect) => effect.id === snapshot.selectedEffectId);
  return (
    <aside className="right-panel panel-surface">
      <div className="inspector-head"><div><span className="layer-icon">{selected.type === "text" ? "T" : <Box size={15} />}</span><span><b>{selected.name}</b><small>{selected.id}</small></span></div><IconButton label="属性面板设置"><Settings2 size={15} /></IconButton></div>
      <div className="inspector-scroll">
        {layerPropertySections(selected).map((section) => <details key={section.title} open><summary>{section.title}<ChevronDown size={14} /></summary><div className="schema-fields">{section.fields.map((field) => <PropertyField key={`${field.path}-${field.component ?? ""}`} field={field} store={store} />)}</div></details>)}
        <details open><summary>效果栈 <span className="count">{selected.effects.length}</span><ChevronDown size={14} /></summary><div className="effect-stack">{selected.effects.length === 0 ? <span className="empty-state">暂无效果</span> : selected.effects.map((effect, index) => {
          const definition = P0_EDITOR_EFFECTS.find((entry) => entry.effectId === effect.effectId);
          return <div className={`stack-row${snapshot.selectedEffectId === effect.id ? " selected" : ""}`} key={effect.id} onClick={() => store.selectEffect(effect.id)}>
            <IconButton label={effect.enabled ? "停用效果" : "启用效果"} active={effect.enabled} onClick={() => store.toggleEffect(selected.id, effect.id)}>{effect.enabled ? <Eye size={13} /> : <EyeOff size={13} />}</IconButton>
            <span><b>{definition?.displayName ?? effect.effectId}</b><small>{definition?.sourceId ?? effect.version} · {effect.id}</small></span>
            <IconButton label="效果上移" disabled={index === 0} onClick={() => store.reorderEffect(selected.id, effect.id, -1)}><ArrowUp size={13} /></IconButton>
            <IconButton label="效果下移" disabled={index === selected.effects.length - 1} onClick={() => store.reorderEffect(selected.id, effect.id, 1)}><ArrowDown size={13} /></IconButton>
            <IconButton label="删除效果" onClick={() => store.deleteEffect(selected.id, effect.id)}><Trash2 size={13} /></IconButton>
          </div>;
        })}</div></details>
        {selectedEffect && <EffectInspector layerId={selected.id} effectId={selectedEffect.id} store={store} />}
      </div>
    </aside>
  );
}

function EffectInspector({ layerId, effectId, store }: { layerId: string; effectId: string; store: EditorStore }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const layer = findLayer(snapshot.document.project, layerId);
  const effect = layer?.effects.find((entry) => entry.id === effectId);
  if (effect === undefined || isLabPipelineEffect(effect)) return null;
  const definition = effectDefinition(effect.effectId);
  const fields = effectParameterFields(definition);
  return <details className="effect-inspector" open>
    <summary>{definition.displayName}<span className="count">Schema</span><ChevronDown size={14} /></summary>
    <div className="preset-buttons" aria-label={`${definition.displayName} 预设`}>
      {definition.presets.map((preset, index) => <button key={preset.presetId} onClick={() => store.applyEffectPreset(layerId, effectId, index)}>{preset.name.replace(`${definition.displayName} `, "")}</button>)}
    </div>
    <div className="schema-fields">{fields.map((field) => <EffectField key={field.name} layerId={layerId} effectId={effectId} field={field} store={store} />)}</div>
  </details>;
}

function EffectField({ layerId, effectId, field, store }: {
  layerId: string;
  effectId: string;
  field: EffectParameterField;
  store: EditorStore;
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const value = store.effectParameterValue(layerId, effectId, field);
  const update = (next: JsonValue): void => store.updateEffectParameter(layerId, effectId, field, next);
  let input;
  if (field.control === "select") {
    input = <select value={String(value)} onChange={(event) => update(event.target.value)}>{field.options?.map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}</select>;
  } else if (field.control === "toggle") {
    input = <input type="checkbox" checked={value === true} onChange={(event) => update(event.target.checked)} />;
  } else if (field.control === "color") {
    input = <input type="color" value={typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff"} onChange={(event) => update(event.target.value)} />;
  } else if (field.control === "resource") {
    const resources = projectResourceIds(snapshot.document.project);
    input = <select value={String(value)} onChange={(event) => update(event.target.value)}>{!resources.includes(String(value)) && <option>{String(value)}</option>}{resources.map((resource) => <option key={resource}>{resource}</option>)}</select>;
  } else if (field.control === "vector2") {
    const vector = Array.isArray(value) ? value : [0, 0];
    input = <span className="vector-input">{[0, 1].map((component) => <input key={component} aria-label={`${field.label} ${component === 0 ? "X" : "Y"}`} type="number" min={field.minimum} max={field.maximum} step={field.step} value={Number(vector[component] ?? 0)} onChange={(event) => update(vector.map((item, index) => index === component ? event.target.valueAsNumber : item) as JsonValue)} />)}</span>;
  } else {
    input = <input type={field.control === "number" ? "number" : "text"} value={typeof value === "string" || typeof value === "number" ? value : ""} min={field.minimum} max={field.maximum} step={field.step} minLength={field.minLength} maxLength={field.maxLength} onChange={(event) => update(field.control === "number" ? event.target.valueAsNumber : event.target.value)} />;
  }
  return <label className="schema-field effect-field"><span>{field.label}{field.unit && <small>{field.unit}</small>}</span><span className="field-control">{input}{field.keyframeable && <IconButton label={`在 ${formatTime(snapshot.currentTime, snapshot.document.project.fps)} 添加 ${field.label} 关键帧`} onClick={() => store.addEffectKeyframe(layerId, effectId, field)}><KeyRound size={13} /></IconButton>}</span></label>;
}

function PropertyField({ field, store }: { field: PropertyFieldSchema; store: EditorStore }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const value = store.propertyValue(field);
  const input = field.kind === "select" ? <select value={String(value)} onChange={(event) => store.updateSelected(field, event.target.value)}>{field.options?.map((option) => <option key={String(option)}>{String(option)}</option>)}</select> : field.kind === "checkbox" ? <input type="checkbox" checked={value === true} onChange={(event) => store.updateSelected(field, event.target.checked)} /> : <input type={field.kind} value={String(value)} min={field.minimum} max={field.maximum} step={field.step} onChange={(event) => store.updateSelected(field, field.kind === "number" ? event.target.valueAsNumber : event.target.value)} />;
  return <label className="schema-field"><span>{field.label}</span><span className="field-control">{input}{field.animatablePath && <IconButton label={`在 ${formatTime(snapshot.currentTime, snapshot.document.project.fps)} 添加${field.label}关键帧`} onClick={() => store.addKeyframe(field.animatablePath!)}><KeyRound size={13} /></IconButton>}</span></label>;
}

function Timeline({ store }: AppProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const project = snapshot.document.project;
  const layers = [...mainLayers(project)].sort((a, b) => b.zIndex - a.zIndex);
  const ticks = Array.from({ length: Math.floor(project.duration) + 1 }, (_, index) => index);
  return (
    <section className="timeline-panel">
      <div className="timeline-head"><div className="timeline-title"><CirclePlay size={15} /><b>时间轴</b><span>{formatTime(snapshot.currentTime, project.fps)}</span></div><div className="timeline-tools"><IconButton label="上一帧" onClick={() => store.setTime(snapshot.currentTime - 1 / project.fps)}><ArrowDown size={14} /></IconButton><IconButton label="下一帧" onClick={() => store.setTime(snapshot.currentTime + 1 / project.fps)}><ArrowUp size={14} /></IconButton><span>工作区 0:00 – {formatTime(project.duration, project.fps)}</span></div></div>
      <div className="timeline-grid">
        <div className="timeline-label-head">图层 / 属性</div>
        <div className="ruler"><div className="ticks">{ticks.map((tick) => <span key={tick} style={{ left: `${tick / project.duration * 100}%` }}>{tick}s</span>)}</div><input aria-label="时间轴播放头" type="range" min="0" max={project.duration} step={1 / project.fps} value={snapshot.currentTime} onInput={(event) => store.setTime(Number(event.currentTarget.value))} /><i className="playhead" style={{ left: `${snapshot.currentTime / project.duration * 100}%` }} /></div>
        {layers.map((layer) => <TimelineRow key={layer.id} layer={layer} duration={project.duration} selected={snapshot.document.selectedLayerId === layer.id} onSelect={() => store.selectLayer(layer.id)} />)}
      </div>
    </section>
  );
}

function TimelineRow({ layer, duration, selected, onSelect }: { layer: LayerDefinition; duration: number; selected: boolean; onSelect: () => void }) {
  const keyframeTimes: number[] = [];
  for (const item of [layer.opacity, layer.transform.position, layer.transform.scale, layer.transform.rotation]) {
    if (item.mode === "keyframes") item.keyframes.forEach((frame) => keyframeTimes.push(frame.time));
  }
  for (const effect of layer.effects) {
    for (const value of Object.values(effect.params)) {
      if (typeof value === "object" && value !== null && !Array.isArray(value)
        && "mode" in value && value.mode === "keyframes" && "keyframes" in value && Array.isArray(value.keyframes)) {
        value.keyframes.forEach((frame) => {
          if (typeof frame === "object" && frame !== null && "time" in frame && typeof frame.time === "number") {
            keyframeTimes.push(layer.startTime + (effect.startTime ?? 0) + frame.time);
          }
        });
      }
    }
  }
  return <><button className={`timeline-layer-label${selected ? " selected" : ""}`} onClick={onSelect}><span className={`layer-color color-${layer.zIndex % 3}`} /><span>{layer.name}</span></button><div className="track"><span className="clip" style={{ left: `${layer.startTime / duration * 100}%`, width: `${(layer.endTime - layer.startTime) / duration * 100}%` }} />{keyframeTimes.map((time, index) => <i key={`${time}-${index}`} className="keyframe" title={`${time.toFixed(2)}s`} style={{ left: `${time / duration * 100}%` }} />)}</div></>;
}

function EffectLab({ store }: AppProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [json, setJson] = useState('{\n  "strength": 1.0\n}');
  const [shader, setShader] = useState(`#version 300 es\nprecision highp float;\nuniform sampler2D u_input;\nin vec2 v_uv;\nout vec4 out_color;\nvoid main() {\n  vec4 color = texture(u_input, v_uv);\n  out_color = vec4(color.rgb, color.a);\n}`);
  const [result, setResult] = useState("等待校验");
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useMemo(() => new CorePreviewRenderer(), []);
  const [stats, setStats] = useState<PreviewStats>({ backend: "Unavailable", cpuMs: 0, drawCalls: 0, textures: 0, width: 0, height: 0 });
  const project = useMemo(() => {
    const clone = structuredClone(snapshot.document.project);
    const layer = clone.compositions[0]?.layers[1];
    if (layer && !layer.effects.some(isLabPipelineEffect)) layer.effects.push(pipelineEffect());
    return clone;
  }, []);
  useEffect(() => { if (canvas.current) setStats(renderer.render(project, 1, canvas.current)); return () => renderer.dispose(); }, [renderer, project]);
  const runValidation = () => {
    try {
      JSON.parse(json);
      if (!canvas.current) throw new Error("Preview canvas unavailable");
      const next = renderer.render(project, 1, canvas.current, shader);
      setStats(next);
      setResult(next.backend === "WebGL2" ? "PASS" : "BLOCKED");
    } catch { setResult("JSON ERROR"); }
  };
  return (
    <main className="lab-shell">
      <header className="lab-header"><button className="brand-button" onClick={() => store.setView("workbench")}><Brand compact /></button><div><span className="eyebrow">EFFECT LAB</span><h1>WebGL 管线校验</h1></div><span className={`backend-status ${stats.backend === "WebGL2" ? "ok" : "fail"}`}><i />{stats.backend}</span><button className="secondary-command" onClick={() => store.setView("editor")}><Layers3 size={16} />返回编辑器</button></header>
      <div className="lab-grid">
        <section className="lab-preview"><div className="lab-panel-head"><span><FlaskConical size={15} />效果预览</span><div><button className="chip active">Preview</button><button className="chip">100%</button></div></div><div className="lab-canvas"><canvas ref={canvas} />{stats.error && <span className="canvas-error">{stats.error}</span>}</div><div className="metric-strip"><span><small>CPU TIME</small><b>{stats.cpuMs.toFixed(2)} ms</b></span><span><small>DRAW CALLS</small><b>{stats.drawCalls}</b></span><span><small>TEXTURES</small><b>{stats.textures}</b></span><span><small>VRAM EST.</small><b>{((stats.width * stats.height * 4 * stats.textures) / 1048576).toFixed(1)} MB</b></span></div></section>
        <aside className="lab-params"><div className="lab-panel-head"><span><Settings2 size={15} />参数</span><span className="status-chip">Schema</span></div><label>强度<input type="range" min="0" max="1" step="0.01" defaultValue="1" /></label><label>预览质量<select defaultValue="preview"><option>draft</option><option>preview</option><option>final</option></select></label><label>当前后端<strong>{stats.backend}</strong></label><button className="primary-command" onClick={runValidation}><Play size={15} />运行校验</button><span className={`test-result ${result}`}>{result}</span></aside>
        <section className="code-panel"><div className="code-tabs"><button className="active">Shader</button><button>JSON 输入</button><span>GLSL ES 3.00</span></div><textarea aria-label="Shader 编辑器" value={shader} onChange={(event) => setShader(event.target.value)} spellCheck={false} /></section>
        <section className="json-panel"><div className="lab-panel-head"><span>参数 JSON</span><button className="text-button" onClick={() => setJson(JSON.stringify(JSON.parse(json), null, 2))}>格式化</button></div><textarea aria-label="效果参数 JSON" value={json} onChange={(event) => setJson(event.target.value)} spellCheck={false} /></section>
        <section className="lab-tests"><div className="lab-panel-head"><span><Check size={15} />当前视图状态</span></div><div className="test-row"><span>Core renderer</span><b className={stats.backend === "WebGL2" ? "pass" : "blocked"}>{stats.backend === "WebGL2" ? "可用" : "不可用"}</b></div><div className="test-row"><span>参数与 Shader</span><b>{result}</b></div><div className="test-row"><span>截图验证</span><b>由独立 QA 执行</b></div><div className="test-row"><span>导出验证</span><b>请在渲染中心查看</b></div></section>
      </div>
    </main>
  );
}

function formatTime(seconds: number, fps: number): string {
  const frames = Math.round(seconds * fps);
  const wholeSeconds = Math.floor(frames / fps);
  const frame = frames % fps;
  return `00:${String(wholeSeconds).padStart(2, "0")}:${String(frame).padStart(2, "0")}`;
}
