export const MIN_PROJECT_DURATION_SECONDS = 0.5;
export const MAX_PROJECT_DURATION_SECONDS = 60;

export type ExplicitDurationResult =
  | { readonly kind: "none" }
  | { readonly kind: "valid"; readonly seconds: number; readonly source: "description" }
  | { readonly kind: "invalid"; readonly code: "DURATION_MALFORMED" | "DURATION_OUT_OF_RANGE" | "DURATION_AMBIGUOUS" };

const EXPLICIT_DURATION = /(?:输出(?:视频)?时长(?:为|是)?|视频时长(?:为|是)?|时长(?:为|是)?|duration\s*(?:is|of|=)?\s*)?\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(?:秒|s(?:ec(?:ond)?s?)?)(?![a-z])/giu;
const DURATION_WORDING = /(?:输出(?:视频)?时长|视频时长|时长|duration)/iu;

/**
 * Extracts an explicitly requested project duration from natural language.
 * Both browser and server use this implementation; the server remains authoritative.
 */
export function parseExplicitDuration(prompt: string): ExplicitDurationResult {
  const seconds = [...prompt.matchAll(EXPLICIT_DURATION)].map((match) => Number(match[1]));
  if (seconds.length === 0) {
    return DURATION_WORDING.test(prompt)
      ? { kind: "invalid", code: "DURATION_MALFORMED" }
      : { kind: "none" };
  }
  if (seconds.some((value) => !Number.isFinite(value)
    || value < MIN_PROJECT_DURATION_SECONDS
    || value > MAX_PROJECT_DURATION_SECONDS)) {
    return { kind: "invalid", code: "DURATION_OUT_OF_RANGE" };
  }
  const distinct = new Set(seconds);
  if (distinct.size > 1) return { kind: "invalid", code: "DURATION_AMBIGUOUS" };
  return { kind: "valid", seconds: seconds[0]!, source: "description" };
}
