import { createHash } from "node:crypto";
import type { JsonSchema } from "@codemotion/core";
import { ARK_V1_MODEL, ProviderError, type ProviderAuditSink } from "./provider.js";
import { fingerprintProviderRequestId, sanitizeUserText } from "./security.js";

const DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const TOOL_NAME = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;

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
    const turn = await this.complete(request, "required");
    if (turn.toolCall === undefined) {
      throw new ProviderError("provider_response", "Ark did not call the required selected tool.", {
        reason: "INVALID_TOOL_RESPONSE"
      });
    }
    return { type: request.toolName, data: turn.toolCall.arguments };
  }

  async respond(request: SelectedToolParameterRequest): Promise<SelectedToolModelTurn> {
    return this.complete(request, "auto");
  }

  private async complete(
    request: SelectedToolParameterRequest,
    toolChoice: "auto" | "required"
  ): Promise<SelectedToolModelTurn> {
    if (!TOOL_NAME.test(request.toolName)) {
      throw new ProviderError("invalid_input", "Selected tool name is invalid.");
    }
    const prompt = sanitizeUserText(exactNonEmpty(request.prompt, "Prompt", 10_000));
    const fieldSpec = exactNonEmpty(request.fieldSpec, "Field specification", 100_000);
    const body = {
      model: ARK_V1_MODEL,
      max_tokens: 2_000,
      thinking: { type: "enabled" },
      messages: [
        {
          role: "system",
          content: [
            "你是 CodeMotion FX 的单工具助手。当前唯一可用工具由用户在界面中预先选择。",
            "当用户要求实际生成或修改效果时调用该工具；当用户只是咨询参数、能力或使用方式时直接用简洁中文回答，不调用工具。",
            "不得调用其他工具，不得在参数中输出素材、路径、URL、资源 ID、渲染设置或导出设置。",
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
          parameters: request.parameterSchema
        }
      }],
      tool_choice: toolChoice === "auto" ? "auto" : {
        type: "function",
        function: { name: request.toolName }
      }
    };
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
