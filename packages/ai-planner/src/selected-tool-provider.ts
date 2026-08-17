import { createHash } from "node:crypto";
import type { JsonSchema } from "@codemotion/core";
import { ARK_V1_MODEL, ProviderError, type ProviderAuditSink } from "./provider.js";
import { fingerprintProviderRequestId, sanitizeUserText } from "./security.js";

const DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const TOOL_NAME = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;
export const SELECTED_TOOL_DEFAULT_DURATION_SECONDS = 5;
export const SELECTED_TOOL_MIN_DURATION_SECONDS = 1;
export const SELECTED_TOOL_MAX_DURATION_SECONDS = 60;
export const VIDEO_GENERATION_MODES = ["fast", "standard", "fine"] as const;
export type VideoGenerationMode = typeof VIDEO_GENERATION_MODES[number];
export const DEFAULT_VIDEO_GENERATION_MODE: VideoGenerationMode = "standard";
export const VIDEO_GENERATION_MODE_FPS: Readonly<Record<VideoGenerationMode, number>> = Object.freeze({
  fast: 15,
  standard: 30,
  fine: 60
});

export interface SelectedToolParameterRequest {
  readonly requestId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly toolName: string;
  readonly prompt: string;
  readonly fieldSpec: string;
  readonly parameterSchema: JsonSchema;
  readonly signal?: AbortSignal;
}

export interface SelectedToolParameterProvider {
  readonly id: string;
  generate(request: SelectedToolParameterRequest): Promise<unknown>;
}

export interface SelectedToolNativeCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface SelectedToolModelTurn {
  readonly reasoningContent: string;
  readonly content: string;
  readonly toolCall?: SelectedToolNativeCall;
}

export interface SelectedToolConversationProvider extends SelectedToolParameterProvider {
  respond(request: SelectedToolParameterRequest): Promise<SelectedToolModelTurn>;
  finalize(
    request: SelectedToolParameterRequest,
    call: SelectedToolNativeCall,
    result: Readonly<Record<string, unknown>>
  ): Promise<SelectedToolModelTurn>;
}

export interface VolcengineArkSelectedToolProviderOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly audit?: ProviderAuditSink;
}

function exactNonEmpty(value: string, label: string, maximum: number): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new ProviderError("invalid_input", `${label} is empty or exceeds its server limit.`);
  }
  return normalized;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProviderError("provider_response", `Ark returned an invalid ${label}.`);
  }
  return value as Record<string, unknown>;
}

function parseArguments(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "string") {
    throw new ProviderError("provider_response", "Ark tool arguments were not a JSON string.", {
      reason: "INVALID_TOOL_RESPONSE"
    });
  }
  let parsed: unknown;
  try { parsed = JSON.parse(value) as unknown; }
  catch (cause) {
    throw new ProviderError("provider_response", "Ark tool arguments were not valid JSON.", {
      cause,
      reason: "INVALID_JSON"
    });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ProviderError("provider_response", "Ark tool arguments must be a JSON object.", {
      reason: "INVALID_TOOL_RESPONSE"
    });
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function parseTurn(body: unknown, toolName: string): SelectedToolModelTurn {
  const root = record(body, "response object");
  if (!Array.isArray(root.choices) || root.choices.length !== 1) {
    throw new ProviderError("provider_response", "Ark returned an invalid completion choice count.");
  }
  const choice = record(root.choices[0], "completion choice");
  const message = record(choice.message, "assistant message");
  const content = message.content === null || message.content === undefined
    ? "" : typeof message.content === "string" ? message.content : undefined;
  const reasoningContent = message.reasoning_content === null || message.reasoning_content === undefined
    ? "" : typeof message.reasoning_content === "string" ? message.reasoning_content : undefined;
  if (content === undefined || reasoningContent === undefined) {
    throw new ProviderError("provider_response", "Ark returned invalid assistant text fields.");
  }
  if (message.tool_calls === undefined || message.tool_calls === null) {
    if (content.trim().length === 0) {
      throw new ProviderError("provider_response", "Ark returned neither text nor a tool call.", {
        reason: "NO_OUTPUT"
      });
    }
    return Object.freeze({ reasoningContent, content });
  }
  if (!Array.isArray(message.tool_calls) || message.tool_calls.length !== 1) {
    throw new ProviderError("provider_response", "Ark must return exactly one selected tool call.", {
      reason: "INVALID_TOOL_RESPONSE"
    });
  }
  const call = record(message.tool_calls[0], "tool call");
  const fn = record(call.function, "tool function");
  if (call.type !== "function" || typeof call.id !== "string" || call.id.length === 0
    || fn.name !== toolName) {
    throw new ProviderError("security", "Ark attempted an unexpected tool call.", {
      reason: "INVALID_TOOL_RESPONSE"
    });
  }
  return Object.freeze({
    reasoningContent,
    content,
    toolCall: Object.freeze({
      id: call.id,
      name: toolName,
      arguments: parseArguments(fn.arguments)
    })
  });
}

function safeStatusMessage(status: number): string {
  if (status === 401 || status === 403) return "Ark authentication failed.";
  if (status === 429) return "Ark rate limit was reached.";
  return status >= 500 ? "Ark is temporarily unavailable." : "Ark rejected the request.";
}

function errorCode(status: number): ConstructorParameters<typeof ProviderError>[0] {
  if (status === 401 || status === 403) return "authentication";
  if (status === 429) return "rate_limited";
  return status >= 500 ? "provider_unavailable" : "provider_response";
}

function ownerFingerprint(tenantId: string, userId: string): string {
  return `owner-sha256:${createHash("sha256").update(tenantId).update("\0").update(userId)
    .digest("hex").slice(0, 32)}`;
}

function conversationParameterSchema(parameterSchema: JsonSchema): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["effectParams", "output"],
    properties: {
      effectParams: parameterSchema,
      output: {
        type: "object",
        additionalProperties: false,
        required: ["durationSeconds", "generationMode"],
        properties: {
          durationSeconds: {
            type: "number",
            minimum: SELECTED_TOOL_MIN_DURATION_SECONDS,
            maximum: SELECTED_TOOL_MAX_DURATION_SECONDS,
            multipleOf: 0.1,
            default: SELECTED_TOOL_DEFAULT_DURATION_SECONDS
          },
          generationMode: {
            type: "string",
            enum: [...VIDEO_GENERATION_MODES],
            default: DEFAULT_VIDEO_GENERATION_MODE
          }
        }
      }
    }
  };
}

function systemContent(request: SelectedToolParameterRequest): string {
  return [
    "你是 CodeMotion FX 的单工具助手。当前唯一可用工具由用户在界面中预先选择。",
    "当用户要求实际生成或修改效果时调用该工具；当用户只是咨询参数、能力或使用方式时直接用简洁中文回答，不调用工具。",
    "工具 arguments 顶层必须严格包含 effectParams 与 output：effectParams 遵循当前特效字段；output 只包含 durationSeconds 与 generationMode。",
    `未提及时 durationSeconds=${SELECTED_TOOL_DEFAULT_DURATION_SECONDS}。明确时长优先；“长一点/久一点”在明确时长或默认时长上加 2 秒；“短一点/视频短一点”减 2 秒。`,
    "没有明确基准的“长视频/较长视频”使用 8 秒，“短视频/较短视频”使用 3 秒；最终限制在 1–60 秒并保留至多一位小数。",
    `generationMode 只能是 fast、standard、fine，默认 ${DEFAULT_VIDEO_GENERATION_MODE}。用户要求“生成快一点/快速生成/速度优先”时使用 fast；“标准/正常”使用 standard；“精美/高质量/更流畅/画质优先”时使用 fine。`,
    "“生成快一点”只改变 generationMode，不缩短 durationSeconds；“视频短一点”只改变 durationSeconds。",
    "不得在参数中输出素材、路径、URL、资源 ID、直接帧率、编码器或除 durationSeconds、generationMode 之外的导出设置。",
    "工具结果回传后必须用简洁中文给出最终正文，说明已采用的效果、视频时长和生成模式，不得再次调用工具。",
    `当前唯一工具：${request.toolName}`,
    "当前工具字段说明（其中标准 JSON 的 data 字段仅对应 effectParams）：",
    request.fieldSpec
  ].join("\n");
}

function finalSystemContent(request: SelectedToolParameterRequest): string {
  return [
    "你是 CodeMotion FX 的单工具助手。",
    `当前工具 ${request.toolName} 已由服务器执行并返回了安全结果。`,
    "必须根据用户原始需求和工具结果输出一段简洁、自然的中文最终正文。",
    "正文应说明采用的效果、视频时长和生成模式；任务仍在队列中时应明确说正在生成，不得声称已经完成。",
    "不要输出 JSON、Markdown 代码块、资源 ID、文件路径或内部实现信息，不得再次调用工具。"
  ].join("\n");
}

export class VolcengineArkSelectedToolProvider implements SelectedToolConversationProvider {
  readonly id = "volcengine-ark-selected-tool-v1";
  private readonly baseUrl: string;
  private readonly transport: typeof fetch;

  constructor(private readonly options: VolcengineArkSelectedToolProviderOptions) {
    if (options.apiKey.trim().length === 0) throw new Error("ARK_API_KEY is required.");
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/u, "");
    this.transport = options.fetchImpl ?? fetch;
  }

  async generate(request: SelectedToolParameterRequest): Promise<unknown> {
    const turn = await this.complete(request, "required", false);
    if (turn.toolCall === undefined) {
      throw new ProviderError("provider_response", "Ark did not call the required selected tool.", {
        reason: "INVALID_TOOL_RESPONSE"
      });
    }
    return { type: request.toolName, data: turn.toolCall.arguments };
  }

  async respond(request: SelectedToolParameterRequest): Promise<SelectedToolModelTurn> {
    return this.complete(request, "auto", true);
  }

  async finalize(
    request: SelectedToolParameterRequest,
    call: SelectedToolNativeCall,
    result: Readonly<Record<string, unknown>>
  ): Promise<SelectedToolModelTurn> {
    if (!TOOL_NAME.test(request.toolName) || call.name !== request.toolName || call.id.length === 0) {
      throw new ProviderError("invalid_input", "Selected tool result is invalid.");
    }
    const prompt = sanitizeUserText(exactNonEmpty(request.prompt, "Prompt", 10_000));
    exactNonEmpty(request.fieldSpec, "Field specification", 100_000);
    return this.requestCompletion(request, {
      model: ARK_V1_MODEL,
      max_tokens: 2_000,
      thinking: { type: "enabled" },
      messages: [
        { role: "system", content: finalSystemContent(request) },
        { role: "user", content: prompt },
        {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.arguments) }
          }]
        },
        { role: "tool", tool_call_id: call.id, content: JSON.stringify(result) }
      ],
      tools: [{
        type: "function",
        function: {
          name: request.toolName,
          description: `根据用户需求生成并执行已选择的 ${request.toolName} 特效参数。`,
          strict: true,
          parameters: conversationParameterSchema(request.parameterSchema)
        }
      }],
      tool_choice: "none"
    });
  }

  private async complete(
    request: SelectedToolParameterRequest,
    toolChoice: "auto" | "required",
    conversation: boolean
  ): Promise<SelectedToolModelTurn> {
    if (!TOOL_NAME.test(request.toolName)) {
      throw new ProviderError("invalid_input", "Selected tool name is invalid.");
    }
    const prompt = sanitizeUserText(exactNonEmpty(request.prompt, "Prompt", 10_000));
    const fieldSpec = exactNonEmpty(request.fieldSpec, "Field specification", 100_000);
    return this.requestCompletion(request, {
      model: ARK_V1_MODEL,
      max_tokens: 2_000,
      thinking: { type: "enabled" },
      messages: [
        {
          role: "system",
          content: conversation ? systemContent(request) : [
            "你是 CodeMotion FX 的单工具参数生成器。只能调用当前唯一工具。",
            "不得在参数中输出素材、路径、URL、资源 ID、渲染设置或导出设置。",
            `当前唯一工具：${request.toolName}`,
            "当前工具字段说明：",
            fieldSpec
          ].join("\n")
        },
        { role: "user", content: prompt }
      ],
      tools: [{
        type: "function",
        function: {
          name: request.toolName,
          description: `根据用户需求生成并执行已选择的 ${request.toolName} 特效参数。`,
          strict: true,
          parameters: conversation ? conversationParameterSchema(request.parameterSchema) : request.parameterSchema
        }
      }],
      tool_choice: toolChoice === "auto" ? "auto" : {
        type: "function",
        function: { name: request.toolName }
      }
    });
  }

  private async requestCompletion(
    request: SelectedToolParameterRequest,
    body: Readonly<Record<string, unknown>>
  ): Promise<SelectedToolModelTurn> {
    const started = Date.now();
    let response: Response;
    try {
      response = await this.transport(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(body),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
        redirect: "error"
      });
    } catch (cause) {
      request.signal?.throwIfAborted();
      throw new ProviderError("provider_unavailable", "Ark network request failed.", {
        retryable: true,
        cause,
        reason: "ARK_UNAVAILABLE"
      });
    }
    let responseBody: unknown;
    try { responseBody = await response.json(); }
    catch { responseBody = undefined; }
    this.options.audit?.({
      endpoint: "chat.completions.create",
      modelId: ARK_V1_MODEL,
      status: response.status,
      latencyMs: Date.now() - started,
      ownerFingerprint: ownerFingerprint(request.tenantId, request.userId),
      taskFingerprint: fingerprintProviderRequestId(request.requestId),
      ...(!response.ok ? { errorCode: errorCode(response.status) } : {})
    });
    if (!response.ok) {
      const code = errorCode(response.status);
      throw new ProviderError(code, safeStatusMessage(response.status), {
        status: response.status,
        retryable: response.status === 429 || response.status >= 500,
        ...(code === "provider_unavailable" ? { reason: "ARK_UNAVAILABLE" as const } : {})
      });
    }
    const model = typeof responseBody === "object" && responseBody !== null
      ? (responseBody as Record<string, unknown>).model : undefined;
    if (model !== ARK_V1_MODEL) {
      throw new ProviderError("security", "Ark response model did not match the configured provider.", {
        reason: "MODEL_MISMATCH"
      });
    }
    return parseTurn(responseBody, request.toolName);
  }
}
