import { AlertTriangle, ArrowLeft, Download, LoaderCircle, Play, RefreshCw, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ApplicationScope } from "@codemotion/schema";
import {
  estimateExportBytes,
  exportApi,
  projectMedia,
  validateExportSettings,
  type ExportFormat,
  type ExportSettings,
  type ExportTaskView
} from "./export-center.js";
import type { EditorStore } from "./store.js";

function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

export function RenderCenter({ store, scopes = [] }: { store: EditorStore; scopes?: readonly ApplicationScope[] }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const envelope = snapshot.editableProject;
  const project = envelope.project;
  const canCreate = scopes.includes("export:create");
  const canRead = scopes.includes("export:read");
  const [settings, setSettings] = useState<ExportSettings>({
    format: "mp4", width: project.width, height: project.height, fps: project.fps,
    duration: Math.min(project.duration, 3), alpha: false, audio: false
  });
  const [tasks, setTasks] = useState<ExportTaskView[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const downloadController = useRef<AbortController | undefined>(undefined);
  const actionControllers = useRef(new Set<AbortController>());
  const objectUrl = useRef<string | undefined>(undefined);
  const selected = tasks.find((item) => item.id === selectedId) ?? tasks[0];
  const issues = useMemo(() => validateExportSettings(envelope, settings), [envelope, settings]);
  const assets = useMemo(() => projectMedia(envelope), [envelope]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!canRead) return;
    try {
      const next = (await exportApi.list(signal)).tasks;
      if (!signal?.aborted) { setTasks(next); setError(undefined); }
    } catch (cause) {
      if (!signal?.aborted && (!(cause instanceof DOMException) || cause.name !== "AbortError")) {
        setError(cause instanceof Error ? cause.message : "任务刷新失败。");
      }
    }
  }, [canRead]);

  useEffect(() => {
    if (!canRead) return;
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [canRead, refresh]);

  const hasActiveTask = tasks.some((task) => ["queued", "running", "cancelling"].includes(task.status));
  useEffect(() => {
    if (!canRead || !hasActiveTask) return;
    const controller = new AbortController();
    let pending = false;
    const timer = window.setInterval(() => {
      if (pending) return;
      pending = true;
      void refresh(controller.signal).finally(() => { pending = false; });
    }, 1_000);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, [canRead, hasActiveTask, refresh]);

  useEffect(() => () => {
    downloadController.current?.abort();
    for (const controller of actionControllers.current) controller.abort();
    actionControllers.current.clear();
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
  }, []);

  const setFormat = (format: ExportFormat) => setSettings((current) => ({
    ...current,
    format,
    alpha: format === "png-sequence" || format === "webm",
    audio: (format === "webm" || format === "mp4") && current.audio
  }));

  const create = async () => {
    if (!canCreate || issues.length) return;
    const controller = new AbortController();
    actionControllers.current.add(controller);
    setBusy(true);
    try {
      const { task } = await exportApi.create(envelope, settings, controller.signal);
      setTasks((current) => [task, ...current]);
      setSelectedId(task.id);
      setError(undefined);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "导出创建失败。");
    } finally {
      actionControllers.current.delete(controller);
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  const mutate = async (action: "cancel" | "retry", id: string) => {
    if (!canCreate) return;
    const controller = new AbortController();
    actionControllers.current.add(controller);
    try {
      const { task } = action === "cancel"
        ? await exportApi.cancel(id, controller.signal)
        : await exportApi.retry(id, controller.signal);
      setTasks((current) => action === "retry"
        ? [task, ...current]
        : current.map((item) => item.id === id ? task : item));
      if (action === "retry") setSelectedId(task.id);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "任务操作失败。");
    } finally { actionControllers.current.delete(controller); }
  };

  const download = async (task: ExportTaskView) => {
    if (!canRead) return;
    downloadController.current?.abort();
    if (objectUrl.current) { URL.revokeObjectURL(objectUrl.current); objectUrl.current = undefined; }
    const controller = new AbortController();
    downloadController.current = controller;
    try {
      const result = await exportApi.download(task, controller.signal);
      const url = URL.createObjectURL(result.blob);
      objectUrl.current = url;
      const link = document.createElement("a");
      link.href = url;
      link.download = result.name;
      link.click();
      URL.revokeObjectURL(url);
      if (objectUrl.current === url) objectUrl.current = undefined;
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "下载失败。");
    } finally {
      if (downloadController.current === controller) downloadController.current = undefined;
    }
  };

  return <main className="render-center">
    <header className="render-header">
      <button className="icon-button" aria-label="返回编辑器" title="返回编辑器" onClick={() => store.setView("editor")}><ArrowLeft size={18} /></button>
      <div><span className="eyebrow">SERVER EXPORT</span><h1>渲染中心</h1></div>
      <button className="secondary-command" disabled={!canRead} onClick={() => void refresh()}><RefreshCw size={15} />刷新</button>
    </header>
    {(!canRead || !canCreate) && <div className="render-alert" role="status"><AlertTriangle size={16} />当前会话缺少{!canRead ? "导出读取" : "导出创建"}权限，对应操作已禁用。</div>}
    {error && <div className="render-alert" role="alert"><AlertTriangle size={16} />{error}</div>}
    <div className="render-layout">
      <aside className="export-settings">
        <h2>导出设置</h2>
        <div className="format-segment">{(["png-sequence", "gif", "webm", "mp4"] as const).map((format) => <button key={format} className={settings.format === format ? "active" : ""} onClick={() => setFormat(format)}>{format === "png-sequence" ? "PNG" : format.toUpperCase()}</button>)}</div>
        <div className="render-field-pair"><label className="render-field">宽度<input type="number" value={settings.width} onChange={(event) => setSettings({ ...settings, width: event.target.valueAsNumber })} /></label><label className="render-field">高度<input type="number" value={settings.height} onChange={(event) => setSettings({ ...settings, height: event.target.valueAsNumber })} /></label></div>
        <div className="render-field-pair"><label className="render-field">帧率<input type="number" value={settings.fps} onChange={(event) => setSettings({ ...settings, fps: event.target.valueAsNumber })} /></label><label className="render-field">时长<input type="number" step="0.1" value={settings.duration} onChange={(event) => setSettings({ ...settings, duration: event.target.valueAsNumber })} /></label></div>
        <label className="toggle-field"><input type="checkbox" checked={settings.alpha} disabled={settings.format === "mp4" || settings.format === "gif"} onChange={(event) => setSettings({ ...settings, alpha: event.target.checked })} />透明通道</label>
        <label className="toggle-field"><input type="checkbox" checked={settings.audio} disabled={settings.format === "gif" || settings.format === "png-sequence"} onChange={(event) => setSettings({ ...settings, audio: event.target.checked })} />包含音轨</label>
        <small>工程素材仅保存 opaque assetId：{assets.map((asset) => asset.id).join(", ") || "无"}</small>
        <b>预计 {bytes(estimateExportBytes(settings))}</b>
        {issues.map((issue) => <div className="validation-list" key={issue}>{issue}</div>)}
        <button className="primary-command export-start" disabled={!canCreate || busy || issues.length > 0} onClick={() => void create()}>{busy ? <LoaderCircle className="spin" size={17} /> : <Play size={17} />}创建导出任务</button>
      </aside>
      <section className="render-main">
        <h2>任务历史</h2>
        <div className="task-list">{tasks.map((task) => <button key={task.id} className={`task-row${selected?.id === task.id ? " selected" : ""}`} onClick={() => setSelectedId(task.id)}><span>{task.status}</span><b>{task.projectName}</b><span>{Math.round(task.progress * 100)}%</span><span className="progress-track"><i style={{ width: `${task.progress * 100}%` }} /></span></button>)}</div>
        {selected && <aside className="task-detail"><h2>{selected.format.toUpperCase()}</h2><p>{selected.completedFrames} / {selected.frameCount} 帧，{selected.video.codec}{selected.video.audioCodec ? ` + ${selected.video.audioCodec}` : ""}</p>{selected.failure && <div role="alert">{selected.failure.message}</div>}<div className="task-actions">{["queued", "running", "cancelling"].includes(selected.status) && <button className="secondary-command" disabled={!canCreate} onClick={() => void mutate("cancel", selected.id)}><Square size={14} />取消</button>}{(selected.status === "failed" || selected.status === "cancelled") && <button className="secondary-command" disabled={!canCreate} onClick={() => void mutate("retry", selected.id)}><RefreshCw size={14} />重试</button>}{selected.status === "completed" && <button className="primary-command" disabled={!canRead} onClick={() => void download(selected)}><Download size={15} />认证下载</button>}</div></aside>}
      </section>
    </div>
  </main>;
}
