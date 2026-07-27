import { describe, expect, it } from "vitest";
import { ERROR_CODES, type JsonValue } from "@codemotion/core";
import {
  ExpressionEngine,
  programFromExpressionDefinition,
  type ExpressionAstNode,
  type ExpressionProgram
} from "../src/index.js";

function program(id: string, ast: ExpressionAstNode, fallback: JsonValue = 0): ExpressionProgram {
  return { id, ast, resultType: "number", fallback };
}

describe("ExpressionEngine", () => {
  it("evaluates only structured AST variables and whitelisted functions", () => {
    const engine = new ExpressionEngine({ programs: [program("safe", {
      type: "call",
      name: "clamp",
      arguments: [{ type: "variable", name: "value" }, { type: "literal", value: 0 }, { type: "literal", value: 10 }]
    })] });
    expect(engine.evaluate("safe", { variables: { value: 12 } })).toEqual({ ok: true, value: 10, fallbackUsed: false });

    const blocked = new ExpressionEngine({ programs: [program("blocked", { type: "call", name: "eval", arguments: [] }, 7)] });
    expect(blocked.evaluate("blocked", { variables: {} })).toMatchObject({
      ok: false,
      value: 7,
      fallbackUsed: true,
      error: { code: ERROR_CODES.EXPRESSION_FAILED }
    });
    const inherited = new ExpressionEngine({ programs: [program("inherited", { type: "call", name: "toString", arguments: [] }, 6)] });
    expect(inherited.evaluate("inherited", { variables: {} })).toMatchObject({ ok: false, value: 6 });
    const global = new ExpressionEngine({ programs: [program("global", { type: "variable", name: "globalThis" }, 8)] });
    expect(global.evaluate("global", { variables: {} })).toMatchObject({ ok: false, value: 8 });
  });

  it("detects dependency cycles and isolates them with fallback", () => {
    const engine = new ExpressionEngine({ programs: [
      program("a", { type: "reference", programId: "b" }, 11),
      program("b", { type: "reference", programId: "a" }, 12)
    ] });
    expect(engine.evaluate("a", { variables: {} })).toMatchObject({
      ok: false,
      value: 11,
      error: { code: ERROR_CODES.EXPRESSION_CYCLE }
    });
  });

  it("enforces a shared execution step limit", () => {
    const engine = new ExpressionEngine({
      maxSteps: 2,
      programs: [program("limited", {
        type: "binary",
        operator: "+",
        left: { type: "literal", value: 1 },
        right: { type: "literal", value: 2 }
      }, 9)]
    });
    expect(engine.evaluate("limited", { variables: {} })).toMatchObject({
      ok: false,
      value: 9,
      error: { code: ERROR_CODES.EXPRESSION_LIMIT_EXCEEDED }
    });
  });

  it("falls back to the last valid value on type and function failures", () => {
    const engine = new ExpressionEngine({
      programs: [program("dynamic", { type: "variable", name: "value" }, 3)]
    });
    expect(engine.evaluate("dynamic", { variables: { value: 5 } })).toMatchObject({ ok: true, value: 5 });
    expect(engine.evaluate("dynamic", { variables: { value: "wrong" } })).toMatchObject({
      ok: false,
      value: 5,
      error: { code: ERROR_CODES.EXPRESSION_FAILED }
    });

    const throwing = new ExpressionEngine({
      functions: { explode() { throw new Error("sensitive"); } },
      programs: [program("throwing", { type: "call", name: "explode", arguments: [] }, 4)]
    });
    expect(throwing.evaluate("throwing", { variables: {} })).toMatchObject({ ok: false, value: 4 });

    const cyclic: Record<string, JsonValue> = {};
    cyclic.self = cyclic;
    const invalidJson = new ExpressionEngine({ programs: [{
      id: "json",
      ast: { type: "variable", name: "value" },
      resultType: "json",
      fallback: null
    }] });
    expect(invalidJson.evaluate("json", { variables: { value: cyclic } })).toMatchObject({ ok: false, value: null });
  });

  it("returns identical results across three independent runs", () => {
    const run = (): JsonValue => new ExpressionEngine({ programs: [program("sum", {
      type: "binary",
      operator: "+",
      left: { type: "literal", value: 2 },
      right: { type: "literal", value: 3 }
    })] }).evaluate("sum", { variables: {} }).value;
    expect([run(), run(), run()]).toEqual([5, 5, 5]);
  });

  it("adapts only persisted safe AST definitions and validates fallback types", () => {
    const adapted = programFromExpressionDefinition("persisted", {
      language: "cmfx-expression",
      source: "clamp(value, 0, 1)",
      ast: { type: "literal", value: 1 }
    }, "number");
    expect(new ExpressionEngine({ programs: [adapted] }).evaluate("persisted", { variables: {} })).toMatchObject({ value: 1 });
    expect(() => programFromExpressionDefinition("legacy", {
      language: "cmfx-expression",
      source: "value"
    }, "number")).toThrowError(expect.objectContaining({ code: ERROR_CODES.EXPRESSION_FAILED }));
    expect(() => new ExpressionEngine({ programs: [{ ...adapted, fallback: "wrong" }] })).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.EXPRESSION_FAILED })
    );
  });
});
