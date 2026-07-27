import type { EngineErrorCode } from "./errors.js";
import type { JsonObject } from "./types.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogRecord {
  timestamp: string;
  level: LogLevel;
  code: EngineErrorCode | string;
  message: string;
  context: JsonObject;
}

export interface Logger {
  log(level: LogLevel, code: EngineErrorCode | string, message: string, context?: JsonObject): void;
}

export type LogSink = (record: Readonly<LogRecord>) => void;

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export const NOOP_LOGGER: Logger = Object.freeze({
  log(): void {}
});

export function createLogger(
  sink: LogSink,
  options: { minimumLevel?: LogLevel; clock?: () => Date } = {}
): Logger {
  const minimumLevel = options.minimumLevel ?? "info";
  const clock = options.clock ?? (() => new Date());

  return {
    log(level, code, message, context = {}): void {
      if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[minimumLevel]) {
        return;
      }
      sink(Object.freeze({ timestamp: clock().toISOString(), level, code, message, context }));
    }
  };
}
