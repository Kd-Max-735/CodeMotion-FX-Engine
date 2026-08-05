import {
  AlertTriangle,
  ArrowLeft,
  AudioLines,
  CheckCircle2,
  Film,
  Image as ImageIcon,
  LoaderCircle,
  LogIn,
  LogOut,
  OctagonX,
  Play,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Upload,
  WandSparkles,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AI_CANVAS_RATIOS, aiPlanApi, buildAiPlanningInput, type BrowserAiPlanTaskView } from "./ai-plan-client.js";
import {
  mediaAssetApi,
  sessionApi,
  BrowserApiError,
  type AiAssetPurpose,
  type BrowserAssetSummaryV1,
  type BrowserMediaKind,
  type BrowserSessionV1
} from "./media-asset-client.js";
import type { EditorStore } from "./store.js";

const phaseLabels: Record<BrowserAiPlanTaskView["phase"], string> = {
  accepted: "服务端已接受",
  validate: "复核素材完整性",
  upload: "上传至 Provider",
  process: "Provider 处理素材",
  infer: "模型结构化理解",
  cleanup: "清理远端临时文件",
  plan: "生成 Storyboard 与 DSL"
};

const PURPOSE_LABELS: Record<AiAssetPurpose, string> = {
  "reference-image": "参考图片",
  "reference-video": "参考视频",
  "reference-audio": "参考音频",
  logo: "品牌 Logo"
};


function formatBytes(value: number): string {
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

function assetIcon(kind: BrowserMediaKind) {
  if (kind === "audio") return <AudioLines size={17} />;
  if (kind === "video") return <Film size={17} />;
  return <ImageIcon size={17} />;
}

function identity(session: BrowserSessionV1 | undefined): string | undefined {
  return session ? `${session.principal.tenantId}\0${session.principal.userId}\0${[...session.principal.scopes].sort().join(" ")}` : undefined;
}

export function AiPlanner({ store }: { store: EditorStore }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const project = snapshot.document.project;
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadController = useRef<AbortController | undefined>(undefined);
  const assetListController = useRef<AbortController | undefined>(undefined);
  const actionControllers = useRef(new Set<AbortController>());
  const [session, setSession] = useState<BrowserSessionV1>();
  const [sessionLoading, setSessionLoading] = useState(true);
  const [devCode, setDevCode] = useState("");
  const [devBindingStarted, setDevBindingStarted] = useState(() => sessionStorage.getItem("cmfx.dev.binding") === "1");
  const [devSubmitting, setDevSubmitting] = useState(false);
  const [devFeedback, setDevFeedback] = useState<string>();
  const [assets, setAssets] = useState<BrowserAssetSummaryV1[]>([]);
  const [assetCursor, setAssetCursor] = useState<string | null>(null);
  const [assetKind, setAssetKind] = useState<BrowserMediaKind | "all">("all");
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPurpose, setUploadPurpose] = useState<AiAssetPurpose>("reference-image");
  const [failedUpload, setFailedUpload] = useState<File>();
  const [selected, setSelected] = useState<Record<string, AiAssetPurpose>>({});
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState<keyof typeof AI_CANVAS_RATIOS>(project.width >= project.height ? "16:9" : "9:16");
  const [width, setWidth] = useState(project.width);
  const [height, setHeight] = useState(project.height);
  const [fps, setFps] = useState(Math.min(60, project.fps));
  const [duration, setDuration] = useState(Math.min(6, project.duration));
  const [style, setStyle] = useState("");
  const [tone, setTone] = useState("");
  const [requiredText, setRequiredText] = useState("");
  const [forbiddenContent, setForbiddenContent] = useState("");
  const [colors, setColors] = useState(["#ff5a3c"]);
  const [tasks, setTasks] = useState<BrowserAiPlanTaskView[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
  const [configured, setConfigured] = useState<boolean>();
  const [message, setMessage] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const sessionKey = identity(session);
  const scopes = new Set(session?.principal.scopes ?? []);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? tasks[0];

  const readSession = useCallback(async (signal?: AbortSignal): Promise<boolean> => {
    setSessionLoading(true);
    try {
      const next = await sessionApi.read(signal);
      if (signal?.aborted) return false;
      setSession((current) => {
        if (identity(current) !== identity(next)) {
          setAssets([]);
          setSelected({});
          setTasks([]);
          setSelectedTaskId(undefined);
        }
        return next;
      });
      setMessage(undefined);
      return true;
    } catch (error) {
      if (signal?.aborted || error instanceof DOMException && error.name === "AbortError") return false;
      setSession(undefined);
      setAssets([]);
      setSelected({});
      setTasks([]);
      setConfigured(undefined);
      if (error instanceof BrowserApiError && error.status !== 401) setMessage(error.message);
      return false;
    } finally { if (!signal?.aborted) setSessionLoading(false); }
  }, []);

  const handleRequestError = useCallback((error: unknown, fallback: string) => {
    setMessage(error instanceof Error ? error.message : fallback);
    if (typeof error === "object" && error !== null && "status" in error && error.status === 401) void readSession();
  }, [readSession]);

  const loadAssets = useCallback(async (append = false) => {
    if (!session || !session.principal.scopes.includes("assets:read")) return;
    assetListController.current?.abort();
    const controller = new AbortController();
    assetListController.current = controller;
    setAssetsLoading(true);
    try {
      const page = await mediaAssetApi.list({
        limit: 50,
        ...(append && assetCursor ? { cursor: assetCursor } : {}),
        ...(assetKind === "all" ? {} : { kind: assetKind })
      }, controller.signal);
      if (controller.signal.aborted) return;
      setAssets((current) => append ? [...current, ...page.items] : page.items);
      setAssetCursor(page.nextCursor);
      setMessage(undefined);
    } catch (error) {
      if (!controller.signal.aborted) handleRequestError(error, "素材加载失败。");
    } finally {
      if (assetListController.current === controller) {
        assetListController.current = undefined;
        setAssetsLoading(false);
      }
    }
  }, [sessionKey, assetCursor, assetKind, handleRequestError]);

  const loadTasks = useCallback(async (signal?: AbortSignal): Promise<boolean> => {
    if (!session || !session.principal.scopes.includes("ai:plan")) return false;
    try {
      const response = await aiPlanApi.list(signal);
      if (signal?.aborted) return false;
      setConfigured(response.configured);
      setTasks(response.tasks);
      return response.tasks.some((task) => task.status === "running" || task.status === "cancelling");
    } catch (error) {
      if (!signal?.aborted && (!(error instanceof DOMException) || error.name !== "AbortError")) {
        handleRequestError(error, "任务加载失败。");
      }
      return false;
    }
  }, [sessionKey, handleRequestError]);

  useEffect(() => {
    const controller = new AbortController();
    void readSession(controller.signal);
    return () => controller.abort();
  }, [readSession]);
  useEffect(() => { if (sessionKey) void loadAssets(false); }, [sessionKey, assetKind]);
  useEffect(() => {
    if (!sessionKey || !scopes.has("ai:plan")) return;
    const controller = new AbortController();
    void loadTasks(controller.signal);
    return () => controller.abort();
  }, [sessionKey]);
  const hasActiveTask = tasks.some((task) => task.status === "running" || task.status === "cancelling");
  useEffect(() => {
    if (!sessionKey || !scopes.has("ai:plan") || !hasActiveTask) return;
    const controller = new AbortController();
    let pending = false;
    const timer = window.setInterval(() => {
      if (pending) return;
      pending = true;
      void loadTasks(controller.signal).finally(() => { pending = false; });
    }, 1_000);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, [sessionKey, hasActiveTask, loadTasks]);
  useEffect(() => () => {
    const upload = uploadController.current;
    const assetList = assetListController.current;
    uploadController.current = undefined;
    assetListController.current = undefined;
    upload?.abort();
    assetList?.abort();
    for (const controller of actionControllers.current) controller.abort();
    actionControllers.current.clear();
  }, []);

  const applyRatio = (next: keyof typeof AI_CANVAS_RATIOS) => {
    const [nextWidth, nextHeight] = AI_CANVAS_RATIOS[next];
    setRatio(next);
    setWidth(nextWidth);
    setHeight(nextHeight);
  };

  const uploadFile = async (file: File) => {
    if (!scopes.has("assets:write")) return;
    const controller = new AbortController();
    uploadController.current = controller;
    setUploading(true);
    setFailedUpload(undefined);
    setMessage(undefined);
    try {
      const uploaded = await mediaAssetApi.upload(file, uploadPurpose, controller.signal);
      setAssets((current) => [uploaded, ...current.filter((item) => item.assetId !== uploaded.assetId)]);
      if (uploaded.allowedPurposes.includes(uploadPurpose)) {
        setSelected((current) => ({ ...current, [uploaded.assetId]: uploadPurpose }));
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setFailedUpload(file);
        handleRequestError(error, "上传失败。");
      }
    } finally {
      if (uploadController.current === controller) {
        uploadController.current = undefined;
        setUploading(false);
        if (fileInput.current) fileInput.current.value = "";
      }
    }
  };

  const toggleAsset = (asset: BrowserAssetSummaryV1) => {
    setSelected((current) => {
      if (current[asset.assetId]) {
        const next = { ...current };
        delete next[asset.assetId];
        return next;
      }
      const purpose = asset.allowedPurposes[0];
      return purpose && Object.keys(current).length < 8 ? { ...current, [asset.assetId]: purpose } : current;
    });
  };

  const setPurpose = (asset: BrowserAssetSummaryV1, purpose: AiAssetPurpose) => {
    if (!asset.allowedPurposes.includes(purpose)) return;
    setSelected((current) => current[asset.assetId] ? { ...current, [asset.assetId]: purpose } : current);
  };

  const selectedAssets = useMemo(() => Object.entries(selected).flatMap(([assetId, purpose]) => {
    const asset = assets.find((item) => item.assetId === assetId);
    return asset?.allowedPurposes.includes(purpose) ? [{ assetId, purpose }] : [];
  }), [selected, assets]);

  const input = buildAiPlanningInput({ prompt, assets: selectedAssets, width, height, fps,
    durationSeconds: duration, style, colors, tone, requiredText, forbiddenContent });
  const formValid = Number.isInteger(width) && width >= 2 && width <= 8192
    && Number.isInteger(height) && height >= 2 && height <= 8192 && width * height <= 33_554_432
    && Number.isInteger(fps) && fps >= 1 && fps <= 60
    && Number.isFinite(duration) && duration >= 0.5 && duration <= 60
    && (prompt.trim().length > 0 || selectedAssets.length > 0)
    && selectedAssets.length === Object.keys(selected).length && selectedAssets.length <= 8
    && colors.every((item) => /^#[0-9a-f]{6}$/i.test(item));
  const canSubmit = Boolean(session && scopes.has("ai:plan") && configured && !submitting && formValid);

  const createTask = async () => {
    if (!canSubmit) return;
    const controller = new AbortController();
    actionControllers.current.add(controller);
    setSubmitting(true);
    setMessage(undefined);
    try {
      const { task } = await aiPlanApi.create(input, controller.signal);
      setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
      setSelectedTaskId(task.id);
    } catch (error) {
      if (!controller.signal.aborted) handleRequestError(error, "任务创建失败。");
    } finally {
      actionControllers.current.delete(controller);
      if (!controller.signal.aborted) setSubmitting(false);
    }
  };

  const cancelTask = async (id: string) => {
    const controller = new AbortController();
    actionControllers.current.add(controller);
    try {
      const { task } = await aiPlanApi.cancel(id, controller.signal);
      setTasks((current) => current.map((item) => item.id === id ? task : item));
    } catch (error) {
      if (!controller.signal.aborted) handleRequestError(error, "取消失败。");
    } finally { actionControllers.current.delete(controller); }
  };

  const finishDevelopmentLogin = async () => {
    if (devSubmitting || !devCode) return;
    if (!devBindingStarted) {
      setMessage("尚未绑定本地一次性 code，请先完成绑定。");
      return;
    }
    setDevSubmitting(true);
    setMessage(undefined);
    const controller = new AbortController();
    actionControllers.current.add(controller);
    try {
      await sessionApi.finishDevelopmentLogin(devCode, controller.signal);
      setDevFeedback("会话已创建，正在验证。");
      sessionStorage.removeItem("cmfx.dev.binding");
      if (!await readSession()) setMessage("服务端会话不可用，请重新登录。");
    } catch (error) {
      if (controller.signal.aborted) return;
      const rejected = error instanceof BrowserApiError && error.code === "DEV_LOGIN_REJECTED";
      if (rejected) {
        setDevBindingStarted(false);
        setDevFeedback(undefined);
        setDevCode("");
        sessionStorage.removeItem("cmfx.dev.binding");
      }
      setMessage(error instanceof Error ? error.message : "开发登录失败，请重新取得 code。");
    } finally {
      actionControllers.current.delete(controller);
      if (!controller.signal.aborted) setDevSubmitting(false);
    }
  };

  if (!session && !sessionLoading) {
    const loopback = location.hostname === "127.0.0.1" || location.hostname === "[::1]" || location.hostname === "::1";
    return <main className="ai-planner"><header className="ai-header"><button className="icon-button" aria-label="返回工作台" title="返回工作台" onClick={() => store.setView("workbench")}><ArrowLeft size={18} /></button><div><span className="eyebrow">SECURE SESSION</span><h1>AI 动画规划</h1></div></header><section className="ai-auth-panel"><ShieldAlert size={28} /><h2>需要服务端会话</h2><p>认证成功后才能读取素材或创建规划任务。</p><div className="ai-auth-actions">{!loopback && <button className="primary-command" onClick={() => sessionApi.startProductionLogin()}><LogIn size={16} />账号登录</button>}{loopback && <button className="secondary-command" disabled={devBindingStarted} onClick={() => { setMessage(undefined); setDevBindingStarted(true); setDevFeedback("已绑定，请在 5 分钟内输入终端 code。"); sessionStorage.setItem("cmfx.dev.binding", "1"); sessionApi.startDevelopmentLogin(); }}>{devBindingStarted ? "已绑定，请输入 code" : "绑定本地一次性 code"}</button>}</div>{devFeedback && <div role="status">{devFeedback}</div>}{loopback && <form onSubmit={(event) => { event.preventDefault(); void finishDevelopmentLogin(); }}><label className="ai-field">终端一次性 code<input type="password" autoComplete="one-time-code" value={devCode} disabled={devSubmitting} onChange={(event) => setDevCode(event.target.value)} /><small>code 单次有效，绑定后 5 分钟过期；服务重启后需重新取得。</small></label><button className="primary-command" disabled={!devCode || !devBindingStarted || devSubmitting}>{devSubmitting ? <LoaderCircle className="spin" size={16} /> : null}完成开发登录</button></form>}{message && <div className="ai-error" role="alert"><AlertTriangle size={16} /><span>{message}</span></div>}</section></main>;
  }

  return <main className="ai-planner">
    <header className="ai-header">
      <button className="icon-button" aria-label="返回工作台" title="返回工作台" onClick={() => store.setView("workbench")}><ArrowLeft size={18} /></button>
      <div><span className="eyebrow">MULTIMODAL PLANNER</span><h1>AI 动画规划</h1></div>
      {session && <div className="ai-session"><span>{session.principal.userId}</span><button className="icon-button" aria-label="退出登录" title="退出登录" onClick={() => void sessionApi.logout().then(() => readSession()).catch((error: Error) => setMessage(error.message))}><LogOut size={15} /></button></div>}
      <span className={`ai-provider-state ${configured ? "ready" : "offline"}`}><i />{configured ? "Provider 已连接" : configured === false ? "Provider 未配置" : "检查服务状态"}</span>
    </header>
    {message && <div className="ai-error" role="alert"><AlertTriangle size={16} /><span>{message}</span><button className="icon-button" aria-label="关闭错误" onClick={() => setMessage(undefined)}><X size={14} /></button></div>}
    <div className="ai-layout">
      <aside className="ai-input-panel">
        <div className="ai-section-head"><div><span className="eyebrow">INPUT</span><h2>规划输入</h2></div><WandSparkles size={20} /></div>
        <label className="ai-field">文本要求<textarea aria-label="动画规划文本" maxLength={20_000} rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} /><small>{prompt.length} / 20000</small></label>
        <div className="ai-form-grid">
          <fieldset><legend>画幅</legend><div className="format-segment">{Object.keys(AI_CANVAS_RATIOS).map((item) => <button type="button" key={item} className={ratio === item ? "selected" : ""} onClick={() => applyRatio(item as keyof typeof AI_CANVAS_RATIOS)}>{item}</button>)}</div><div className="ai-size-row"><input aria-label="画布宽度" type="number" min="2" max="8192" value={width} onChange={(event) => setWidth(event.target.valueAsNumber)} /><span>×</span><input aria-label="画布高度" type="number" min="2" max="8192" value={height} onChange={(event) => setHeight(event.target.valueAsNumber)} /></div></fieldset>
          <label className="ai-field">帧率<select value={fps} onChange={(event) => setFps(Number(event.target.value))}>{[24,25,30,50,60].map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="ai-field">时长<input type="number" min="0.5" max="60" step="0.5" value={duration} onChange={(event) => setDuration(event.target.valueAsNumber)} /></label>
        </div>
        <label className="ai-field">风格<input value={style} onChange={(event) => setStyle(event.target.value)} placeholder="极简, 纸张质感" /></label>
        <label className="ai-field">品牌语气<input value={tone} onChange={(event) => setTone(event.target.value)} placeholder="克制, 专业" /></label>
        <div className="ai-brand-colors"><span>品牌颜色</span>{colors.map((color, index) => <label key={index}><input aria-label={`品牌颜色 ${index + 1}`} type="color" value={color} onChange={(event) => setColors((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} />{color}{colors.length > 1 && <button className="icon-button" aria-label="删除颜色" onClick={() => setColors((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={12} /></button>}</label>)}{colors.length < 16 && <button className="icon-button" aria-label="添加颜色" onClick={() => setColors((current) => [...current, "#ffffff"])}><Plus size={13} /></button>}</div>
        <label className="ai-field">必须出现的文字<textarea rows={2} value={requiredText} onChange={(event) => setRequiredText(event.target.value)} placeholder="每行一项" /></label>
        <label className="ai-field">禁止内容<textarea rows={2} value={forbiddenContent} onChange={(event) => setForbiddenContent(event.target.value)} placeholder="每行一项" /></label>

        <div className="ai-assets-head"><span>安全素材</span><b>{selectedAssets.length} / 8</b></div>
        <div className="ai-upload-row"><select aria-label="上传用途" value={uploadPurpose} onChange={(event) => setUploadPurpose(event.target.value as AiAssetPurpose)}>{Object.entries(PURPOSE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input ref={fileInput} type="file" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadFile(file); }} /><button className="secondary-command" disabled={!scopes.has("assets:write") || uploading} onClick={() => fileInput.current?.click()}><Upload size={14} />上传</button>{uploading && <button className="icon-button" aria-label="取消上传" onClick={() => uploadController.current?.abort()}><OctagonX size={14} /></button>}{failedUpload && !uploading && <button className="text-button" onClick={() => void uploadFile(failedUpload)}>重试</button>}</div>
        <div className="ai-asset-filter"><select aria-label="素材类型筛选" value={assetKind} onChange={(event) => setAssetKind(event.target.value as BrowserMediaKind | "all")}><option value="all">全部类型</option><option value="image">图片</option><option value="svg">SVG</option><option value="audio">音频</option><option value="video">视频</option></select><button className="icon-button" aria-label="刷新素材" onClick={() => void loadAssets(false)}><RefreshCw size={14} /></button></div>
        <div className="ai-asset-picker" aria-busy={assetsLoading}>{assetsLoading && assets.length === 0 ? <div className="ai-empty"><LoaderCircle className="spin" />加载素材</div> : assets.length === 0 ? <div className="ai-empty">没有可用素材</div> : assets.map((asset) => <div key={asset.assetId} className={`ai-asset-option${selected[asset.assetId] ? " selected" : ""}`}><input aria-label={`选择 ${asset.displayName}`} type="checkbox" checked={Boolean(selected[asset.assetId])} disabled={!selected[asset.assetId] && selectedAssets.length >= 8} onChange={() => toggleAsset(asset)} /><span className="ai-asset-icon">{assetIcon(asset.kind)}</span><span><b>{asset.displayName}</b><small>{asset.codec} · {formatBytes(asset.bytes)}</small></span>{selected[asset.assetId] && <select aria-label={`${asset.displayName} 用途`} value={selected[asset.assetId]} onChange={(event) => setPurpose(asset, event.target.value as AiAssetPurpose)}>{asset.allowedPurposes.map((purpose) => <option key={purpose} value={purpose}>{PURPOSE_LABELS[purpose]}</option>)}</select>}</div>)}</div>
        {assetCursor && <button className="text-button ai-load-more" disabled={assetsLoading} onClick={() => void loadAssets(true)}>加载更多</button>}
        {!scopes.has("ai:plan") && <div className="ai-scope-warning"><ShieldAlert size={14} />当前会话缺少 ai:plan</div>}
        <button className="primary-command ai-submit" disabled={!canSubmit} onClick={() => void createTask()}>{submitting ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}创建规划任务</button>
      </aside>

      <section className="ai-workspace">
        <div className="ai-task-bar"><div><span className="eyebrow">SERVER TASKS</span><h2>{selectedTask ? phaseLabels[selectedTask.phase] : "等待输入"}</h2><small>{selectedTask ? new Date(selectedTask.updatedAt).toLocaleTimeString() : "状态以服务端为准"}</small></div>{selectedTask?.status === "running" && <button className="secondary-command danger" onClick={() => void cancelTask(selectedTask.id)}><OctagonX size={15} />取消</button>}{selectedTask?.status === "completed" && <span className="ai-status success"><CheckCircle2 size={15} />已完成</span>}</div>
        {tasks.length > 0 && <div className="ai-task-list" aria-label="AI 任务列表">{tasks.map((task) => <button key={task.id} className={task.id === selectedTask?.id ? "selected" : ""} onClick={() => setSelectedTaskId(task.id)}><span>{task.status}</span><b>{phaseLabels[task.phase]}</b><small>{new Date(task.createdAt).toLocaleTimeString()}</small></button>)}</div>}
        {selectedTask && (selectedTask.status === "running" || selectedTask.status === "cancelling") && <div className="ai-progress" role="status"><span><LoaderCircle className="spin" size={16} /><b>{phaseLabels[selectedTask.phase]}</b><small>{selectedTask.status === "cancelling" ? "正在取消" : selectedTask.progress?.localAssetId ?? "模型请求"}</small></span><div className="ai-progress-indeterminate"><i /></div></div>}
        {selectedTask?.error && <div className="ai-task-error" role="alert"><ShieldAlert size={18} /><span><b>{selectedTask.error.code}</b><small>{selectedTask.error.message}</small></span></div>}
        {!selectedTask?.result ? <div className="ai-result-empty"><Sparkles size={28} /><b>安全规划结果</b><span>服务端完成结构化校验后显示结果。</span></div> : <div className="ai-results"><section className="ai-result-band"><div className="ai-section-head"><div><span className="eyebrow">STORYBOARD</span><h2>镜头与效果</h2></div><b>{selectedTask.result.storyboard.shots.length} SHOTS</b></div><div className="storyboard-list">{selectedTask.result.storyboard.shots.map((shot) => <article key={shot.id}><span className="shot-time">{shot.range.start.toFixed(2)}–{shot.range.end.toFixed(2)}s</span><div><b>{shot.description}</b><small>{shot.layers.map((layer) => layer.description).join(" · ")}</small></div><div>{shot.effects.map((effect) => <code key={`${effect.effectId}-${effect.targetLayerId}`}>{effect.effectId}</code>)}</div></article>)}</div>{selectedTask.result.issues.map((issue) => <div className="ai-error" key={`${issue.code}-${issue.message}`}><AlertTriangle size={14} /><span><b>{issue.code}</b> {issue.message}</span></div>)}</section><button className="primary-command enter-editor" onClick={() => store.adoptEditableProject(selectedTask.result!.editableProject)}><Play size={16} />在 Editor 中打开</button></div>}
      </section>
    </div>
  </main>;
}
