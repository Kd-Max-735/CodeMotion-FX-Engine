import { AlertTriangle, ArrowLeft, CheckCircle2, Download, FileVideo2, HardDrive, History, LoaderCircle, Play, RefreshCw, Server, XCircle } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { estimateExportBytes, exportApi, projectMedia, validateExportSettings, type ExportFormat, type ExportSettings, type ExportTaskView } from "./export-center.js";
import { preparePreviewProject } from "./preview-raster.js";
import type { EditorStore } from "./store.js";

function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function statusLabel(status: ExportTaskView["status"]): string {
  return status === "queued" ? "排队" : status === "running" ? "渲染中" : status === "completed" ? "完成" : "失败";
}

export function RenderCenter({ store }: { store: EditorStore }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const project = snapshot.document.project;
  const assets = useMemo(() => projectMedia(project), [project]);
  const [settings, setSettings] = useState<ExportSettings>({
    format: "mp4", width: project.width, height: project.height, fps: project.fps,
    duration: Math.min(project.duration, 3), alpha: false, audio: false
  });
  const [tasks, setTasks] = useState<ExportTaskView[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [serviceError, setServiceError] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const selected = tasks.find((task) => task.id === selectedId) ?? tasks[0];
  const issues = validateExportSettings(project, settings);

  const refresh = async () => {
    try {
      const result = await exportApi.list();
      setTasks(result.tasks);
      setServiceError(undefined);
    } catch (error) {
      setServiceError(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 500);
    return () => window.clearInterval(timer);
  }, []);

  const setFormat = (format: ExportFormat) => setSettings((current) => {
    return {
      ...current,
      format,
      alpha: format === "png-sequence" || format === "webm",
      audio: (format === "webm" || format === "mp4") && current.audio
    };
  });

  const create = async () => {
    if (issues.length) return;
    setSubmitting(true);
    setActionError(undefined);
    try {
      const exportProject = await preparePreviewProject(
        project,
        settings.width,
        settings.height,
        0,
        "final"
      );
      const { task } = await exportApi.create(exportProject, settings);
      setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
      setSelectedId(task.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const retry = async (id: string) => {
    try {
      const { task } = await exportApi.retry(id);
      setTasks((current) => current.map((item) => item.id === id ? task : item));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <main className="render-center">
      <header className="render-header">
        <button className="icon-button" aria-label="返回编辑器" title="返回编辑器" onClick={() => store.setView("editor")}><ArrowLeft size={18} /></button>
        <div><span className="eyebrow">LOCAL EXPORT</span><h1>渲染中心</h1></div>
        <span className={`service-state${serviceError ? " failed" : ""}`}><Server size={14} />{serviceError ? "本地服务不可用" : "真实 exporter 已连接"}</span>
        <button className="secondary-command" onClick={() => void refresh()}><RefreshCw size={15} />刷新</button>
      </header>
      {(actionError || serviceError) && <div className="render-alert" role="alert"><AlertTriangle size={16} /><span>{actionError ?? serviceError}</span></div>}

      <div className="render-layout">
        <aside className="export-settings">
          <div className="render-section-title"><div><span className="eyebrow">SETTINGS</span><h2>导出设置</h2></div><FileVideo2 size={20} /></div>
          <label className="render-field">格式
            <span className="format-segment" role="group" aria-label="导出格式">
              {(["png-sequence", "gif", "webm", "mp4"] as const).map((format) =>
                <button type="button" key={format} className={settings.format === format ? "active" : ""} onClick={() => setFormat(format)}>
                  {format === "png-sequence" ? "PNG" : format.toUpperCase()}
                </button>)}
            </span>
          </label>
          <div className="render-field-pair">
            <label className="render-field">宽度<input type="number" min="2" value={settings.width} onChange={(event) => setSettings({ ...settings, width: Number(event.target.value) })} /></label>
            <label className="render-field">高度<input type="number" min="2" value={settings.height} onChange={(event) => setSettings({ ...settings, height: Number(event.target.value) })} /></label>
          </div>
          <div className="render-field-pair">
            <label className="render-field">帧率<input type="number" min="1" max="120" value={settings.fps} onChange={(event) => setSettings({ ...settings, fps: Number(event.target.value) })} /></label>
            <label className="render-field">时长（秒）<input type="number" min="0.01" step="0.1" value={settings.duration} onChange={(event) => setSettings({ ...settings, duration: Number(event.target.value) })} /></label>
          </div>
          <div className="render-source"><small>渲染源</small><b>主合成 · 工程图层引用</b></div>
          <label className="toggle-field"><input type="checkbox" checked={settings.alpha} disabled={settings.format === "mp4" || settings.format === "gif"} onChange={(event) => setSettings({ ...settings, alpha: event.target.checked })} /><span>透明通道</span></label>
          <label className="toggle-field"><input type="checkbox" checked={settings.audio} disabled={settings.format === "gif" || settings.format === "png-sequence"} onChange={(event) => setSettings({ ...settings, audio: event.target.checked })} /><span>包含音轨</span></label>
          {settings.audio && <div className="render-source"><small>音频源</small><b>工程音轨引用</b></div>}
          <div className="estimate"><HardDrive size={17} /><span><small>预计大小</small><b>{bytes(estimateExportBytes(settings))}</b></span><span><small>视频信息</small><b>{settings.width} x {settings.height} · {settings.fps} FPS</b></span></div>
          {issues.length > 0 && <ul className="validation-list">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
          <button className="primary-command export-start" disabled={submitting || issues.length > 0 || Boolean(serviceError)} onClick={() => void create()}>
            {submitting ? <LoaderCircle className="spin" size={17} /> : <Play size={17} />}开始真实导出
          </button>
        </aside>

        <section className="render-main">
          <div className="asset-strip">
            <div className="render-section-title"><div><span className="eyebrow">PROJECT MEDIA</span><h2>工程媒体索引</h2></div><b>{assets.filter((asset) => asset.valid).length} 条可用记录</b></div>
            <div className="asset-list">{assets.length === 0 ? <div className="empty-render-state">当前工程没有可导出的已验证媒体资源。</div> : assets.map((asset) =>
              <div className={`asset-row${asset.valid ? "" : " invalid"}`} key={asset.id}>
                <span className="asset-kind">{asset.kind.slice(0, 3).toUpperCase()}</span>
                <span><b>{asset.mime}</b><small>{asset.codec}{asset.dimensions ? ` · ${asset.dimensions}` : ""}{asset.duration > 0 ? ` · ${asset.duration.toFixed(2)}s` : ""}</small></span>
                <span><small>{bytes(asset.bytes)}</small><code>{asset.shortHash}</code></span>
                {asset.valid ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
              </div>)}</div>
          </div>

          <div className="task-workspace">
            <div className="task-history">
              <div className="render-section-title"><div><span className="eyebrow">HISTORY</span><h2>任务与历史</h2></div><History size={19} /></div>
              <div className="task-list">{tasks.length === 0 ? <div className="empty-render-state">还没有真实渲染任务。</div> : tasks.map((task) =>
                <button key={task.id} className={`task-row${selected?.id === task.id ? " selected" : ""}`} onClick={() => setSelectedId(task.id)}>
                  <span className={`task-status ${task.status}`}>{task.status === "running" ? <LoaderCircle className="spin" size={14} /> : task.status === "completed" ? <CheckCircle2 size={14} /> : task.status === "failed" ? <XCircle size={14} /> : <History size={14} />}{statusLabel(task.status)}</span>
                  <span><b>{task.projectName}</b><small>{task.format.toUpperCase()} · {task.frameCount} 帧</small></span>
                  <span className="task-percent">{Math.round(task.progress * 100)}%</span>
                  <span className="progress-track"><i style={{ width: `${task.progress * 100}%` }} /></span>
                </button>)}</div>
            </div>

            <aside className="task-detail">
              <div className="render-section-title"><div><span className="eyebrow">TASK DETAIL</span><h2>任务详情</h2></div></div>
              {!selected ? <div className="empty-render-state">选择任务查看进度、日志和错误帧。</div> : <>
                <dl className="task-metrics">
                  <div><dt>状态</dt><dd>{statusLabel(selected.status)}</dd></div>
                  <div><dt>进度</dt><dd>{selected.completedFrames} / {selected.frameCount}</dd></div>
                  <div><dt>格式</dt><dd>{selected.format.toUpperCase()}</dd></div>
                  <div><dt>编码</dt><dd>{selected.video.codec}{selected.video.audioCodec ? ` + ${selected.video.audioCodec}` : ""}</dd></div>
                  <div><dt>视频</dt><dd>{selected.video.width} x {selected.video.height} · {selected.video.fps} FPS · {selected.video.duration}s</dd></div>
                  <div><dt>大小</dt><dd>{selected.outputBytes ? bytes(selected.outputBytes) : `预计 ${bytes(selected.estimatedBytes)}`}</dd></div>
                  <div><dt>机器</dt><dd>{selected.machine.platform} · {selected.machine.mode}</dd></div>
                  <div><dt>FFmpeg</dt><dd>{selected.machine.ffmpeg}</dd></div>
                </dl>
                {selected.failure && <div className="frame-error" role="alert"><AlertTriangle size={17} /><span><b>第 {selected.failure.frame} 帧 · {selected.failure.stage}</b><small>{selected.failure.time.toFixed(3)}s · 恢复帧 {selected.failure.recoverFromFrame}</small><code>{selected.failure.message}</code></span></div>}
                <div className="task-actions">
                  {selected.status === "failed" && <button className="secondary-command" onClick={() => void retry(selected.id)}><RefreshCw size={15} />失败重试</button>}
                  {selected.status === "completed" && <a className="primary-command" href={exportApi.downloadUrl(selected.id)} download={selected.downloadName}><Download size={15} />下载 {selected.downloadName}</a>}
                </div>
                <div className="task-logs" aria-label="任务日志">{selected.logs.map((line, index) => <code key={`${index}-${line}`}>{line}</code>)}</div>
              </>}
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
