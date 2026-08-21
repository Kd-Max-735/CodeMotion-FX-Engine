import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition, ServerEffectRenderContext } from "../../types.js";
import { TRANSITION_BACKEND, assertDistinctInputBindings, effectProgress, frameOutput, invalid, mix, round, valid, type MotionEasing } from "./helpers.js";

export interface ZoomTunnelParams extends JsonObject {
  transitionStart: number;
  duration: number;
  startScale: number;
  endScale: number;
  tunnelDepth: number;
  motionBlur: number;
  twistDegrees: number;
  easing: MotionEasing;
}

const defaults: ZoomTunnelParams = {
  transitionStart: 1,
  duration: 0.9,
  startScale: 0.25,
  endScale: 3,
  tunnelDepth: 6,
  motionBlur: 0.55,
  twistDegrees: 0,
  easing: "ease_in_out"
};

export function renderZoomTunnel(context: ServerEffectRenderContext, params: Readonly<ZoomTunnelParams>) {
  assertDistinctInputBindings(context, "from_video", "to_video");
  const transitionContext = { ...context, time: Math.max(0, context.time - params.transitionStart) };
  const progress = context.time < params.transitionStart
    ? 0 : effectProgress(transitionContext, params.duration, params.easing);
  return frameOutput(context, "perspective_zoom_tunnel", {
    algorithm: "perspective-zoom-tunnel",
    inputSlots: { from: "from_video", to: "to_video" },
    progress,
    outgoing: {
      scale: round(mix(1, params.endScale, progress)),
      depth: round(-params.tunnelDepth * progress),
      opacity: round(1 - progress)
    },
    incoming: {
      scale: round(mix(params.startScale, 1, progress)),
      depth: round(params.tunnelDepth * (1 - progress)),
      opacity: progress
    },
    twistDegrees: round(params.twistDegrees * Math.sin(Math.PI * progress)),
    motionBlur: round(params.motionBlur * Math.sin(Math.PI * progress))
  });
}

export const ZOOM_TUNNEL_DEFINITION: EffectToolDefinition<ZoomTunnelParams> = {
  effectId: "fx.transition.zoomTunnel",
  toolName: "zoom_tunnel",
  displayName: "缩放隧道转场",
  version: "2.0.0",
  category: "transition",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      transitionStart: { type: "number", minimum: 0, maximum: 60, default: 1 },
      duration: { type: "number", minimum: 0.2, maximum: 5, default: 0.9 },
      startScale: { type: "number", minimum: 0.05, maximum: 1, default: 0.25 },
      endScale: { type: "number", minimum: 1.1, maximum: 8, default: 3 },
      tunnelDepth: { type: "number", minimum: 0.1, maximum: 20, default: 6 },
      motionBlur: { type: "number", minimum: 0, maximum: 1, default: 0.55 },
      twistDegrees: { type: "number", minimum: -360, maximum: 360, default: 0 },
      easing: { type: "string", enum: ["linear", "ease_in", "ease_out", "ease_in_out"], default: "ease_in_out" }
    }
  },
  defaults,
  presets: [
    { presetId: "zoom_tunnel.clean", displayName: "直线穿梭", params: { ...defaults, transitionStart: 1, duration: 0.75, startScale: 0.3, endScale: 2.6, tunnelDepth: 5, motionBlur: 0.35 } },
    { presetId: "zoom_tunnel.fast", displayName: "高速冲刺", params: { ...defaults, transitionStart: 0.5, duration: 0.45, startScale: 0.15, endScale: 5, tunnelDepth: 12, motionBlur: 0.9, easing: "ease_in" } },
    { presetId: "zoom_tunnel.twist", displayName: "旋转隧道", params: { ...defaults, transitionStart: 1.5, duration: 1.25, startScale: 0.2, endScale: 3.5, tunnelDepth: 8, motionBlur: 0.65, twistDegrees: 120 } }
  ],
  inputSlots: [
    { name: "from_video", kind: "video", required: true, cardinality: "one", description: "Server-authorized outgoing video." },
    { name: "to_video", kind: "video", required: true, cardinality: "one", description: "Server-authorized incoming video." }
  ],
  primaryBackend: TRANSITION_BACKEND,
  fallbackStrategy: { kind: "reject", reason: "Tunnel projection requires the declared server GPU backend." },
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ ...params, transitionStart: round(params.transitionStart), duration: round(params.duration), startScale: round(params.startScale), endScale: round(params.endScale), tunnelDepth: round(params.tunnelDepth), motionBlur: round(params.motionBlur), twistDegrees: round(params.twistDegrees) }),
  validateParams: (params) => params.startScale < params.endScale ? valid() : invalid("$.startScale", "startScale must be smaller than endScale"),
  render: renderZoomTunnel
};
