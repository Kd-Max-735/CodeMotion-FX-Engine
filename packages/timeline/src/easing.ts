import { EngineError, ERROR_CODES, type EasingDefinition } from "@codemotion/core";

function easingError(message: string): EngineError {
  return new EngineError(ERROR_CODES.KEYFRAME_INVALID, message);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function cubicCoordinate(t: number, p1: number, p2: number): number {
  const inverse = 1 - t;
  return 3 * inverse * inverse * t * p1 + 3 * inverse * t * t * p2 + t * t * t;
}

function cubicDerivative(t: number, p1: number, p2: number): number {
  const inverse = 1 - t;
  return 3 * inverse * inverse * p1 + 6 * inverse * t * (p2 - p1) + 3 * t * t * (1 - p2);
}

interface ValidatedEasing {
  readonly type: EasingDefinition["type"];
  readonly params: readonly number[];
}

function validateDefinition(definition: EasingDefinition | undefined): ValidatedEasing {
  if (definition === undefined) return { type: "linear", params: [] };
  if (typeof definition !== "object" || definition === null || Array.isArray(definition)) {
    throw easingError("Easing definition must be an object.");
  }

  const type = definition.type;
  const rawParams: unknown = definition.params;
  if (rawParams !== undefined && !Array.isArray(rawParams)) {
    throw easingError("Easing params must be an array.");
  }
  const params = rawParams ?? [];
  if (!Array.isArray(params) || params.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    throw easingError("Easing params must contain only finite numbers.");
  }

  switch (type) {
    case "linear":
    case "easeIn":
    case "easeOut":
    case "easeInOut":
    case "bounce":
      break;
    case "cubicBezier": {
      if (params.length !== 4) throw easingError("cubicBezier requires four finite parameters.");
      const [x1, , x2] = params;
      if (x1 === undefined || x2 === undefined || x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) {
        throw easingError("cubicBezier x control points must be within [0, 1].");
      }
      break;
    }
    case "spring": {
      if (params.length > 4) throw easingError("spring accepts at most four parameters.");
      const stiffness = params[0] ?? 100;
      const damping = params[1] ?? 10;
      const mass = params[2] ?? 1;
      if (stiffness <= 0 || damping < 0 || mass <= 0) {
        throw easingError("spring requires positive stiffness/mass and non-negative damping.");
      }
      break;
    }
    case "elastic": {
      if (params.length > 2) throw easingError("elastic accepts at most two parameters.");
      const amplitude = params[0] ?? 1;
      const period = params[1] ?? 0.3;
      if (amplitude < 1 || period <= 0) {
        throw easingError("elastic amplitude must be at least 1 and period must be positive.");
      }
      break;
    }
    case "back":
      if (params.length > 1) throw easingError("back accepts at most one parameter.");
      break;
    case "steps": {
      if (params.length > 2) throw easingError("steps accepts at most two parameters.");
      const count = params[0] ?? 1;
      const position = params[1] ?? 0;
      if (!Number.isInteger(count) || count < 1 || (position !== 0 && position !== 1)) {
        throw easingError("steps requires a positive integer count and position 0 (end) or 1 (start).");
      }
      break;
    }
    case "customCurve": {
      if (params.length < 4 || params.length % 2 !== 0) {
        throw easingError("customCurve requires at least two finite x/y points.");
      }
      let previousX = -1;
      for (let index = 0; index < params.length; index += 2) {
        const x = params[index];
        if (x === undefined || x < 0 || x > 1) {
          throw easingError("customCurve x values must be within [0, 1].");
        }
        if (x <= previousX) throw easingError("customCurve x values must increase strictly.");
        previousX = x;
      }
      break;
    }
    default:
      throw easingError("Unsupported easing type.");
  }
  return { type, params };
}

function cubicBezier(progress: number, params: readonly number[]): number {
  const [x1, y1, x2, y2] = params as [number, number, number, number];

  let parameter = progress;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const error = cubicCoordinate(parameter, x1, x2) - progress;
    const derivative = cubicDerivative(parameter, x1, x2);
    if (Math.abs(error) < 1e-7 || Math.abs(derivative) < 1e-7) break;
    parameter = clamp01(parameter - error / derivative);
  }
  let lower = 0;
  let upper = 1;
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const x = cubicCoordinate(parameter, x1, x2);
    if (Math.abs(x - progress) < 1e-7) break;
    if (x < progress) lower = parameter;
    else upper = parameter;
    parameter = (lower + upper) / 2;
  }
  return cubicCoordinate(parameter, y1, y2);
}

function bounce(progress: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (progress < 1 / d1) return n1 * progress * progress;
  if (progress < 2 / d1) {
    const shifted = progress - 1.5 / d1;
    return n1 * shifted * shifted + 0.75;
  }
  if (progress < 2.5 / d1) {
    const shifted = progress - 2.25 / d1;
    return n1 * shifted * shifted + 0.9375;
  }
  const shifted = progress - 2.625 / d1;
  return n1 * shifted * shifted + 0.984375;
}

function spring(progress: number, params: readonly number[]): number {
  const stiffness = params[0] ?? 100;
  const damping = params[1] ?? 10;
  const mass = params[2] ?? 1;
  const velocity = params[3] ?? 0;
  const angular = Math.sqrt(stiffness / mass);
  const dampingRatio = damping / (2 * Math.sqrt(stiffness * mass));
  if (dampingRatio < 1) {
    const damped = angular * Math.sqrt(1 - dampingRatio * dampingRatio);
    const envelope = Math.exp(-dampingRatio * angular * progress);
    const coefficient = (dampingRatio * angular - velocity) / damped;
    return 1 - envelope * (Math.cos(damped * progress) + coefficient * Math.sin(damped * progress));
  }
  if (dampingRatio === 1) {
    const envelope = Math.exp(-angular * progress);
    return 1 - envelope * (1 + (angular - velocity) * progress);
  }

  const decay = dampingRatio * angular;
  const discriminant = angular * Math.sqrt(dampingRatio * dampingRatio - 1);
  const slowRoot = -decay + discriminant;
  const fastRoot = -decay - discriminant;
  const rootDistance = slowRoot - fastRoot;
  const slowCoefficient = (-velocity - fastRoot) / rootDistance;
  const fastCoefficient = (slowRoot + velocity) / rootDistance;
  const displacement = slowCoefficient * Math.exp(slowRoot * progress)
    + fastCoefficient * Math.exp(fastRoot * progress);
  return 1 - displacement;
}

function customCurve(progress: number, params: readonly number[]): number {
  const points: Array<readonly [number, number]> = [];
  for (let index = 0; index < params.length; index += 2) {
    const x = params[index];
    const y = params[index + 1];
    if (x === undefined || y === undefined) throw easingError("customCurve point is incomplete.");
    points.push([x, y]);
  }
  if (progress <= (points[0]?.[0] ?? 0)) return points[0]?.[1] ?? 0;
  for (let index = 1; index < points.length; index += 1) {
    const right = points[index];
    const left = points[index - 1];
    if (right !== undefined && left !== undefined && progress <= right[0]) {
      const local = (progress - left[0]) / (right[0] - left[0]);
      return left[1] + (right[1] - left[1]) * local;
    }
  }
  return points.at(-1)?.[1] ?? 1;
}

export function evaluateEasing(definition: EasingDefinition | undefined, input: number): number {
  if (!Number.isFinite(input)) throw easingError("Easing input must be finite.");
  const { type, params } = validateDefinition(definition);
  const progress = clamp01(input);
  if (progress === 0 || progress === 1) return progress;

  switch (type) {
    case "linear": return progress;
    case "easeIn": return progress ** 3;
    case "easeOut": return 1 - (1 - progress) ** 3;
    case "easeInOut": return progress < 0.5 ? 4 * progress ** 3 : 1 - ((-2 * progress + 2) ** 3) / 2;
    case "cubicBezier": return cubicBezier(progress, params);
    case "spring": return spring(progress, params);
    case "bounce": return bounce(progress);
    case "elastic": {
      const amplitude = params[0] ?? 1;
      const period = params[1] ?? 0.3;
      const phase = (period / (2 * Math.PI)) * Math.asin(1 / amplitude);
      return amplitude * 2 ** (-10 * progress) * Math.sin(((progress - phase) * 2 * Math.PI) / period) + 1;
    }
    case "back": {
      const overshoot = params[0] ?? 1.70158;
      return (overshoot + 1) * progress ** 3 - overshoot * progress ** 2;
    }
    case "steps": {
      const count = params[0] ?? 1;
      const position = params[1] ?? 0;
      return position === 1 ? Math.ceil(progress * count) / count : Math.floor(progress * count) / count;
    }
    case "customCurve": return customCurve(progress, params);
  }
}
