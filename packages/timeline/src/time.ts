import { EngineError, ERROR_CODES, type LayerDefinition } from "@codemotion/core";

export type FrameRounding = "floor" | "ceil" | "nearest";
export type LoopMode = "none" | "repeat" | "ping-pong";

export interface FrameTime {
  readonly frame: number;
  readonly seconds: number;
  readonly fps: number;
}

export interface LayerTime {
  readonly active: boolean;
  readonly parentTime: number;
  readonly elapsed: number;
  readonly sourceTime: number;
  readonly activeStart: number;
  readonly activeEnd: number;
}

function timeError(message: string, details: Record<string, number | string>): EngineError {
  return new EngineError(ERROR_CODES.INVALID_TIME, message, { details });
}

export function assertFps(fps: number): void {
  if (!Number.isFinite(fps) || fps <= 0) {
    throw timeError("fps must be a finite positive number.", { fps });
  }
}

export function frameToSeconds(frame: number, fps: number): number {
  assertFps(fps);
  if (!Number.isInteger(frame)) {
    throw timeError("frame must be an integer.", { frame });
  }
  return frame / fps;
}

export function secondsToFrame(seconds: number, fps: number, rounding: FrameRounding = "nearest"): number {
  assertFps(fps);
  if (!Number.isFinite(seconds)) {
    throw timeError("seconds must be finite.", { seconds });
  }
  const rawFrame = seconds * fps;
  if (rounding === "floor") return Math.floor(rawFrame);
  if (rounding === "ceil") return Math.ceil(rawFrame);
  return Math.round(rawFrame);
}

export function frameTime(frame: number, fps: number): FrameTime {
  return Object.freeze({ frame, seconds: frameToSeconds(frame, fps), fps });
}

export function fixedFrameRange(startFrame: number, endFrame: number, fps: number): FrameTime[] {
  assertFps(fps);
  if (!Number.isInteger(startFrame) || !Number.isInteger(endFrame) || endFrame < startFrame) {
    throw timeError("Frame range must use integers with endFrame >= startFrame.", {
      startFrame,
      endFrame
    });
  }
  const result: FrameTime[] = [];
  for (let frame = startFrame; frame <= endFrame; frame += 1) {
    result.push(frameTime(frame, fps));
  }
  return result;
}

function previousRepresentable(value: number): number {
  if (value === 0) return -Number.MIN_VALUE;
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value, false);
  const bits = view.getBigUint64(0, false);
  view.setBigUint64(0, value > 0 ? bits - 1n : bits + 1n, false);
  return view.getFloat64(0, false);
}

export function mapLoopTime(time: number, start: number, end: number, mode: LoopMode): number {
  if (![time, start, end].every(Number.isFinite) || end <= start) {
    throw timeError("Loop range requires finite values with end > start.", { time, start, end });
  }
  if (mode === "none") {
    return Math.min(end, Math.max(start, time));
  }

  const duration = end - start;
  const relative = time - start;
  if (mode === "repeat") {
    return start + (((relative % duration) + duration) % duration);
  }

  const period = duration * 2;
  const cycle = ((relative % period) + period) % period;
  const mapped = cycle <= duration ? start + cycle : end - (cycle - duration);
  return mapped < end ? Math.max(start, mapped) : Math.max(start, previousRepresentable(end));
}

export function resolveLayerTime(layer: LayerDefinition, parentTime: number): LayerTime {
  if (!Number.isFinite(parentTime)) {
    throw timeError("parentTime must be finite.", { parentTime });
  }
  const { startTime, endTime, inPoint, outPoint } = layer;
  if (![startTime, endTime, inPoint, outPoint].every(Number.isFinite)) {
    throw timeError("Layer timing values must be finite.", { layerId: layer.id });
  }
  if (endTime < startTime || outPoint < inPoint) {
    throw timeError("Layer end/out points must not precede start/in points.", { layerId: layer.id });
  }

  const trimmedDuration = outPoint - inPoint;
  const activeStart = startTime;
  const activeEnd = Math.min(endTime, startTime + trimmedDuration);
  const elapsed = parentTime - startTime;
  const sourceTime = inPoint + elapsed;
  return {
    active: layer.visible && parentTime >= activeStart && parentTime < activeEnd,
    parentTime,
    elapsed,
    sourceTime,
    activeStart,
    activeEnd
  };
}
