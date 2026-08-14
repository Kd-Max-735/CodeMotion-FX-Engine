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

function extractOutputText(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    throw new ProviderError("provider_response", "Ark returned an invalid response object.");
  }
  const root = body as Record<string, unknown>;
  if (typeof root.output_text === "string") return root.output_text;
  if (!Array.isArray(root.output)) {
    throw new ProviderError("provider_response", "Ark returned no structured output.");
  }
  for (const output of root.output) {
    if (typeof output !== "object" || output === null) continue;
    const content = (output as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (typeof part === "object" && part !== null
        && (part as Record<string, unknown>).type === "output_text"
        && typeof (part as Record<string, unknown>).text === "string") {
        return (part as Record<string, unknown>).text as string;
      }
    }
  }
  throw new ProviderError("provider_response", "Ark returned no structured output text.");
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

export class VolcengineArkSelectedToolProvider implements SelectedToolParameterProvider {
  readonly id = "volcengine-ark-selected-tool-v1";
  private readonly baseUrl: string;
  private readonly transport: typeof fetch;

  constructor(private readonly options: VolcengineArkSelectedToolProviderOptions) {
    if (options.apiKey.trim().length === 0) throw new Error("ARK_API_KEY is required.");
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/u, "");
    this.transport = options.fetchImpl ?? fetch;
  }

  async generate(request: SelectedToolParameterRequest): Promise<unknown> {
    if (!TOOL_NAME.test(request.toolName)) {
      throw new ProviderError("invalid_input", "Selected tool name is invalid.");
    }
    const prompt = sanitizeUserText(exactNonEmpty(request.prompt, "Prompt", 10_000));
    const fieldSpec = exactNonEmpty(request.fieldSpec, "Field specification", 100_000);
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      required: ["type", "data"],
      properties: {
        type: { const: request.toolName },
        data: request.parameterSchema
      }
    };
    const body = {
      model: ARK_V1_MODEL,
      max_output_tokens: 2_000,
      input: [{
        role: "user",
        content: [{
          type: "input_text",
          text: [
            "你只为用户已经手动选择的一个特效工具生成参数。",
            "只输出符合给定 JSON Schema 的 {type,data}，不得选择其他工具、输出资源标识或解释。",
            `当前唯一工具：${request.toolName}`,
            "当前工具字段说明：",
            fieldSpec,
            "用户描述：",
            prompt
          ].join("\n")
        }]
      }],
      text: {
        format: {
          type: "json_schema",
          name: `codemotion_${request.toolName}_v1`,
          strict: true,
          schema
        }
      }
    };
    const started = Date.now();
    let response: Response;
    try {
      response = await this.transport(`${this.baseUrl}/responses`, {
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
      endpoint: "responses.create",
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
    const text = extractOutputText(responseBody);
    try { return JSON.parse(text) as unknown; }
    catch (cause) {
      throw new ProviderError("provider_response", "Ark output was not valid JSON.", {
        cause,
        reason: "INVALID_JSON"
      });
    }
  }
}
