import type { MotionProject } from "@codemotion/core";
import type { PlannedAnimation, ProviderErrorCode, ProviderProgress } from "@codemotion/ai-planner";

export type AiPlanStatus = "running" | "cancelling" | "completed" | "failed" | "cancelled";

export interface AiPlanSettings {
  prompt: string;
  assetIds: string[];
  timeoutMs: number;
  width: number;
  height: number;
  fps: number;
  duration: number;
}

export interface AiPlanTaskView {
  id: string;
  status: AiPlanStatus;
  phase: ProviderProgress["phase"] | "accepted" | "plan";
  progress?: ProviderProgress;
  events: readonly ProviderProgress[];
  createdAt: string;
  updatedAt: string;
  modalities: readonly ("text" | "image" | "audio" | "video")[];
  result?: PlannedAnimation;
  error?: {
    code: ProviderErrorCode | "planning";
    message: string;
    retryable: boolean;
  };
}

export class AiPlanApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as T & { error?: string };
  if (!response.ok) throw new AiPlanApiError(body.error ?? `HTTP ${response.status}`, response.status);
  return body;
}

export const aiPlanApi = {
  list: () => request<{ configured: boolean; tasks: AiPlanTaskView[] }>("/api/ai-plans"),
  create: (project: MotionProject, settings: AiPlanSettings) => request<{ task: AiPlanTaskView }>("/api/ai-plans", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ project, settings })
  }),
  cancel: (id: string) => request<{ task: AiPlanTaskView }>(`/api/ai-plans/${encodeURIComponent(id)}/cancel`, { method: "POST" })
};
