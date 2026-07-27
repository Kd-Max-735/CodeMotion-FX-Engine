import { describe, expect, it } from "vitest";
import {
  createLogger,
  createSeededRandom,
  EngineError,
  ERROR_CODES,
  normalizeSeed
} from "../src/index.js";

describe("seed contract", () => {
  it("produces reproducible streams and deterministic forks", () => {
    const first = createSeededRandom(42);
    const second = createSeededRandom(42);

    expect([first.next(), first.next(), first.next()]).toEqual([
      second.next(),
      second.next(),
      second.next()
    ]);
    expect(first.fork("particles").next()).toBe(second.fork("particles").next());
  });

  it("keeps the engine-version seed sequence stable", () => {
    const random = createSeededRandom(42);
    expect([random.nextUint32(), random.nextUint32(), random.nextUint32()]).toEqual([
      2581720956,
      1925393290,
      3661312704
    ]);
  });

  it("rejects seeds outside the uint32 contract", () => {
    for (const seed of [-1, 1.5, 0x1_0000_0000, Number.NaN]) {
      expect(() => normalizeSeed(seed)).toThrowError(
        expect.objectContaining<Partial<EngineError>>({ code: ERROR_CODES.INVALID_SEED })
      );
    }
  });
});

describe("logger contract", () => {
  it("emits structured records and honors the minimum level", () => {
    const records: unknown[] = [];
    const logger = createLogger((record) => records.push(record), {
      minimumLevel: "warn",
      clock: () => new Date("2026-07-27T00:00:00.000Z")
    });

    logger.log("info", "IGNORED", "ignored");
    logger.log("error", ERROR_CODES.SCHEMA_INVALID, "invalid", { projectId: "p1" });

    expect(records).toEqual([
      {
        timestamp: "2026-07-27T00:00:00.000Z",
        level: "error",
        code: ERROR_CODES.SCHEMA_INVALID,
        message: "invalid",
        context: { projectId: "p1" }
      }
    ]);
  });
});
