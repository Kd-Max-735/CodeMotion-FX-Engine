import {
  AlertTriangle,
  ArrowLeft,
  AudioLines,
  CheckCircle2,
  Clock3,
  Film,
  Image as ImageIcon,
  LoaderCircle,
  OctagonX,
  Play,
  ShieldAlert,
  Sparkles,
  WandSparkles
} from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { aiPlanApi, type AiPlanSettings, type AiPlanTaskView } from "./ai-plan-client.js";
import { projectMedia } from "./export-center.js";
import type { EditorStore } from "./store.js";

const phaseLabels: Record<AiPlanTaskView["phase"], string> = {
  accepted: "服务端已接受",
  validate: "复核素材完整性",
  upload: "上传至 Provider",
  process: "Provider 处理素材",
  infer: "模型结构化理解",
  cleanup: "清理远端临时文件",
  plan: "生成 Storyboard 与 DSL"
};

function formatBytes(value: number): string {
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

function modalityIcon(kind: "image" | "audio" | "video") {
  return kind === "image" ? <ImageIcon size={17} /> : kind === "audio" ? <AudioLines size={17} /> : <Film size={17} />;
}

export function AiPlanner({ store }: { store: EditorStore }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const project = snapshot.document.project;
  const media = useMemo(() => projectMedia(project), [project]);
  const [prompt, setPrompt] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [timeoutSeconds, setTimeoutSeconds] = useState(180);
  const [duration, setDuration] = useState(Math.min(6, project.duration));
  const [tasks, setTasks] = useState<AiPlanTaskView[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
  const [configured, setConfigured] = useState<boolean>();
  const [requestError, setRequestError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? tasks[0];
  const result = selectedTask?.result;

  const refresh = async () => {
    try {
      const response = await aiPlanApi.list();
      setConfigured(response.configured);
      setTasks(response.tasks);
    } catch {
      setConfigured(false);
      setRequestError("无法连接服务端 AI Provider。");
    }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 500);
    return () => window.clearInterval(timer);
  }, []);

  const toggleAsset = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const create = async () => {
    setSubmitting(true);
    setRequestError(undefined);
    const settings: AiPlanSettings = {
      prompt,
      assetIds: selectedIds,
      timeoutMs: timeoutSeconds * 1000,
      width: project.width,
      height: project.height,
      fps: project.fps,
      duration
    };
    try {
      const { task } = await aiPlanApi.create(project, settings);
      setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
      setSelectedTaskId(task.id);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async (id: string) => {
    try {
      const { task } = await aiPlanApi.cancel(id);
      setTasks((current) => current.map((item) => item.id === id ? task : item));
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : String(error));
    }
  };

  const enterEditor = () => {
    if (!result) return;
    store.importProject(JSON.stringify(result.dsl));
  };

  const progress = selectedTask?.progress;
  const uploadPercent = progress?.phase === "upload" && progress.total && progress.loaded !== undefined
    ? Math.min(100, progress.loaded / progress.total * 100)
    : undefined;
  const canSubmit = configured === true
    && !submitting
    && (prompt.trim().length > 0 || selectedIds.length > 0)
    && selectedIds.length <= 8
    && duration >= 0.5
    && duration <= 60;

  return (
    <main className="ai-planner">
      <header className="ai-header">
        <button className="icon-button" aria-label="返回工作台" title="返回工作台" onClick={() => store.setView("workbench")}><ArrowLeft size={18} /></button>
        <div><span className="eyebrow">MULTIMODAL PLANNER</span><h1>AI 动画规划</h1></div>
        <span className={`ai-provider-state ${configured ? "ready" : "offline"}`}><i />{configured ? "服务端 Provider 已连接" : configured === false ? "服务端 Provider 未配置" : "检查服务状态"}</span>
      </header>
      {requestError && <div className="ai-error" role="alert"><AlertTriangle size={16} /><span>{requestError}</span></div>}

      <div className="ai-layout">
        <aside className="ai-input-panel">
          <div className="ai-section-head"><div><span className="eyebrow">INPUT</span><h2>规划输入</h2></div><WandSparkles size={20} /></div>
          <label className="ai-field">文本要求
            <textarea aria-label="动画规划文本" maxLength={20_000} rows={6} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="输入动画目标、约束或叙事要求" />
            <small>{prompt.length} / 20000</small>
          </label>
          <div className="ai-assets-head"><span>工程素材</span><b>{selectedIds.length} / 8</b></div>
          <div className="ai-asset-picker">
            {media.length === 0 ? <div className="ai-empty">当前工程没有 Stage 6 已验证媒体。</div> : media.map((asset) => (
              <label key={asset.id} className={`ai-asset-option${selectedIds.includes(asset.id) ? " selected" : ""}${asset.valid ? "" : " invalid"}`}>
                <input type="checkbox" checked={selectedIds.includes(asset.id)} disabled={!asset.valid || (selectedIds.length >= 8 && !selectedIds.includes(asset.id))} onChange={() => toggleAsset(asset.id)} />
                <span className="ai-asset-icon">{modalityIcon(asset.kind)}</span>
                <span><b>{asset.kind.toUpperCase()} · {asset.codec}</b><small>{asset.dimensions ? `${asset.dimensions} · ` : ""}{asset.duration > 0 ? `${asset.duration.toFixed(2)}s · ` : ""}{formatBytes(asset.bytes)}</small><code>{asset.shortHash}</code></span>
                {asset.valid ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
              </label>
            ))}
          </div>
          <div className="ai-limits">
            <div><ImageIcon size={14} /><span><b>图片</b><small>10 MB · 8192 px</small></span></div>
            <div><AudioLines size={14} /><span><b>音频</b><small>512 MB · 6 小时</small></span></div>
            <div><Film size={14} /><span><b>视频</b><small>512 MB · 6 小时</small></span></div>
          </div>
          <div className="ai-number-grid">
            <label className="ai-field">规划时长<input type="number" min="0.5" max="60" step="0.5" value={duration} onChange={(event) => setDuration(Number(event.target.value))} /><small>0.5–60 秒</small></label>
            <label className="ai-field">超时<input type="number" min="10" max="300" step="10" value={timeoutSeconds} onChange={(event) => setTimeoutSeconds(Number(event.target.value))} /><small>10–300 秒</small></label>
          </div>
          <button className="primary-command ai-submit" disabled={!canSubmit} onClick={() => void create()}>{submitting ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}开始真实分析</button>
        </aside>

        <section className="ai-workspace">
          <div className="ai-task-bar">
            <div>
              <span className="eyebrow">LIVE TASK</span>
              <h2>{selectedTask ? phaseLabels[selectedTask.phase] : "等待输入"}</h2>
              {selectedTask && <small>{selectedTask.modalities.map((item) => item.toUpperCase()).join(" + ")} · {new Date(selectedTask.createdAt).toLocaleTimeString()}</small>}
            </div>
            {selectedTask?.status === "running" && <button className="secondary-command danger" onClick={() => void cancel(selectedTask.id)}><OctagonX size={15} />取消</button>}
            {selectedTask?.status === "cancelling" && <span className="ai-status"><LoaderCircle className="spin" size={15} />正在取消</span>}
            {selectedTask?.status === "completed" && <span className="ai-status success"><CheckCircle2 size={15} />结构化结果已验证</span>}
          </div>
          {selectedTask && (selectedTask.status === "running" || selectedTask.status === "cancelling") && (
            <div className="ai-progress" role="status">
              <span><LoaderCircle className="spin" size={16} /><b>{phaseLabels[selectedTask.phase]}</b><small>{progress?.localAssetId ?? "模型请求"}</small></span>
              {uploadPercent !== undefined ? <div className="ai-progress-track"><i style={{ width: `${uploadPercent}%` }} /><b>{uploadPercent.toFixed(0)}%</b></div> : <div className="ai-progress-indeterminate"><i /></div>}
              {progress?.loaded !== undefined && progress.total !== undefined && <code>{formatBytes(progress.loaded)} / {formatBytes(progress.total)}</code>}
            </div>
          )}
          {selectedTask?.error && <div className="ai-task-error" role="alert"><ShieldAlert size={18} /><span><b>{selectedTask.error.code}</b><small>{selectedTask.error.message}</small></span></div>}

          {!result ? <div className="ai-result-empty"><Sparkles size={28} /><b>Storyboard 与 DSL</b><span>真实模型结果将在服务端结构化校验完成后显示。</span></div> : (
            <div className="ai-results">
              <section className="ai-result-band summary-band">
                <div className="ai-section-head"><div><span className="eyebrow">UNDERSTANDING</span><h2>结构化摘要</h2></div><b>{Math.round(result.understanding.confidence * 100)}%</b></div>
                <div className="ai-summary-grid">
                  <div><h3>要求</h3>{result.understanding.text.requirements.map((item) => <p key={item}>{item}</p>)}</div>
                  <div><h3>约束</h3>{result.understanding.text.constraints.map((item) => <p key={item}>{item}</p>)}</div>
                  <div><h3>视觉风格</h3>{result.understanding.images.flatMap((item) => [...item.style, ...item.colors]).map((item) => <span className="ai-chip" key={item}>{item}</span>)}</div>
                  <div><h3>风险</h3>{result.understanding.risks.length ? result.understanding.risks.map((item) => <p key={item}>{item}</p>) : <p>模型未返回风险项</p>}</div>
                </div>
              </section>

              {(result.understanding.images.length > 0 || result.understanding.audio.length > 0 || result.understanding.video.length > 0) && <section className="ai-result-band">
                <div className="ai-section-head"><div><span className="eyebrow">MEDIA</span><h2>素材理解</h2></div></div>
                <div className="media-understanding">
                  {result.understanding.images.map((item) => <article key={item.localAssetId}><ImageIcon size={17} /><div><b>{item.subjects.join(" · ") || "图片"}</b><p>{item.composition}</p><small>{[...item.style, ...item.colors].join(" · ")}</small>{item.ocr.length > 0 && <code>OCR: {item.ocr.join(" / ")}</code>}</div></article>)}
                  {result.understanding.audio.map((item) => <article key={item.localAssetId}><AudioLines size={17} /><div><b>{item.speakers.join(" · ") || "音频"}</b><p>{item.transcript}</p><small>{item.emotion.join(" · ")} · {item.bgm} · {item.rhythm}</small>{item.soundEffects.map((effect) => <code key={`${effect.at}-${effect.description}`}>{effect.at.toFixed(2)}s {effect.description}</code>)}</div></article>)}
                  {result.understanding.video.flatMap((item) => item.shots.map((shot, index) => <article key={`${item.localAssetId}-${index}`}><Film size={17} /><div><b>{shot.range.start.toFixed(2)}–{shot.range.end.toFixed(2)}s · {shot.event}</b><p>{shot.action}</p><small>{shot.audioVisualRelation}</small>{shot.onScreenText.length > 0 && <code>{shot.onScreenText.join(" / ")}</code>}</div></article>))}
                </div>
              </section>}

              <section className="ai-result-band">
                <div className="ai-section-head"><div><span className="eyebrow">STORYBOARD</span><h2>镜头与效果</h2></div><b>{result.storyboard.shots.length} SHOTS</b></div>
                <div className="storyboard-list">{result.storyboard.shots.map((shot) => <article key={shot.id}>
                  <span className="shot-time">{shot.range.start.toFixed(2)}–{shot.range.end.toFixed(2)}s</span>
                  <div><b>{shot.description}</b><small>{shot.layers.map((layer) => layer.description).join(" · ")}</small></div>
                  <div>{shot.effects.map((effect) => <code key={`${effect.effectId}-${effect.targetLayerId}`}>{effect.effectId}</code>)}</div>
                </article>)}</div>
              </section>

              <section className="ai-result-band">
                <div className="ai-section-head"><div><span className="eyebrow">TIMELINE DRAFT</span><h2>时间轴草案</h2></div><Clock3 size={18} /></div>
                <div className="draft-timeline">{result.storyboard.shots.map((shot) => <div key={shot.id}><span>{shot.id}</span><i style={{ left: `${shot.range.start / result.storyboard.duration * 100}%`, width: `${(shot.range.end - shot.range.start) / result.storyboard.duration * 100}%` }} /><small>{shot.range.start.toFixed(1)}–{shot.range.end.toFixed(1)}s</small></div>)}</div>
              </section>

              <section className="ai-result-band budget-band">
                <div className="ai-section-head"><div><span className="eyebrow">BUDGET & TRACE</span><h2>预算与实际调用</h2></div></div>
                <dl>
                  <div><dt>模型</dt><dd>{result.trace.modelId}</dd></div>
                  <div><dt>延迟</dt><dd>{(result.trace.latencyMs / 1000).toFixed(2)}s</dd></div>
                  <div><dt>Token</dt><dd>{result.trace.usage.totalTokens}</dd></div>
                  <div><dt>预计成本</dt><dd>¥{result.trace.usage.estimatedCostCny.lowerBound.toFixed(6)}–¥{result.trace.usage.estimatedCostCny.upperBound.toFixed(6)}</dd></div>
                  <div><dt>DSL</dt><dd>{result.dsl.compositions[0]?.layers.length ?? 0} 图层 · {result.dsl.compositions[0]?.layers.flatMap((layer) => layer.effects).length ?? 0} 效果</dd></div>
                  <div><dt>预览预算</dt><dd>{result.preview.frameHashes.length} 帧 · {result.preview.width}×{result.preview.height}</dd></div>
                </dl>
                <button className="primary-command enter-editor" onClick={enterEditor}><Play size={16} />进入编辑器继续手工编辑</button>
              </section>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
