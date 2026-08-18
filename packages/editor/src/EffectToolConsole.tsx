import {
  ArrowLeft, ArrowRight, Check, ChevronDown, Clock3, Copy, Download, FileAudio, FileImage, LoaderCircle, Menu, Paperclip,
  Plus, Search, Send, Settings, Square, Video, Wrench, X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import {
  EffectToolApiError,
  selectedEffectToolApi,
  type SelectedEffectToolView,
  type SelectedEffectTurn
} from "./effect-tool-client.js";
import { BrowserApiError, mediaAssetApi, sessionApi, type BrowserAssetSummaryV1 } from "./media-asset-client.js";

const GENERATION_MODE_LABELS = Object.freeze({ fast: "快速", standard: "标准", fine: "精美" });

type ConversationEntry = Readonly<{
  id: string;
  role: "user";
  content: string;
  tool: SelectedEffectToolView;
  assets?: readonly BrowserAssetSummaryV1[];
}> | Readonly<{
  id: string;
  role: "assistant";
  tool: SelectedEffectToolView;
  turn: SelectedEffectTurn;
  elapsedMs: number;
  showThinking: boolean;
}>;

function errorMessage(error: unknown): string {
  if (error instanceof EffectToolApiError && error.code === "MISSING_REQUIRED_INPUTS") {
    const missing = error.requirements.map((item) => `${item.description || item.name}（${item.kind}）`).join("、");
    return missing.length === 0
      ? "当前工具缺少必需输入，已安全停止执行。"
      : `缺少必需输入：${missing}。请上传该工具要求的图片、视频或音频素材，派生资源由服务器生成。`;
  }
  if (error instanceof BrowserApiError) {
    if (error.code === "ARK_PROVIDER_UNAVAILABLE") return "Ark 尚未配置，请检查服务器 ARK_API_KEY。";
    if (error.code === "MISSING_REQUIRED_INPUTS") return "当前工具还需要此界面未提供的输入资源，已安全停止执行。";
    if (error.code === "EFFECT_TOOL_REQUEST_INVALID") return "工具输入不满足要求，已安全停止执行。";
    return `${error.message} (${error.code})`;
  }
  return error instanceof Error ? error.message : "请求失败。";
}

const MIN_MANY_IMAGES = 2;
const MAX_MANY_IMAGES = 32;

export function imageUploadRequirement(tool: SelectedEffectToolView): Readonly<{ min: number; max: number }> {
  const required = tool.inputRequirements.filter((slot) => slot.required);
  const slots = (required.length > 0 ? required : tool.inputRequirements.filter((slot) => !slot.required))
    .filter((slot) => slot.acceptsUploadedImage || slot.acceptsUploadedVideo || slot.acceptsUploadedAudio);
  return Object.freeze(slots.reduce((range, slot) => ({
    min: range.min + (slot.required ? slot.cardinality === "many" ? MIN_MANY_IMAGES : 1 : 0),
    max: range.max + (slot.cardinality === "many" ? MAX_MANY_IMAGES : 1)
  }), { min: 0, max: 0 }));
}

function uploadSlots(tool: SelectedEffectToolView) {
  const required = tool.inputRequirements.filter((slot) => slot.required);
  return (required.length > 0 ? required : tool.inputRequirements.filter((slot) => !slot.required))
    .filter((slot) => slot.acceptsUploadedImage || slot.acceptsUploadedVideo || slot.acceptsUploadedAudio);
}

function uploadAccept(tool: SelectedEffectToolView): string {
  const mimes = new Set(uploadSlots(tool).flatMap((slot) => slot.acceptedMimeTypes));
  if (mimes.size > 0) return [...mimes].join(",");
  const accepted = new Set<string>();
  uploadSlots(tool).forEach((slot) => {
    if (slot.acceptsUploadedImage) accepted.add("image/*");
    if (slot.acceptsUploadedVideo) accepted.add("video/*");
    if (slot.acceptsUploadedAudio) accepted.add("audio/*");
  });
  return [...accepted].join(",");
}

function assetMatchesSlot(asset: BrowserAssetSummaryV1, slot: SelectedEffectToolView["inputRequirements"][number]): boolean {
  if (slot.acceptsUploadedAudio || slot.kind === "audio") return asset.kind === "audio";
  if (slot.acceptsUploadedVideo || slot.kind === "video") return asset.kind === "video";
  return slot.acceptsUploadedImage && (asset.kind === "image" || asset.kind === "svg");
}

export type UploadedAssetBinding = Readonly<{
  asset: BrowserAssetSummaryV1;
  slot: SelectedEffectToolView["inputRequirements"][number];
}>;

export function assetBindingsForAssets(
  tool: SelectedEffectToolView,
  assets: readonly BrowserAssetSummaryV1[]
): readonly UploadedAssetBinding[] {
  const remaining = [...assets];
  const bindings: UploadedAssetBinding[] = [];
  for (const slot of uploadSlots(tool)) {
    const matches = remaining.filter((asset) => assetMatchesSlot(asset, slot));
    const count = slot.cardinality === "many" ? Math.min(MAX_MANY_IMAGES, matches.length) : Math.min(1, matches.length);
    const selected = matches.slice(0, count);
    bindings.push(...selected.map((asset) => Object.freeze({ asset, slot })));
    for (const asset of selected) remaining.splice(remaining.findIndex((item) => item.assetId === asset.assetId), 1);
  }
  return Object.freeze(bindings);
}

export function inputSlotDisplayName(toolName: string, slotName: string): string {
  if (toolName === "datamosh") {
    if (slotName === "source_frame") return "当前正确画面";
    if (slotName === "previous_frame") return "错帧来源画面";
  }
  if (toolName === "displacement_map") {
    if (slotName === "source_layer") return "基础图片";
    if (slotName === "displacement_map") return "置换贴图";
  }
  if (toolName === "brush_reveal") {
    if (slotName === "source_frame") return "起始图片";
    if (slotName === "target_frame") return "目标图片";
  }
  if (toolName === "chalk_stroke" && slotName === "vector_source") return "基础图片";
  if (toolName === "character_cascade" && slotName === "source_image") return "背景图片";
  if (toolName === "dash_flow" && slotName === "source_image") return "基础图片";
  if (toolName === "electric_arc" && slotName === "source_image") return "基础图片";
  return slotName;
}

function compatibleAssetIds(
  tool: SelectedEffectToolView,
  assets: readonly BrowserAssetSummaryV1[]
): readonly string[] {
  const slots = uploadSlots(tool);
  const remaining = [...assets];
  const ordered: string[] = [];
  for (const slot of slots) {
    const matches = remaining.filter((asset) => assetMatchesSlot(asset, slot));
    const selected = slot.cardinality === "many" ? matches.slice(0, MAX_MANY_IMAGES) : matches.slice(0, 1);
    ordered.push(...selected.map((asset) => asset.assetId));
    for (const asset of selected) remaining.splice(remaining.findIndex((item) => item.assetId === asset.assetId), 1);
  }
  return ordered;
}

export function reconcileSelectedAssetIds(
  tool: SelectedEffectToolView,
  selectedAssetIds: readonly string[],
  availableAssetIds: readonly string[]
): string[] {
  const requirement = imageUploadRequirement(tool);
  const available = new Set(availableAssetIds);
  const next = selectedAssetIds.filter((assetId, index) =>
    available.has(assetId) && selectedAssetIds.indexOf(assetId) === index).slice(0, requirement.max);
  for (const assetId of availableAssetIds) {
    if (next.length >= requirement.min) break;
    if (!next.includes(assetId)) next.push(assetId);
  }
  return next;
}

export function turnInputIds(
  tool: SelectedEffectToolView,
  selectedAssetIds: readonly string[]
): Readonly<Record<string, string | readonly string[]>> {
  const slots = uploadSlots(tool);
  const output: Record<string, string | readonly string[]> = {};
  let offset = 0;
  slots.forEach((slot, index) => {
    if (slot.cardinality === "one") {
      const assetId = selectedAssetIds[offset];
      if (assetId !== undefined) output[slot.name] = assetId;
      offset += 1;
      return;
    }
    const reserved = slots.slice(index + 1).reduce((count, remaining) =>
      count + (remaining.cardinality === "many" ? MIN_MANY_IMAGES : 1), 0);
    const count = Math.min(MAX_MANY_IMAGES, Math.max(0, selectedAssetIds.length - offset - reserved));
    if (count > 0) output[slot.name] = Object.freeze(selectedAssetIds.slice(offset, offset + count));
    offset += count;
  });
  return Object.freeze(output);
}

export function turnInputIdsForAssets(
  tool: SelectedEffectToolView,
  assets: readonly BrowserAssetSummaryV1[]
): Readonly<Record<string, string | readonly string[]>> {
  const ordered = assetBindingsForAssets(tool, assets).map(({ asset }) => asset.assetId);
  return turnInputIds(tool, ordered);
}

export function filterEffectTools(
  tools: readonly SelectedEffectToolView[],
  query: string
): readonly SelectedEffectToolView[] {
  const normalized = query.trim().toLocaleLowerCase("zh-CN");
  if (normalized.length === 0) return tools;
  return tools.filter((item) => `${item.displayName} ${item.toolName} ${item.category}`
    .toLocaleLowerCase("zh-CN").includes(normalized));
}

function formatElapsed(milliseconds: number): string {
  return milliseconds < 1_000 ? `${milliseconds} 毫秒` : `${(milliseconds / 1_000).toFixed(1)} 秒`;
}

function GpuStatus({ gpu }: { gpu: Extract<SelectedEffectTurn, { kind: "tool_call" }>["execution"]["gpu"] }) {
  return (
    <div className={`gpu-status ${gpu.available ? "available" : "unavailable"}`} title={gpu.name}>
      <span>NVIDIA 显存（整卡）</span>
      {gpu.available ? (
        <b>
          当前 {gpu.memoryUsedMiB} / {gpu.memoryTotalMiB} MiB · 峰值 {gpu.peakMemoryUsedMiB} MiB · GPU {gpu.utilizationPercent}%
        </b>
      ) : <b>{gpu.message ?? "不可用"}</b>}
    </div>
  );
}

function VideoResult({
  initial,
  tool
}: {
  initial: Extract<SelectedEffectTurn, { kind: "tool_call" }>["execution"];
  tool: SelectedEffectToolView;
}) {
  const [execution, setExecution] = useState(initial);
  useEffect(() => {
    if (execution.status !== "queued" && execution.status !== "running") return;
    const controller = new AbortController();
    const poll = async (): Promise<void> => {
      try {
        const next = await selectedEffectToolApi.execution(initial.id, tool.toolName, controller.signal);
        if (controller.signal.aborted) return;
        setExecution(next);
        if (next.status === "queued" || next.status === "running") window.setTimeout(() => void poll(), 750);
      } catch (cause) {
        if (!controller.signal.aborted) setExecution((current) => ({
          ...current,
          status: "failed",
          failure: { code: "VIDEO_RENDER_FAILED", message: errorMessage(cause) }
        }));
      }
    };
    const timer = window.setTimeout(() => void poll(), 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [execution.status, initial.id, tool.toolName]);

  if (execution.status === "failed") {
    return <><div className="artifact-error">{execution.failure?.message ?? "视频渲染失败。"}</div><GpuStatus gpu={execution.gpu} /></>;
  }
  if (execution.status !== "completed") {
    return (
      <div className="video-progress">
        <div className="video-progress-bar"><i style={{ width: `${Math.round(execution.video.progress * 100)}%` }} /></div>
        <span>{execution.status === "queued" ? "等待视频渲染" : "正在逐帧渲染"}</span>
        <b>{execution.video.completedFrames} / {execution.video.frameCount}</b>
        <GpuStatus gpu={execution.gpu} />
      </div>
    );
  }
  return (
    <div className="video-result">
      <video controls preload="metadata" src={selectedEffectToolApi.videoUrl(execution.id)} aria-label={`${tool.displayName}视频预览`} />
      <GpuStatus gpu={execution.gpu} />
      <a className="video-download" href={selectedEffectToolApi.downloadUrl(execution.id)} download={execution.video.downloadName}>
        <Download size={14} />下载 MP4
      </a>
    </div>
  );
}

function ToolResult({
  turn,
  tool
}: {
  turn: Extract<SelectedEffectTurn, { kind: "tool_call" }>;
  tool: SelectedEffectToolView;
}) {
  const envelope = { type: turn.toolCall.function.name, data: turn.toolCall.function.arguments };
  return (
    <div className="turn-section">
      <div className="section-heading"><span className="section-icon tool-section-icon"><Wrench size={12} /></span><strong>工具调用</strong><span>1 个工具</span></div>
      <details className="tool-card succeeded" open>
        <summary className="tool-head">
          <span className="tool-icon">FX</span>
          <span className="tool-copy"><strong>{tool.displayName}</strong><code>{tool.toolName}</code></span>
          <span className="tool-state"><i />已完成<ChevronDown size={13} /></span>
        </summary>
        <div className="tool-detail">
          <span>Tool Call · {turn.toolCall.id}</span>
          <pre>{JSON.stringify(envelope, null, 2)}</pre>
          <span>服务器执行输入 · 资源已授权映射</span>
          <pre>{JSON.stringify(turn.executionInput, null, 2)}</pre>
          <div className="execution-line"><b>H.264 MP4 · {turn.execution.video.width} × {turn.execution.video.height}</b><em>{GENERATION_MODE_LABELS[turn.executionInput.output.generationMode]}模式 · {turn.execution.video.durationSeconds} 秒 · {turn.execution.video.fps} FPS</em></div>
        </div>
      </details>
      <section className="artifact-card">
        <div className="artifact-head"><div><strong>视频产物</strong><small>{tool.toolName} · 服务器逐帧渲染 · MP4</small></div><span><Video size={12} />视频任务</span></div>
        <VideoResult initial={turn.execution} tool={tool} />
      </section>
    </div>
  );
}

export function EffectToolConsole() {
  const fileInput = useRef<HTMLInputElement>(null);
  const toolSearch = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const [tools, setTools] = useState<readonly SelectedEffectToolView[]>([]);
  const [selectedToolName, setSelectedToolName] = useState<string>();
  const [assets, setAssets] = useState<BrowserAssetSummaryV1[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [entries, setEntries] = useState<ConversationEntry[]>([]);
  const [prompt, setPrompt] = useState("");
  const [thinking, setThinking] = useState(true);
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const [toolQuery, setToolQuery] = useState("");
  const [activeToolIndex, setActiveToolIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();
  const imageAssets = useMemo(() => assets.filter((asset) => ["image", "svg", "video", "audio"].includes(asset.kind)), [assets]);
  const selectedTool = tools.find((item) => item.toolName === selectedToolName) ?? tools[0];
  const selectedAssets = selectedAssetIds.flatMap((assetId) => {
    const asset = imageAssets.find((item) => item.assetId === assetId);
    return asset === undefined ? [] : [asset];
  });
  const selectedAssetBindings = selectedTool === undefined ? [] : assetBindingsForAssets(selectedTool, selectedAssets);
  const uploadRequirement = selectedTool === undefined
    ? { min: 0, max: 0 }
    : imageUploadRequirement(selectedTool);
  const uploadDisabled = uploading || busy || uploadRequirement.max === 0
    || selectedAssetIds.length >= uploadRequirement.max;
  const filteredTools = useMemo(() => {
    return filterEffectTools(tools, toolQuery);
  }, [toolQuery, tools]);
  const artifactTotal = entries.filter((entry) => entry.role === "assistant" && entry.turn.kind === "tool_call").length;

  useEffect(() => {
    document.title = "AE Agent";
    const controller = new AbortController();
    void (async () => {
      await sessionApi.readWithDevelopmentFallback(controller.signal);
      const [nextTools, page] = await Promise.all([selectedEffectToolApi.catalog(controller.signal), mediaAssetApi.list({ limit: 50 }, controller.signal)]);
      return [nextTools, page] as const;
    })().then(([nextTools, page]) => {
      if (controller.signal.aborted) return;
      setTools(nextTools);
      setSelectedToolName(nextTools.find((item) => item.toolName === "film_grain")?.toolName ?? nextTools[0]?.toolName);
      setAssets(page.items);
    }).catch((cause) => { if (!controller.signal.aborted) setError(errorMessage(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (selectedTool === undefined) return;
    setSelectedAssetIds((current) => reconcileSelectedAssetIds(
      selectedTool,
      current,
      compatibleAssetIds(selectedTool, imageAssets)
    ));
  }, [selectedTool?.toolName, imageAssets]);

  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [entries, busy]);
  useEffect(() => {
    if (!toolMenuOpen) return;
    setActiveToolIndex(Math.max(0, filteredTools.findIndex((item) => item.toolName === selectedTool?.toolName)));
    window.setTimeout(() => toolSearch.current?.focus(), 0);
  }, [toolMenuOpen]);

  useEffect(() => {
    if (!toolMenuOpen) return;
    const active = filteredTools[activeToolIndex];
    if (active !== undefined) {
      document.getElementById(`effect-tool-${active.toolName}`)?.scrollIntoView({ block: "nearest" });
    }
  }, [activeToolIndex, filteredTools, toolMenuOpen]);

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    const requestedTool = selectedTool;
    if (files.length === 0 || requestedTool === undefined) return;
    const requirement = imageUploadRequirement(requestedTool);
    const remaining = Math.max(0, requirement.max - selectedAssetIds.length);
    if (files.length > remaining) {
      setError(`当前特效最多使用 ${requirement.max} 个素材，还可上传 ${remaining} 个。`);
      return;
    }
    setUploading(true);
    setError(undefined);
    const uploaded: BrowserAssetSummaryV1[] = [];
    try {
      for (const file of files) {
        const purpose = file.type.startsWith("audio/") ? "reference-audio"
          : file.type.startsWith("video/") ? "reference-video" : "reference-image";
        uploaded.push(await mediaAssetApi.upload(file, purpose));
      }
    } catch (cause) { setError(errorMessage(cause)); }
    finally {
      if (uploaded.length > 0) {
        const uploadedIds = uploaded.map((asset) => asset.assetId);
        setAssets((current) => [
          ...uploaded,
          ...current.filter((item) => !uploadedIds.includes(item.assetId))
        ]);
        const available = [...uploaded, ...imageAssets.filter((item) => !uploadedIds.includes(item.assetId))];
        setSelectedAssetIds((current) => reconcileSelectedAssetIds(
          requestedTool,
          [...current, ...uploadedIds],
          compatibleAssetIds(requestedTool, available)
        ));
      }
      setUploading(false);
    }
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const value = prompt.trim();
    const requestedTool = selectedTool;
    if (value.length === 0 || busy || requestedTool === undefined) return;
    const requirement = imageUploadRequirement(requestedTool);
    if (selectedAssets.length < requirement.min) {
      setError(`当前特效需要 ${requirement.min} 个素材，请先完成上传。`);
      return;
    }
    const inputIds = turnInputIdsForAssets(requestedTool, selectedAssets);
    const startedAt = performance.now();
    setPrompt("");
    setError(undefined);
    setBusy(true);
    setToolMenuOpen(false);
    setEntries((current) => [...current, {
      id: crypto.randomUUID(), role: "user", content: value, tool: requestedTool,
      ...(selectedAssets.length === 0 || Object.keys(inputIds).length === 0 ? {} : { assets: selectedAssets })
    }]);
    try {
      const turn = await selectedEffectToolApi.turn({
        toolName: requestedTool.toolName,
        prompt: value,
        inputIds
      });
      setEntries((current) => [...current, {
        id: crypto.randomUUID(), role: "assistant", tool: requestedTool, turn,
        elapsedMs: Math.max(1, Math.round(performance.now() - startedAt)), showThinking: thinking
      }]);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); }
  };

  const reset = () => { setEntries([]); setPrompt(""); setError(undefined); };

  const moveSelectedAsset = (assetId: string, offset: -1 | 1) => {
    setSelectedAssetIds((current) => {
      const index = current.indexOf(assetId);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };

  const selectTool = (tool: SelectedEffectToolView) => {
    setSelectedToolName(tool.toolName);
    setSelectedAssetIds((current) => reconcileSelectedAssetIds(
      tool,
      current,
      compatibleAssetIds(tool, imageAssets)
    ));
    setToolMenuOpen(false);
    setToolQuery("");
  };

  const onToolMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setToolMenuOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveToolIndex((current) => filteredTools.length === 0
        ? 0 : (current + direction + filteredTools.length) % filteredTools.length);
      return;
    }
    if (event.key === "Enter" && filteredTools[activeToolIndex] !== undefined) {
      event.preventDefault();
      selectTool(filteredTools[activeToolIndex]!);
    }
  };

  return (
    <div className="ae-agent app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <button className="brand" type="button"><span className="brand-mark">AE</span><strong>AE Agent</strong><ChevronDown size={14} /></button>
          <button className="sidebar-icon" type="button" title="搜索"><Search size={16} /></button>
        </div>
        <button className="new-session" type="button" onClick={reset}><Plus className="compose-icon" size={18} /><strong>新对话</strong></button>
        <div className="sidebar-scroll"><div className="side-label">对话</div><button className="session-row active" type="button"><span><strong>特效创作</strong><small>{loading ? "准备中" : `${entries.length} 条消息`}</small></span></button></div>
        <div className="sidebar-foot"><span className={`status-dot ${selectedTool?.configured ? "online" : ""}`} /><span>{selectedTool?.configured ? "Doubao 2.0 Lite 已连接" : "模型未连接"}</span><button type="button" title="设置"><Settings size={15} /></button></div>
      </aside>

      <main className="conversation">
        <header className="topbar">
          <div><button className="mobile-menu" type="button" title="菜单"><Menu size={17} /></button><strong>特效创作</strong><span>{busy ? "运行中" : "就绪"}</span></div>
          <div className="top-actions"><span>{artifactTotal} 个产物</span><button className="icon-button" type="button" title="停止当前任务" disabled={!busy}><Square size={10} /></button></div>
        </header>
        <section className="messages">
          {error && <div className="agent-error" role="alert"><X size={15} />{error}</div>}
          {entries.length === 0 && !loading && <div className="empty-state"><div className="empty-mark"><span>›</span><i>_</i></div><h1>想要制作什么视频特效？</h1><p>选择一个工具并描述需求。服务器只会向 Doubao 提供该工具的参数定义。</p><div className="starter-prompts"><button type="button" onClick={() => setPrompt("让效果更明显一些，生成 5 秒视频")}>生成所选特效</button><button type="button" onClick={() => setPrompt("这个工具有哪些参数？")}>询问参数</button></div></div>}
          {loading && <div className="empty-state compact"><LoaderCircle className="spin" size={23} /><p>正在连接服务器</p></div>}
          {entries.map((entry) => entry.role === "user" ? (
            <article key={entry.id} className="message user"><div className="user-message"><div className="user-bubble-row"><button className="copy-prompt" type="button" title="复制提示词" onClick={() => void navigator.clipboard.writeText(entry.content)}><Copy size={15} /></button><div className="user-bubble">{entry.content}</div></div><div className="user-tools"><span>{entry.tool.displayName} · {entry.tool.toolName}</span></div>{entry.assets && <div className="user-assets">{assetBindingsForAssets(entry.tool, entry.assets).map(({ asset, slot }) => <span className="user-file" key={asset.assetId}>{asset.kind === "audio" ? <FileAudio size={13} /> : asset.kind === "video" ? <Video size={13} /> : <FileImage size={13} />}<b>{inputSlotDisplayName(entry.tool.toolName, slot.name)}</b>{asset.displayName}</span>)}</div>}</div></article>
          ) : (
            <article key={entry.id} className="message agent-message"><div className="agent-avatar">AE</div><div className="agent-content"><div className="turn-duration"><Clock3 size={13} /><span>{entry.tool.displayName} · 已思考 <b>{formatElapsed(entry.elapsedMs)}</b></span></div>{entry.showThinking && entry.turn.reasoningContent && <details className="process-section" open><summary><span className="section-icon thinking-icon" /><strong>深度思考</strong><span className="process-summary">理解需求并判断是否调用 {entry.tool.toolName}</span><ChevronDown className="process-chevron" size={13} /></summary><div className="process-timeline"><div className="thinking-row completed"><span className="thinking-dot" /><p>{entry.turn.reasoningContent}</p><small>完成</small></div></div></details>}{entry.turn.kind === "tool_call" && <ToolResult turn={entry.turn} tool={entry.tool} />}{entry.turn.content && <section className="final-response"><div className="section-heading"><span className="section-icon final-icon"><Check size={12} /></span><strong>{entry.turn.kind === "tool_call" ? "最终回复" : "回复"}</strong></div><div className="assistant-text markdown-body"><p>{entry.turn.content}</p></div></section>}</div></article>
          ))}
          {busy && <article className="message agent-message"><div className="agent-avatar">AE</div><div className="agent-content"><div className="turn-duration running"><LoaderCircle className="spin" size={13} /><span>正在理解请求并判断是否调用工具</span></div></div></article>}
          <div ref={end} />
        </section>
        <footer className="composer-wrap">
          <form className="composer-shell" onSubmit={(event) => void submit(event)}>
            <div className="selected-tool-tray">
              {selectedTool && <span><Wrench size={12} /><b>{selectedTool.displayName}</b><code>{selectedTool.toolName}</code></span>}
              {selectedAssetBindings.map(({ asset, slot }, index) => <div className="asset-binding" key={`${slot.name}:${asset.assetId}`}>
                <span className="asset-role">{inputSlotDisplayName(selectedTool?.toolName ?? "", slot.name)}</span>
                {asset.kind === "audio" ? <FileAudio size={12} /> : asset.kind === "video" ? <Video size={12} /> : <FileImage size={12} />}
                <span className="asset-name">{asset.displayName}</span>
                {selectedAssetBindings.length > 1 && <button type="button" title="向前移动素材" aria-label={`向前移动 ${asset.displayName}`} disabled={index === 0} onClick={() => moveSelectedAsset(asset.assetId, -1)}><ArrowLeft size={11} /></button>}
                {selectedAssetBindings.length > 1 && <button type="button" title="向后移动素材" aria-label={`向后移动 ${asset.displayName}`} disabled={index === selectedAssetBindings.length - 1} onClick={() => moveSelectedAsset(asset.assetId, 1)}><ArrowRight size={11} /></button>}
                <button type="button" title="移除素材" aria-label={`移除 ${asset.displayName}`} onClick={() => setSelectedAssetIds((current) => current.filter((assetId) => assetId !== asset.assetId))}><X size={11} /></button>
              </div>)}
              {uploadRequirement.max > 0 && <span className="asset-count">素材 {selectedAssetIds.length}/{uploadRequirement.max}</span>}
            </div>
            <textarea rows={1} maxLength={4_000} placeholder="描述视频特效需求" value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={onComposerKeyDown} />
            <div className="composer-toolbar">
              <label className={`attach-button ${uploadDisabled ? "is-disabled" : ""}`} title={uploadRequirement.max === 0 ? "当前特效不需要素材" : `上传素材（最多 ${uploadRequirement.max} 个）`}><input ref={fileInput} type="file" multiple accept={selectedTool === undefined ? "image/*" : uploadAccept(selectedTool)} aria-label="上传素材" disabled={uploadDisabled} onChange={(event) => void upload(event)} />{uploading ? <LoaderCircle className="spin" size={16} /> : <Paperclip size={17} />}</label>
              <label className="thinking-toggle"><input type="checkbox" checked={thinking} onChange={(event) => setThinking(event.target.checked)} /><span>深度思考</span></label>
              <div className="composer-actions-right">
                <span className="model-label">Doubao 2.0 Lite</span>
                <div className="tool-picker">
                  <button className="tool-picker-button" type="button" aria-label="选择工具" aria-expanded={toolMenuOpen} disabled={busy || tools.length === 0} onClick={() => setToolMenuOpen((current) => !current)}><Wrench size={15} /><b>工具</b><i>{tools.length}</i></button>
                  {toolMenuOpen && <div className="tool-menu" role="dialog" aria-label="选择工具" onKeyDown={onToolMenuKeyDown}>
                    <div className="tool-menu-head"><div><strong>选择一个工具</strong><small>{tools.length} 个 Registry 工具</small></div><button type="button" title="关闭" onClick={() => setToolMenuOpen(false)}><X size={15} /></button></div>
                    <div className="tool-search"><Search size={14} /><input ref={toolSearch} role="searchbox" aria-label="搜索工具" placeholder="搜索中文名、toolName 或分类" value={toolQuery} onChange={(event) => { setToolQuery(event.target.value); setActiveToolIndex(0); }} /></div>
                    <div className="tool-options" role="listbox" aria-label="Registry 工具" aria-activedescendant={filteredTools[activeToolIndex] === undefined ? undefined : `effect-tool-${filteredTools[activeToolIndex]!.toolName}`}>
                      {filteredTools.map((item, index) => <button
                        id={`effect-tool-${item.toolName}`}
                        className={`tool-option ${item.toolName === selectedTool?.toolName ? "is-selected" : ""} ${index === activeToolIndex ? "is-active" : ""}`}
                        type="button"
                        role="option"
                        aria-selected={item.toolName === selectedTool?.toolName}
                        key={item.toolName}
                        onMouseEnter={() => setActiveToolIndex(index)}
                        onClick={() => selectTool(item)}
                      >
                        <span className="tool-option-copy"><span className="tool-option-heading"><strong>{item.displayName}</strong><b>{item.category}</b></span><small>{item.toolName}</small><em>{imageUploadRequirement(item).max === 0 ? "无需上传素材" : item.inputRequirements.map((slot) => `${slot.required ? "必需" : "可选"} ${slot.kind}`).join(" · ")}</em></span>
                        <span className="tool-option-action">{item.toolName === selectedTool?.toolName && <><Check size={13} />已选择</>}</span>
                      </button>)}
                      {filteredTools.length === 0 && <div className="tool-empty">没有匹配的工具</div>}
                    </div>
                  </div>}
                </div>
                <button className="send-button" type="submit" title="发送" disabled={busy || selectedTool === undefined || prompt.trim().length === 0 || selectedAssetIds.length < uploadRequirement.min}>{busy ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}</button>
              </div>
            </div>
          </form>
          <small className="composer-note">AI 生成内容可能不准确，请检查重要结果。</small>
        </footer>
      </main>
    </div>
  );
}
