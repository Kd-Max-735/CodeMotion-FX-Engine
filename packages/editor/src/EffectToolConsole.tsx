import {
  Check, ChevronDown, Clock3, Copy, FileImage, LoaderCircle, Menu, Paperclip,
  Plus, Search, Send, Settings, Square, Wrench, X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import { nativeEffectToolApi, type NativeEffectTurn, type NativeEffectToolView } from "./effect-tool-client.js";
import { BrowserApiError, mediaAssetApi, sessionApi, type BrowserAssetSummaryV1, type BrowserSessionV1 } from "./media-asset-client.js";

type ConversationEntry = Readonly<{ id: string; role: "user"; content: string; asset?: BrowserAssetSummaryV1 }> |
  Readonly<{ id: string; role: "assistant"; turn: NativeEffectTurn; elapsedMs: number }>;

function renderSize(asset: BrowserAssetSummaryV1 | undefined): { width: number; height: number } {
  const sourceWidth = asset?.width ?? 960;
  const sourceHeight = asset?.height ?? 540;
  const scale = Math.min(1, 960 / sourceWidth, 540 / sourceHeight);
  return { width: Math.max(1, Math.round(sourceWidth * scale)), height: Math.max(1, Math.round(sourceHeight * scale)) };
}

function errorMessage(error: unknown): string {
  if (error instanceof BrowserApiError) {
    if (error.code === "ARK_PROVIDER_UNAVAILABLE") return "Ark 尚未配置，请检查服务器 ARK_API_KEY。";
    if (error.code === "EFFECT_TOOL_REQUEST_INVALID") return "执行工具前需要选择一张已授权的图片或视频素材。";
    return `${error.message} (${error.code})`;
  }
  return error instanceof Error ? error.message : "请求失败。";
}

function formatElapsed(milliseconds: number): string {
  return milliseconds < 1_000 ? `${milliseconds} 毫秒` : `${(milliseconds / 1_000).toFixed(1)} 秒`;
}

function FramePreview({ executionId }: { executionId: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    void nativeEffectToolApi.frame(executionId, controller.signal).then((frame) => {
      if (controller.signal.aborted || canvas.current === null) return;
      canvas.current.width = frame.width;
      canvas.current.height = frame.height;
      const context = canvas.current.getContext("2d");
      if (context === null) throw new Error("Canvas 2D context is unavailable.");
      context.putImageData(new ImageData(frame.data, frame.width, frame.height), 0, 0);
    }).catch((cause) => { if (!controller.signal.aborted) setError(errorMessage(cause)); });
    return () => controller.abort();
  }, [executionId]);
  return error ? <div className="artifact-error">{error}</div> : <canvas ref={canvas} className="artifact-preview" aria-label="胶片颗粒执行预览" />;
}

function ToolResult({ turn }: { turn: Extract<NativeEffectTurn, { kind: "tool_call" }> }) {
  const envelope = { type: turn.toolCall.function.name, data: turn.toolCall.function.arguments };
  return (
    <div className="turn-section">
      <div className="section-heading"><span className="section-icon tool-section-icon"><Wrench size={12} /></span><strong>工具调用</strong><span>1 个工具</span></div>
      <details className="tool-card succeeded" open>
        <summary className="tool-head">
          <span className="tool-icon">FG</span>
          <span className="tool-copy"><strong>胶片颗粒</strong><code>film_grain</code></span>
          <span className="tool-state"><i />已完成<ChevronDown size={13} /></span>
        </summary>
        <div className="tool-detail">
          <span>Tool Call · {turn.toolCall.id}</span>
          <pre>{JSON.stringify(envelope, null, 2)}</pre>
          <div className="execution-line"><b>{turn.execution.result.backendId}</b><em>{turn.execution.result.degraded ? "降级执行" : "标准执行"}</em></div>
        </div>
      </details>
      <section className="artifact-card">
        <div className="artifact-head"><div><strong>生成结果</strong><small>film_grain · 服务器渲染</small></div><span><Check size={12} />已完成</span></div>
        <FramePreview executionId={turn.execution.id} />
      </section>
    </div>
  );
}

export function EffectToolConsole() {
  const fileInput = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<BrowserSessionV1>();
  const [tool, setTool] = useState<NativeEffectToolView>();
  const [assets, setAssets] = useState<BrowserAssetSummaryV1[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string>();
  const [entries, setEntries] = useState<ConversationEntry[]>([]);
  const [prompt, setPrompt] = useState("");
  const [thinking, setThinking] = useState(true);
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();
  const visualAssets = useMemo(() => assets.filter((asset) => asset.kind === "image" || asset.kind === "svg" || asset.kind === "video"), [assets]);
  const selectedAsset = visualAssets.find((asset) => asset.assetId === selectedAssetId);
  const artifactTotal = entries.filter((entry) => entry.role === "assistant" && entry.turn.kind === "tool_call").length;

  useEffect(() => {
    document.title = "AE Agent";
    const controller = new AbortController();
    void (async () => {
      const nextSession = await sessionApi.readWithDevelopmentFallback(controller.signal);
      const [nextTool, page] = await Promise.all([nativeEffectToolApi.describe(controller.signal), mediaAssetApi.list({ limit: 50 }, controller.signal)]);
      return [nextSession, nextTool, page] as const;
    })().then(([nextSession, nextTool, page]) => {
      if (controller.signal.aborted) return;
      setSession(nextSession);
      setTool(nextTool);
      setAssets(page.items);
      setSelectedAssetId(page.items.find((asset) => asset.kind === "image" || asset.kind === "svg" || asset.kind === "video")?.assetId);
    }).catch((cause) => { if (!controller.signal.aborted) setError(errorMessage(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [entries, busy]);

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file === undefined) return;
    setUploading(true);
    setError(undefined);
    try {
      const asset = await mediaAssetApi.upload(file, file.type.startsWith("video/") ? "reference-video" : "reference-image");
      setAssets((current) => [asset, ...current.filter((item) => item.assetId !== asset.assetId)]);
      setSelectedAssetId(asset.assetId);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setUploading(false); }
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const value = prompt.trim();
    if (value.length === 0 || busy) return;
    const startedAt = performance.now();
    setPrompt("");
    setError(undefined);
    setBusy(true);
    setToolMenuOpen(false);
    setEntries((current) => [...current, { id: crypto.randomUUID(), role: "user", content: value, ...(selectedAsset === undefined ? {} : { asset: selectedAsset }) }]);
    try {
      const size = renderSize(selectedAsset);
      const turn = await nativeEffectToolApi.turn({ prompt: value, ...(selectedAssetId === undefined ? {} : { sourceFrameId: selectedAssetId }), ...size });
      setEntries((current) => [...current, { id: crypto.randomUUID(), role: "assistant", turn, elapsedMs: Math.max(1, Math.round(performance.now() - startedAt)) }]);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); }
  };

  const reset = () => { setEntries([]); setPrompt(""); setError(undefined); };

  return (
    <div className="ae-agent app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <button className="brand" type="button"><span className="brand-mark">AE</span><strong>AE Agent</strong><ChevronDown size={14} /></button>
          <button className="sidebar-icon" type="button" title="搜索"><Search size={16} /></button>
        </div>
        <button className="new-session" type="button" onClick={reset}><Plus className="compose-icon" size={18} /><strong>新对话</strong></button>
        <div className="sidebar-scroll"><div className="side-label">对话</div><button className="session-row active" type="button"><span><strong>特效创作</strong><small>{loading ? "准备中" : `${entries.length} 条消息`}</small></span></button></div>
        <div className="sidebar-foot"><span className={`status-dot ${tool?.configured ? "online" : ""}`} /><span>{tool?.configured ? "Doubao 2.0 Lite 已连接" : "模型未连接"}</span><button type="button" title="设置"><Settings size={15} /></button></div>
      </aside>

      <main className="conversation">
        <header className="topbar">
          <div><button className="mobile-menu" type="button" title="菜单"><Menu size={17} /></button><strong>特效创作</strong><span>{busy ? "运行中" : "就绪"}</span></div>
          <div className="top-actions"><span>{artifactTotal} 个产物</span><button className="icon-button" type="button" title="停止当前任务" disabled={!busy}><Square size={10} /></button></div>
        </header>
        <section className="messages">
          {error && <div className="agent-error" role="alert"><X size={15} />{error}</div>}
          {entries.length === 0 && !loading && <div className="empty-state"><div className="empty-mark"><span>›</span><i>_</i></div><h1>想要创作什么特效？</h1><p>上传图片或直接描述需求。Doubao 会理解请求，并决定回答问题或调用已加载的胶片颗粒工具。</p><div className="starter-prompts"><button type="button" onClick={() => setPrompt("给画面添加粗粝的16mm胶片颗粒，暗部明显一些")}>16mm 胶片颗粒</button><button type="button" onClick={() => setPrompt("temporal 参数有什么作用？")}>询问参数</button></div></div>}
          {loading && <div className="empty-state compact"><LoaderCircle className="spin" size={23} /><p>正在连接服务器</p></div>}
          {entries.map((entry) => entry.role === "user" ? (
            <article key={entry.id} className="message user"><div className="user-message"><div className="user-bubble-row"><button className="copy-prompt" type="button" title="复制提示词" onClick={() => void navigator.clipboard.writeText(entry.content)}><Copy size={15} /></button><div className="user-bubble">{entry.content}</div></div><div className="user-tools"><span>胶片颗粒 · film_grain</span></div>{entry.asset && <div className="user-assets"><span className="user-file"><FileImage size={13} />{entry.asset.displayName}</span></div>}</div></article>
          ) : (
            <article key={entry.id} className="message agent-message"><div className="agent-avatar">AE</div><div className="agent-content"><div className="turn-duration"><Clock3 size={13} /><span>已思考 <b>{formatElapsed(entry.elapsedMs)}</b></span></div>{thinking && entry.turn.reasoningContent && <details className="process-section" open><summary><span className="section-icon thinking-icon" /><strong>深度思考</strong><span className="process-summary">理解需求并判断是否调用工具</span><ChevronDown className="process-chevron" size={13} /></summary><div className="process-timeline"><div className="thinking-row completed"><span className="thinking-dot" /><p>{entry.turn.reasoningContent}</p><small>完成</small></div></div></details>}{entry.turn.content && <div className="assistant-text markdown-body"><p>{entry.turn.content}</p></div>}{entry.turn.kind === "tool_call" && <ToolResult turn={entry.turn} />}</div></article>
          ))}
          {busy && <article className="message agent-message"><div className="agent-avatar">AE</div><div className="agent-content"><div className="turn-duration running"><LoaderCircle className="spin" size={13} /><span>正在理解请求并判断是否调用工具</span></div></div></article>}
          <div ref={end} />
        </section>
        <footer className="composer-wrap">
          <form className="composer-shell" onSubmit={(event) => void submit(event)}>
            <div className="selected-tool-tray"><span><Wrench size={12} /><b>胶片颗粒</b><code>film_grain</code></span>{selectedAsset && <button type="button" title="切换服务器素材" onClick={() => fileInput.current?.click()}><FileImage size={12} />{selectedAsset.displayName}</button>}</div>
            <textarea rows={1} maxLength={4_000} placeholder="输入特效创作需求" value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={onComposerKeyDown} />
            <div className="composer-toolbar">
              <label className="attach-button" title="上传文件或图片"><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,video/mp4,video/webm" aria-label="上传文件或图片" onChange={(event) => void upload(event)} />{uploading ? <LoaderCircle className="spin" size={16} /> : <Paperclip size={17} />}</label>
              <label className="thinking-toggle"><input type="checkbox" checked={thinking} onChange={(event) => setThinking(event.target.checked)} /><span>深度思考</span></label>
              <div className="composer-actions-right"><span className="model-label">Doubao 2.0 Lite</span><div className="tool-picker"><button className="tool-picker-button" type="button" aria-label="添加工具" aria-expanded={toolMenuOpen} onClick={() => setToolMenuOpen((current) => !current)}><Plus size={15} /><b>工具</b><i>1</i></button>{toolMenuOpen && <div className="tool-menu" role="dialog" aria-label="添加工具"><div className="tool-menu-head"><div><strong>已加载工具</strong><small>当前仅开放 1 个工具</small></div><button type="button" title="关闭" onClick={() => setToolMenuOpen(false)}><X size={15} /></button></div><button className="tool-option is-selected" type="button" aria-pressed="true"><span className="tool-option-copy"><span className="tool-option-heading"><strong>胶片颗粒</strong><b>图像特效</b></span><small>film_grain</small><em>为服务器素材添加可控的动态胶片颗粒。</em></span><span className="tool-option-action selected"><Check size={13} />已加载</span></button></div>}</div><button className="send-button" type="submit" title="发送" disabled={busy || prompt.trim().length === 0}>{busy ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}</button></div>
            </div>
          </form>
          <small className="composer-note">AI 生成内容可能不准确，请检查重要结果。</small>
        </footer>
      </main>
    </div>
  );
}
