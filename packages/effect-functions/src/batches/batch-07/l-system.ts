import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import { COLOR_SCHEMA, REJECT_FALLBACK, SERVER_CPU_BACKEND, invalid, metadataResult,
  normalizeColor, round, schema, valid } from "./shared.js";

type LSystemPattern = "plant" | "koch" | "dragon";

export interface LSystemParams extends JsonObject {
  pattern: LSystemPattern;
  iterations: number;
  angle: number;
  step: number;
  scale: number;
  speed: number;
  strokeColor: string;
}

const defaults: LSystemParams = {
  pattern: "plant", iterations: 4, angle: 25, step: 6, scale: 1,
  speed: 0.2, strokeColor: "#2D6A4F"
};

const systems: Record<LSystemPattern, { axiom: string; rules: Readonly<Record<string, string>> }> = {
  plant: { axiom: "X", rules: { X: "F+[[X]-X]-F[-FX]+X", F: "FF" } },
  koch: { axiom: "F", rules: { F: "F+F-F-F+F" } },
  dragon: { axiom: "FX", rules: { X: "X+YF+", Y: "-FX-Y" } }
};

const MAX_PROGRAM_LENGTH = 16_384;
const MAX_SEGMENTS = 8_192;

function expand(pattern: LSystemPattern, iterations: number, limit: number): string {
  const system = systems[pattern];
  let value = system.axiom;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let next = "";
    for (const symbol of value) {
      next += system.rules[symbol] ?? symbol;
      if (next.length > limit) throw new RangeError("L-system expansion exceeded its output limit.");
    }
    value = next;
  }
  return value;
}

export const lSystemDefinition: EffectToolDefinition<LSystemParams> = {
  effectId: "fx.gen.lSystem",
  toolName: "l_system",
  displayName: "L 系统",
  version: "1.0.0",
  category: "generative",
  parameterSchema: schema({
    pattern: { type: "string", enum: ["plant", "koch", "dragon"], default: defaults.pattern },
    iterations: { type: "integer", minimum: 1, maximum: 6, default: defaults.iterations },
    angle: { type: "number", minimum: 5, maximum: 120, default: defaults.angle },
    step: { type: "number", minimum: 0.5, maximum: 30, default: defaults.step },
    scale: { type: "number", minimum: 0.1, maximum: 5, default: defaults.scale },
    speed: { type: "number", minimum: -3, maximum: 3, default: defaults.speed },
    strokeColor: { ...COLOR_SCHEMA, default: defaults.strokeColor }
  }),
  defaults,
  presets: [
    { presetId: "batch07.lsystem.fern", displayName: "蕨类", params: { ...defaults } },
    { presetId: "batch07.lsystem.snowflake", displayName: "科赫折线", params: { ...defaults, pattern: "koch", iterations: 5, angle: 90, step: 2.5, speed: 0 } },
    { presetId: "batch07.lsystem.dragon", displayName: "龙形曲线", params: { ...defaults, pattern: "dragon", iterations: 6, angle: 90, step: 4, strokeColor: "#D00000" } }
  ],
  inputSlots: [{ name: "background_image", kind: "image", required: false, cardinality: "one",
    description: "Optional server-authorized image used beneath the growing L-system." }],
  primaryBackend: SERVER_CPU_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "medium",
  normalizeParams: (params) => ({ ...params, angle: round(params.angle, 3), step: round(params.step),
    scale: round(params.scale), speed: round(params.speed), strokeColor: normalizeColor(params.strokeColor) }),
  validateParams: (params) => {
    try {
      const program = expand(params.pattern, params.iterations, MAX_PROGRAM_LENGTH);
      return [...program].filter((symbol) => symbol === "F").length <= MAX_SEGMENTS
        ? valid()
        : invalid("$.iterations", `L-system drawing exceeds ${MAX_SEGMENTS} segments`);
    } catch {
      return invalid("$.iterations", `L-system expansion exceeds ${MAX_PROGRAM_LENGTH} symbols`);
    }
  },
  render: (context, params) => {
    const program = expand(params.pattern, params.iterations, MAX_PROGRAM_LENGTH);
    const turn = params.angle * Math.PI / 180;
    let heading = -Math.PI / 2 + context.time * params.speed * 0.1;
    let x = 0;
    let y = 0;
    const stack: Array<[number, number, number]> = [];
    const segments: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    for (const symbol of program) {
      if (symbol === "F") {
        const nextX = x + Math.cos(heading) * params.step * params.scale;
        const nextY = y + Math.sin(heading) * params.step * params.scale;
        if (segments.length >= MAX_SEGMENTS) throw new RangeError("L-system segment limit exceeded.");
        segments.push({ x1: round(x), y1: round(y), x2: round(nextX), y2: round(nextY) });
        x = nextX;
        y = nextY;
      } else if (symbol === "+") heading += turn;
      else if (symbol === "-") heading -= turn;
      else if (symbol === "[") stack.push([x, y, heading]);
      else if (symbol === "]") {
        const state = stack.pop();
        if (state !== undefined) [x, y, heading] = state;
      }
    }
    return metadataResult({ algorithm: "deterministic_l_system_turtle", pattern: params.pattern,
      segments, strokeColor: params.strokeColor });
  }
};
