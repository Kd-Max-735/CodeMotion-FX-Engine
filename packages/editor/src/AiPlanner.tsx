import {
  AlertTriangle,
  ArrowLeft,
  AudioLines,
  CheckCircle2,
  Film,
  FolderClock,
  LayoutTemplate,
  Music2,
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
  Trash2,
  Upload,
  WandSparkles,
  Zap,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  P0_EFFECT_CARDS,
  effectCardSearchTerms,
  explicitEffectCardRequests,
  explicitP0EffectRequest,
  extractExplicitAddedText,
  type EffectCard
} from "@codemotion/effects-2d";
import type { P0GenerationEffectId } from "@codemotion/ai-planner";
import { parseExplicitDuration } from "@codemotion/ai-planner/duration";
import { AI_CANVAS_RATIOS, aiPlanApi, buildAiPlanningInput, type BrowserAiPlanTaskView } from "./ai-plan-client.js";
import {
  mediaAssetApi,
  sessionApi,
  isLocalDevelopmentClient,
  BrowserApiError,
  type AiAssetPurpose,
  type BrowserAssetSummaryV1,
  type BrowserMediaKind,
  type BrowserSessionV1
} from "./media-asset-client.js";
import type { EditorStore } from "./store.js";
import { EffectCardPreview } from "./EffectCardPreview.js";

const phaseLabels: Record<BrowserAiPlanTaskView["phase"], string> = {
  accepted: "服务端已接受",
  validate: "复核素材完整性",
  upload: "上传至 Provider",
  process: "Provider 处理素材",
  infer: "模型结构化理解",
  cleanup: "清理远端临时文件",
  plan: "确定性生成工程"
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
  const [sessionError, setSessionError] = useState<{ code: string; message: string }>();
  const sessionController = useRef<AbortController | undefined>(undefined);
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
  const [durationTouched, setDurationTouched] = useState(false);
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
  const [deletingAssetId, setDeletingAssetId] = useState<string>();
  const [selectedEffectId, setSelectedEffectId] = useState<P0GenerationEffectId>();
  const [cardSearch, setCardSearch] = useState("");
  const sessionKey = identity(session);
  const scopes = new Set(session?.principal.scopes ?? []);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? tasks[0];

  const readSession = useCallback(async (): Promise<boolean> => {
    if (sessionController.current) return false;
    const controller = new AbortController();
    sessionController.current = controller;
    const timeout = window.setTimeout(() => controller.abort("SESSION_TIMEOUT"), 10_000);
    setSessionLoading(true);
    setSessionError(undefined);
    try {
      const next = await sessionApi.readWithDevelopmentFallback(controller.signal);
      if (controller.signal.aborted) return false;
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
      const timedOut = controller.signal.aborted && controller.signal.reason === "SESSION_TIMEOUT";
      if (controller.signal.aborted && !timedOut) return false;
      setSession(undefined);
      setAssets([]);
      setSelected({});
      setTasks([]);
      setConfigured(undefined);
      const failure = timedOut
        ? { code: "SESSION_TIMEOUT", message: "服务暂时无响应" }
        : error instanceof BrowserApiError
          ? { code: error.status === 401 ? "SESSION_AUTH_REQUIRED" : error.code, message: error.message }
          : { code: "SESSION_NETWORK_ERROR", message: "认证服务网络请求失败" };
      setSessionError(failure);
      setMessage(failure.message);
      return false;
    } finally {
      window.clearTimeout(timeout);
      if (sessionController.current === controller) sessionController.current = undefined;
      if (!controller.signal.aborted || controller.signal.reason === "SESSION_TIMEOUT") setSessionLoading(false);
    }
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
    void readSession();
    return () => {
      const activeSession = sessionController.current;
      activeSession?.abort("COMPONENT_UNMOUNTED");
      if (sessionController.current === activeSession) sessionController.current = undefined;
    };
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
    sessionController.current?.abort("COMPONENT_UNMOUNTED");
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

  const deleteAsset = async (asset: BrowserAssetSummaryV1) => {
    if (!scopes.has("assets:write") || deletingAssetId !== undefined) return;
    if (project.assets.some((item) => item.id === asset.assetId)) {
      setMessage("该素材正被当前工程使用，不能删除。");
      return;
    }
    if (!window.confirm(`确认删除素材“${asset.displayName}”吗？此操作只影响这一项素材。`)) return;
    const controller = new AbortController();
    actionControllers.current.add(controller);
    setDeletingAssetId(asset.assetId);
    try {
      await mediaAssetApi.delete(asset.assetId, controller.signal);
      setSelected((current) => {
        const next = { ...current };
        delete next[asset.assetId];
        return next;
      });
      await loadAssets(false);
      setMessage(undefined);
    } catch (error) {
      if (!controller.signal.aborted) handleRequestError(error, "素材删除失败。");
    } finally {
      actionControllers.current.delete(controller);
      if (!controller.signal.aborted) setDeletingAssetId(undefined);
    }
  };

  const selectedAssets = useMemo(() => Object.entries(selected).flatMap(([assetId, purpose]) => {
    const asset = assets.find((item) => item.assetId === assetId);
    return asset?.allowedPurposes.includes(purpose) ? [{ assetId, purpose }] : [];
  }), [selected, assets]);

  const selectedAssetSummaries = selectedAssets.flatMap((reference) => {
    const asset = assets.find((item) => item.assetId === reference.assetId);
    return asset ? [asset] : [];
  });
  const visualAssets = selectedAssetSummaries.filter((asset) => asset.kind === "image" || asset.kind === "video");
  const videoDurationLimit = Math.min(...visualAssets.filter((asset) => asset.kind === "video")
    .map((asset) => asset.durationSeconds ?? Number.POSITIVE_INFINITY));
  useEffect(() => {
    if (durationTouched || visualAssets.length === 0) return;
    setDuration(Number.isFinite(videoDurationLimit) ? Math.max(0.5, videoDurationLimit) : 5);
  }, [durationTouched, visualAssets.map((asset) => asset.assetId).join("\0"), videoDurationLimit]);
  const requestedCards = explicitEffectCardRequests(prompt);
  const describedDuration = parseExplicitDuration(prompt);
  const effectiveDuration = describedDuration.kind === "valid" ? describedDuration.seconds : duration;
  const durationProblem = describedDuration.kind === "invalid"
    ? describedDuration.code === "DURATION_OUT_OF_RANGE"
      ? "描述中的时长必须在 0.5 到 60 秒之间。"
      : describedDuration.code === "DURATION_AMBIGUOUS"
        ? "描述中包含互相冲突的多个时长，请只保留一个明确时长。"
        : "描述中的时长格式无法识别，请使用例如“输出视频时长为 6 秒”。"
    : undefined;
  const requestedP0Effect = explicitP0EffectRequest(prompt);
  const unsupportedRequestedEffect = requestedP0Effect !== undefined
    && !P0_EFFECT_CARDS.some((card) => card.effectId === requestedP0Effect.effectId);
  const promptConflict = selectedEffectId !== undefined && /(?:不要|删除|去掉|替换)/u.test(prompt)
    && requestedCards.some((card) => card.effectId === selectedEffectId);
  const requestedCard = selectedEffectId
    ? P0_EFFECT_CARDS.find((card) => card.effectId === selectedEffectId)
    : requestedCards.length === 1 ? requestedCards[0] : undefined;
  const requiredVisualCount = requestedCards.some((card) => card.fixture.secondaryInput) || requestedCard?.fixture.secondaryInput ? 2 : 1;
  const requiresNewText = requestedCards.some((card) => card.effectId === "fx.text.typewriter" || card.effectId === "fx.draw.handwriting")
    || requestedCard?.effectId === "fx.text.typewriter" || requestedCard?.effectId === "fx.draw.handwriting";
  const hasRequestedNewText = extractExplicitAddedText(prompt) !== undefined
    || requiredText.trim().length > 0;
  const normalizedCardSearch = cardSearch.trim().toLocaleLowerCase();
  const visibleCards = P0_EFFECT_CARDS.filter((card) => normalizedCardSearch.length === 0
    || [card.effectId, ...effectCardSearchTerms(card)].some((term) => term.toLocaleLowerCase().includes(normalizedCardSearch)));
  const visibleCardGroups = [...new Set(visibleCards.map((card) => card.category))].map((category) => ({
    category,
    label: visibleCards.find((card) => card.category === category)!.categoryLabel,
    cards: visibleCards.filter((card) => card.category === category)
  }));
  const cardDisabledReason = (card: EffectCard): string | undefined => {
    const expectedVisualCount = card.fixture.secondaryInput ? 2 : 1;
    if (visualAssets.length !== expectedVisualCount) {
      return expectedVisualCount === 2 ? "请先选择两个不同的图片或视频素材" : "请先选择一个图片或视频素材";
    }
    if (card.fixture.inputKind === "text" && !hasRequestedNewText) return "请先在描述中明确要新增的文字";
    return undefined;
  };
  const input = buildAiPlanningInput({ prompt, selectedEffectId, assets: selectedAssets, width, height, fps,
    durationSeconds: effectiveDuration, style, colors, tone, requiredText, forbiddenContent });
  const inputProblem = prompt.trim().length === 0 ? "请输入针对所选素材的自然语言特效说明。"
    : durationProblem ? durationProblem
    : visualAssets.length === 0 ? "请至少选择一张图片或一个视频；音频不能代替视觉素材。"
      : visualAssets.length > 2 ? "首轮最多使用两个视觉素材，请取消多余的图片或视频。"
        : Number.isFinite(videoDurationLimit) && effectiveDuration > videoDurationLimit ? `视频项目时长不能超过最短源视频的 ${videoDurationLimit.toFixed(2)} 秒；首轮不会自动循环或延长视频。`
        : unsupportedRequestedEffect ? "该特效暂未开放生成入口，请从当前 8 个样板特效中选择。"
        : promptConflict ? "所选特效与自然语言明确冲突，请修改描述或取消卡片选择。"
            : visualAssets.length !== requiredVisualCount
              ? requiredVisualCount === 2 ? "该特效需要且只能选择两个图片或视频。" : "该特效需要且只能选择一个图片或视频。"
              : requiresNewText && !hasRequestedNewText ? "请在说明中用引号写明要新增的完整文字内容。"
                : selectedAssetSummaries.some((asset) => asset.kind === "svg") ? "本轮生成入口仅接受图片或视频作为视觉素材。"
                  : undefined;
  const formValid = Number.isInteger(width) && width >= 2 && width <= 8192
    && Number.isInteger(height) && height >= 2 && height <= 8192 && width * height <= 33_554_432
    && Number.isInteger(fps) && fps >= 1 && fps <= 60
    && Number.isFinite(effectiveDuration) && effectiveDuration >= 0.5 && effectiveDuration <= 60
    && inputProblem === undefined
    && selectedAssets.length === Object.keys(selected).length && selectedAssets.length <= 8
    && colors.every((item) => /^#[0-9a-f]{6}$/i.test(item));
  const canSubmit = Boolean(session && scopes.has("ai:plan") && configured && !submitting && formValid);
  const submitDisabledReason = submitting ? "正在生成，请等待当前请求完成。"
    : !session ? "本地会话尚未建立。"
      : !scopes.has("ai:plan") ? "当前账号没有生成权限。"
        : configured === false ? "模型服务未配置。"
          : inputProblem ?? (!formValid ? "请检查画幅、时长与颜色设置。" : undefined)
            ;
  const uploadDisabledReason = uploading ? "素材正在上传。"
    : !scopes.has("assets:write") ? "当前账号没有素材上传权限。" : undefined;

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

  if (sessionLoading) {
    return <main className="ai-planner creator-workspace"><header className="creator-header"><div className="creator-brand"><span>CM</span><b>CodeMotion FX</b></div></header><section className="creator-session-loading" role="status"><LoaderCircle className="spin" size={20} /><span>正在加载创作页面…</span></section></main>;
  }
  if (!session) {
    const localDevelopment = isLocalDevelopmentClient();
    return <main className="ai-planner"><header className="ai-header"><button className="icon-button" aria-label="返回工作台" title="返回工作台" onClick={() => store.setView("workbench")}><ArrowLeft size={18} /></button><div><h1>AI 创作</h1></div></header><section className="ai-auth-panel"><ShieldAlert size={28} /><h2>{sessionError?.code === "SESSION_TIMEOUT" ? "服务暂时无响应" : localDevelopment ? "本地会话创建失败" : "请登录"}</h2><p>{sessionError?.message ?? (localDevelopment ? "请从固定本地地址访问后重试。" : "登录后即可选择素材并生成视频。")}</p>{sessionError && <code>{sessionError.code}</code>}<div className="ai-auth-actions"><button className="primary-command" disabled={sessionLoading} onClick={() => void readSession()}><RefreshCw size={16} />重试</button>{!localDevelopment && sessionError?.code === "SESSION_AUTH_REQUIRED" && <button className="secondary-command" onClick={() => sessionApi.startProductionLogin()}><LogIn size={16} />账号登录</button>}<button className="secondary-command" onClick={() => store.setView("workbench")}><ArrowLeft size={16} />返回工作台</button></div></section></main>;
  }

  return <main className="ai-planner creator-workspace">
    <header className="creator-header">
      <button className="creator-brand" onClick={() => store.setView("ai-planner")}><span>CM</span><b>CodeMotion FX</b></button>
      <nav className="creator-nav" aria-label="创作功能">
        <button className="active" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><Sparkles size={15} />AI 创作</button>
        <button onClick={() => document.getElementById("effect-gallery")?.scrollIntoView()}><Zap size={15} />特效</button>
        <button onClick={() => store.setView("workbench")}><LayoutTemplate size={15} />模板</button>
        <button onClick={() => document.getElementById("material-picker")?.scrollIntoView()}><ImageIcon size={15} />我的素材</button>
        <button onClick={() => { setAssetKind("audio"); document.getElementById("material-picker")?.scrollIntoView(); }}><Music2 size={15} />音频</button>
        <button onClick={() => store.setView("workbench")}><FolderClock size={15} />最近项目</button>
      </nav>
      {session && <button className="creator-user" title="退出登录" onClick={() => void sessionApi.logout().then(() => readSession()).catch((error: Error) => setMessage(error.message))}>{session?.principal.userId.slice(0, 2).toUpperCase()}</button>}
    </header>
    {message && <div className="ai-error" role="alert"><AlertTriangle size={16} /><span>{message}</span><button className="icon-button" aria-label="关闭错误" onClick={() => setMessage(undefined)}><X size={14} /></button></div>}
    <div className="creator-layout">
      <aside className="creator-input-panel">
        <div className="creator-title"><div><span>新建视频</span><h1>描述你想制作的画面</h1></div><WandSparkles size={22} /></div>
        <label className="creator-prompt"><textarea aria-label="描述视频内容" maxLength={20_000} rows={5} placeholder="例如：用科技霓虹风格展示我的产品图片，标题为“笔唯思”" value={prompt} onChange={(event) => setPrompt(event.target.value)} /><small>{prompt.length} / 20000</small></label>
        {selectedEffectId && <div className="selected-effect"><Zap size={14} /><span>已选择 {P0_EFFECT_CARDS.find((card) => card.effectId === selectedEffectId)?.name}</span><button aria-label="取消选择特效" onClick={() => setSelectedEffectId(undefined)}><X size={13} /></button></div>}
        <div className="ai-form-grid">
          <fieldset><legend>画幅</legend><div className="format-segment">{Object.keys(AI_CANVAS_RATIOS).map((item) => <button type="button" key={item} className={ratio === item ? "active" : ""} aria-pressed={ratio === item} onClick={() => applyRatio(item as keyof typeof AI_CANVAS_RATIOS)}>{item}</button>)}</div></fieldset>
          <label className="ai-field">时长（秒）<input aria-label="视频时长" type="number" min="0.5" max={Number.isFinite(videoDurationLimit) ? videoDurationLimit : 60} step="0.5" value={effectiveDuration} readOnly={describedDuration.kind === "valid"} title={describedDuration.kind === "valid" ? "自然语言中的明确时长优先" : "未在描述中指定时长，可在这里设置"} onChange={(event) => { setDurationTouched(true); setDuration(event.target.valueAsNumber); }} />{describedDuration.kind === "valid" && <small className="ai-duration-source">{effectiveDuration} 秒（来自描述）</small>}</label>
        </div>
        <div className="ai-assets-head" id="material-picker"><span>选择素材</span><b>{visualAssets.length} 个视觉素材 · {selectedAssets.length - visualAssets.length} 个音频</b><button type="button" className="text-button" disabled={selectedAssets.length === 0} onClick={() => setSelected({})}>取消全选</button></div>
        <div className="ai-upload-row"><select aria-label="上传用途" value={uploadPurpose} onChange={(event) => setUploadPurpose(event.target.value as AiAssetPurpose)}>{Object.entries(PURPOSE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input ref={fileInput} type="file" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadFile(file); }} /><button className="secondary-command" disabled={Boolean(uploadDisabledReason)} title={uploadDisabledReason ?? "上传图片、视频或音频"} onClick={() => fileInput.current?.click()}><Upload size={14} />上传</button>{uploading && <button className="icon-button" aria-label="取消上传" onClick={() => uploadController.current?.abort()}><OctagonX size={14} /></button>}{failedUpload && !uploading && <button className="text-button" onClick={() => void uploadFile(failedUpload!)}>重试</button>}</div>
        <div className="ai-asset-filter"><select aria-label="素材类型筛选" value={assetKind} onChange={(event) => setAssetKind(event.target.value as BrowserMediaKind | "all")}><option value="all">全部类型</option><option value="image">图片</option><option value="svg">SVG</option><option value="audio">音频</option><option value="video">视频</option></select><button className="icon-button" aria-label="刷新素材" onClick={() => void loadAssets(false)}><RefreshCw size={14} /></button></div>
        <div className="ai-asset-picker" aria-busy={assetsLoading}>{assetsLoading && assets.length === 0 ? <div className="ai-empty"><LoaderCircle className="spin" />加载素材</div> : assets.length === 0 ? <div className="ai-empty">没有可用素材</div> : assets.map((asset) => <div key={asset.assetId} className={`ai-asset-option${selected[asset.assetId] ? " selected" : ""}`}><input aria-label={`选择 ${asset.displayName}`} title={!selected[asset.assetId] && selectedAssets.length >= 8 ? "最多选择 8 个素材。" : `选择 ${asset.displayName}`} type="checkbox" checked={Boolean(selected[asset.assetId])} disabled={!selected[asset.assetId] && selectedAssets.length >= 8} onChange={() => toggleAsset(asset)} /><span className="ai-asset-icon">{assetIcon(asset.kind)}</span><span><b>{asset.displayName}</b><small>{asset.codec} · {formatBytes(asset.bytes)}</small></span>{selected[asset.assetId] && <select aria-label={`${asset.displayName} 用途`} value={selected[asset.assetId]} onChange={(event) => setPurpose(asset, event.target.value as AiAssetPurpose)}>{asset.allowedPurposes.map((purpose) => <option key={purpose} value={purpose}>{PURPOSE_LABELS[purpose]}</option>)}</select>}<button type="button" className="icon-button ai-asset-delete" aria-label={`删除 ${asset.displayName}`} title="删除这一项素材" disabled={deletingAssetId !== undefined || !scopes.has("assets:write")} onClick={() => void deleteAsset(asset)}>{deletingAssetId === asset.assetId ? <LoaderCircle className="spin" size={13} /> : <Trash2 size={13} />}</button></div>)}</div>
        {assetCursor && <button className="text-button ai-load-more" disabled={assetsLoading} title={assetsLoading ? "素材正在加载。" : "加载更多素材"} onClick={() => void loadAssets(true)}>加载更多</button>}
        <details className="creator-advanced"><summary>更多设置</summary><div className="ai-size-row"><input aria-label="画布宽度" type="number" min="2" max="8192" value={width} onChange={(event) => setWidth(event.target.valueAsNumber)} /><span>×</span><input aria-label="画布高度" type="number" min="2" max="8192" value={height} onChange={(event) => setHeight(event.target.valueAsNumber)} /></div><label className="ai-field">帧率<select value={fps} onChange={(event) => setFps(Number(event.target.value))}>{[24,25,30,50,60].map((item) => <option key={item}>{item}</option>)}</select></label><label className="ai-field">风格<input value={style} onChange={(event) => setStyle(event.target.value)} /></label><label className="ai-field">语气<input value={tone} onChange={(event) => setTone(event.target.value)} /></label><label className="ai-field">必须出现的文字<textarea rows={2} value={requiredText} onChange={(event) => setRequiredText(event.target.value)} /></label><label className="ai-field">禁止内容<textarea rows={2} value={forbiddenContent} onChange={(event) => setForbiddenContent(event.target.value)} /></label><div className="ai-brand-colors"><span>颜色</span>{colors.map((color, index) => <label key={index}><input aria-label={`品牌颜色 ${index + 1}`} type="color" value={color} onChange={(event) => setColors((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} />{color}{colors.length > 1 && <button className="icon-button" aria-label="删除颜色" onClick={() => setColors((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={12} /></button>}</label>)}{colors.length < 16 && <button className="icon-button" aria-label="添加颜色" onClick={() => setColors((current) => [...current, "#ffffff"])}><Plus size={13} /></button>}</div></details>
        {!scopes.has("ai:plan") && <div className="ai-scope-warning"><ShieldAlert size={14} />当前账号不能生成视频</div>}
        {inputProblem && <div className="ai-input-guidance" role="status"><AlertTriangle size={14} />{inputProblem}</div>}
        <button className="primary-command ai-submit" disabled={!canSubmit} title={submitDisabledReason ?? "生成视频"} onClick={() => void createTask()}>{submitting ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}生成视频</button>
        {import.meta.env.DEV && <details className="developer-diagnostics"><summary>开发诊断</summary><code>{configured ? "MODEL_READY" : configured === false ? "MODEL_NOT_CONFIGURED" : "MODEL_CHECKING"}</code><code>{session ? "LOCAL_SESSION_READY" : "LOCAL_SESSION_PENDING"}</code></details>}
      </aside>

      <section className="effect-gallery" id="effect-gallery">
        <div className="gallery-heading"><div><span>P0 特效目录</span><h2>悬停查看真实效果</h2></div><b>40 个 verified / pending-human</b></div>
        <label className="effect-card-search">搜索特效<input type="search" value={cardSearch} placeholder="名称、分类或 Effect ID" onChange={(event) => setCardSearch(event.target.value)} /><small>{visibleCards.length} / 40</small></label>
        {visibleCardGroups.map((group) => <section className="effect-card-category" key={group.category} aria-label={group.label}><header><h3>{group.label}</h3><span>{group.cards.length} 个</span></header><div className="creator-card-grid">{group.cards.map((card) => {
          const disabledReason = cardDisabledReason(card);
          return <EffectCardPreview key={card.id} card={card} canAdd={disabledReason === undefined} {...(disabledReason ? { disabledReason } : {})} selected={selectedEffectId === card.effectId} actionLabel={selectedEffectId === card.effectId ? "已选择" : "选择"} addTitle={disabledReason ?? `选择${card.name}`} onAdd={() => setSelectedEffectId((current) => current === card.effectId ? undefined : card.effectId)} onDragStart={(event) => event.preventDefault()} />;
        })}</div></section>)}
        {visibleCards.length === 0 && <div className="ai-empty">没有匹配的特效卡片</div>}
        {selectedTask && <section className="creation-status" aria-label="一次性 AI 规划状态">
          {selectedTask.status === "running" || selectedTask.status === "cancelling" ? <LoaderCircle className="spin" size={17} /> : selectedTask.status === "completed" ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
          <span><b>{phaseLabels[selectedTask.phase]}</b><small>{selectedTask.status === "cancelling" ? "正在取消" : selectedTask.status === "completed" ? "服务端已完成确定性工程生成" : selectedTask.error?.message ?? "单次 Ark 规划正在执行"}</small></span>
          {selectedTask.status === "running" && <button onClick={() => void cancelTask(selectedTask.id)}>取消</button>}
          {selectedTask.result && <button onClick={() => store.adoptEditableProject(selectedTask.result!.editableProject)}>进入编辑器</button>}
        </section>}
        {tasks.length > 0 && <div className="ai-task-list" aria-label="AI 任务列表">{tasks.map((task) => <button key={task.id} className={task.id === selectedTask?.id ? "selected" : ""} onClick={() => setSelectedTaskId(task.id)}><span>{task.status}</span><b>{phaseLabels[task.phase]}</b><small>{new Date(task.createdAt).toLocaleTimeString()}</small></button>)}</div>}
        <section className="recent-projects"><div className="gallery-heading"><div><span>继续创作</span><h2>最近项目</h2></div></div><button onClick={() => store.setView("editor")}><Film size={20} /><span><b>{project.name}</b><small>{project.width} × {project.height} · {project.duration.toFixed(1)} 秒</small></span><Play size={15} /></button></section>
      </section>
    </div>
  </main>;
}
