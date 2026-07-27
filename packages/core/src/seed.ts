import { EngineError, ERROR_CODES } from "./errors.js";

export const MIN_SEED = 0;
export const MAX_SEED = 0xffff_ffff;

export interface SeededRandom {
  readonly seed: number;
  next(): number;
  nextUint32(): number;
  fork(label: string): SeededRandom;
}

export function normalizeSeed(seed: number): number {
  if (!Number.isInteger(seed) || seed < MIN_SEED || seed > MAX_SEED) {
    throw new EngineError(ERROR_CODES.INVALID_SEED, "Seed must be an unsigned 32-bit integer.", {
      details: { seed }
    });
  }
  return seed >>> 0;
}

function hashLabel(seed: number, label: string): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let index = 0; index < label.length; index += 1) {
    hash ^= label.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function createSeededRandom(inputSeed: number): SeededRandom {
  const seed = normalizeSeed(inputSeed);
  let state = seed;

  return {
    seed,
    nextUint32(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return (value ^ (value >>> 14)) >>> 0;
    },
    next(): number {
      return this.nextUint32() / 0x1_0000_0000;
    },
    fork(label: string): SeededRandom {
      return createSeededRandom(hashLabel(seed, label));
    }
  };
}
