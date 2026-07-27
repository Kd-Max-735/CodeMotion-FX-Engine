import {
  EngineError,
  ERROR_CODES,
  type ExpressionAstNode,
  type ExpressionDefinition,
  type JsonValue
} from "@codemotion/core";

export type { ExpressionAstNode } from "@codemotion/core";

export type ExpressionValueType = "number" | "string" | "boolean" | "null" | "vector2" | "vector3" | "json";

export interface ExpressionProgram {
  readonly id: string;
  readonly ast: ExpressionAstNode;
  readonly resultType: ExpressionValueType;
  readonly fallback: JsonValue;
}

export interface ExpressionContext {
  readonly variables: Readonly<Record<string, JsonValue>>;
}

export type ExpressionFunction = (arguments_: readonly JsonValue[], context: ExpressionContext) => JsonValue;

export interface ExpressionEvaluationResult {
  readonly ok: boolean;
  readonly value: JsonValue;
  readonly fallbackUsed: boolean;
  readonly error?: EngineError;
}

interface EvaluationState {
  steps: number;
  readonly active: Set<string>;
  readonly context: ExpressionContext;
}

function expressionError(message: string, details: Record<string, JsonValue> = {}): EngineError {
  return new EngineError(ERROR_CODES.EXPRESSION_FAILED, message, { details });
}

function requireNumber(value: JsonValue, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw expressionError(`${label} must be a finite number.`);
  return value;
}

function numericArguments(arguments_: readonly JsonValue[], count: number, name: string): number[] {
  if (arguments_.length !== count) throw expressionError(`${name} requires ${count} arguments.`);
  return arguments_.map((value, index) => requireNumber(value, `${name} argument ${index}`));
}

export const DEFAULT_EXPRESSION_FUNCTIONS: Readonly<Record<string, ExpressionFunction>> = Object.freeze({
  abs(arguments_) {
    const [value] = numericArguments(arguments_, 1, "abs") as [number];
    return Math.abs(value);
  },
  clamp(arguments_) {
    const [value, minimum, maximum] = numericArguments(arguments_, 3, "clamp") as [number, number, number];
    if (maximum < minimum) throw expressionError("clamp maximum must not be less than minimum.");
    return Math.min(maximum, Math.max(minimum, value));
  },
  map(arguments_) {
    const [value, inMinimum, inMaximum, outMinimum, outMaximum] = numericArguments(arguments_, 5, "map") as [number, number, number, number, number];
    if (inMaximum === inMinimum) throw expressionError("map input range must not be empty.");
    return outMinimum + ((value - inMinimum) / (inMaximum - inMinimum)) * (outMaximum - outMinimum);
  },
  max(arguments_) {
    if (arguments_.length === 0) throw expressionError("max requires at least one argument.");
    return Math.max(...arguments_.map((value, index) => requireNumber(value, `max argument ${index}`)));
  },
  min(arguments_) {
    if (arguments_.length === 0) throw expressionError("min requires at least one argument.");
    return Math.min(...arguments_.map((value, index) => requireNumber(value, `min argument ${index}`)));
  }
});

function valueMatchesType(value: JsonValue, expected: ExpressionValueType): boolean {
  if (expected === "json") return isJsonValue(value, new Set());
  if (expected === "null") return value === null;
  if (expected === "number") return typeof value === "number" && Number.isFinite(value);
  if (expected === "string" || expected === "boolean") return typeof value === expected;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const dimensions = expected === "vector2" ? ["x", "y"] : ["x", "y", "z"];
  return Object.keys(value).length === dimensions.length
    && dimensions.every((key) => typeof value[key] === "number" && Number.isFinite(value[key]));
}

function isJsonValue(value: unknown, active: Set<object>): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (active.has(value)) return false;
  active.add(value);
  try {
    if (Array.isArray(value)) return value.every((item) => isJsonValue(item, active));
    return Object.keys(value).every((key) => isJsonValue((value as Record<string, unknown>)[key], active));
  } finally {
    active.delete(value);
  }
}

export class ExpressionEngine {
  private readonly programs = new Map<string, ExpressionProgram>();
  private readonly functions: Readonly<Record<string, ExpressionFunction>>;
  private readonly lastValid = new Map<string, JsonValue>();
  private readonly maxSteps: number;

  constructor(options: {
    readonly programs?: readonly ExpressionProgram[];
    readonly functions?: Readonly<Record<string, ExpressionFunction>>;
    readonly maxSteps?: number;
  } = {}) {
    const maxSteps = options.maxSteps ?? 1_000;
    if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new RangeError("maxSteps must be a positive integer.");
    this.maxSteps = maxSteps;
    const functions = Object.create(null) as Record<string, ExpressionFunction>;
    for (const [name, callable] of Object.entries(DEFAULT_EXPRESSION_FUNCTIONS)) functions[name] = callable;
    for (const [name, callable] of Object.entries(options.functions ?? {})) functions[name] = callable;
    this.functions = Object.freeze(functions);
    for (const program of options.programs ?? []) this.register(program);
  }

  register(program: ExpressionProgram): void {
    if (program.id.length === 0 || this.programs.has(program.id)) {
      throw expressionError("Expression program IDs must be non-empty and unique.", { programId: program.id });
    }
    if (!valueMatchesType(program.fallback, program.resultType)) {
      throw expressionError("Expression fallback type does not match its contract.", {
        programId: program.id,
        expectedType: program.resultType
      });
    }
    this.programs.set(program.id, program);
  }

  evaluate(programId: string, context: ExpressionContext): ExpressionEvaluationResult {
    const program = this.programs.get(programId);
    if (program === undefined) {
      const error = expressionError("Expression program is not registered.", { programId });
      return { ok: false, value: null, fallbackUsed: true, error };
    }
    try {
      const value = this.evaluateProgram(program, { steps: 0, active: new Set(), context });
      this.lastValid.set(programId, value);
      return { ok: true, value, fallbackUsed: false };
    } catch (cause) {
      const error = cause instanceof EngineError
        ? cause
        : new EngineError(ERROR_CODES.EXPRESSION_FAILED, "Expression evaluation failed.", { cause, details: { programId } });
      return {
        ok: false,
        value: this.lastValid.get(programId) ?? program.fallback,
        fallbackUsed: true,
        error
      };
    }
  }

  clearLastValid(programId?: string): void {
    if (programId === undefined) this.lastValid.clear();
    else this.lastValid.delete(programId);
  }

  private evaluateProgram(program: ExpressionProgram, state: EvaluationState): JsonValue {
    if (state.active.has(program.id)) {
      throw new EngineError(ERROR_CODES.EXPRESSION_CYCLE, "Expression dependency cycle detected.", {
        details: { programId: program.id }
      });
    }
    state.active.add(program.id);
    try {
      const value = this.evaluateNode(program.ast, state);
      if (!valueMatchesType(value, program.resultType)) {
        throw expressionError("Expression result type does not match its contract.", {
          programId: program.id,
          expectedType: program.resultType
        });
      }
      return value;
    } finally {
      state.active.delete(program.id);
    }
  }

  private evaluateNode(node: ExpressionAstNode, state: EvaluationState): JsonValue {
    state.steps += 1;
    if (state.steps > this.maxSteps) {
      throw new EngineError(ERROR_CODES.EXPRESSION_LIMIT_EXCEEDED, "Expression step limit exceeded.", {
        details: { maxSteps: this.maxSteps }
      });
    }
    switch (node.type) {
      case "literal": return node.value;
      case "variable": {
        if (!Object.prototype.hasOwnProperty.call(state.context.variables, node.name)) {
          throw expressionError("Expression variable is not available.", { variable: node.name });
        }
        return state.context.variables[node.name] ?? null;
      }
      case "reference": {
        const referenced = this.programs.get(node.programId);
        if (referenced === undefined) throw expressionError("Referenced expression is not registered.", { programId: node.programId });
        return this.evaluateProgram(referenced, state);
      }
      case "unary": {
        const value = this.evaluateNode(node.argument, state);
        if (node.operator === "!") return !value;
        const number = requireNumber(value, "Unary operand");
        return node.operator === "-" ? -number : number;
      }
      case "binary": return this.evaluateBinary(node, state);
      case "conditional": return this.evaluateNode(
        this.evaluateNode(node.test, state) ? node.consequent : node.alternate,
        state
      );
      case "call": {
        if (!Object.prototype.hasOwnProperty.call(this.functions, node.name)) {
          throw expressionError("Expression function is not whitelisted.", { functionName: node.name });
        }
        const callable = this.functions[node.name];
        if (callable === undefined) throw expressionError("Expression function is not whitelisted.", { functionName: node.name });
        return callable(node.arguments.map((argument) => this.evaluateNode(argument, state)), state.context);
      }
    }
    throw expressionError("Unsupported expression AST node type.");
  }

  private evaluateBinary(
    node: Extract<ExpressionAstNode, { type: "binary" }>,
    state: EvaluationState
  ): JsonValue {
    const left = this.evaluateNode(node.left, state);
    if (node.operator === "&&") return left ? this.evaluateNode(node.right, state) : left;
    if (node.operator === "||") return left ? left : this.evaluateNode(node.right, state);
    const right = this.evaluateNode(node.right, state);
    if (node.operator === "===") return left === right;
    if (node.operator === "!==") return left !== right;
    const leftNumber = requireNumber(left, "Left operand");
    const rightNumber = requireNumber(right, "Right operand");
    switch (node.operator) {
      case "+": return leftNumber + rightNumber;
      case "-": return leftNumber - rightNumber;
      case "*": return leftNumber * rightNumber;
      case "/":
        if (rightNumber === 0) throw expressionError("Division by zero is not allowed.");
        return leftNumber / rightNumber;
      case "%":
        if (rightNumber === 0) throw expressionError("Modulo by zero is not allowed.");
        return leftNumber % rightNumber;
      case "**": return leftNumber ** rightNumber;
      case "<": return leftNumber < rightNumber;
      case "<=": return leftNumber <= rightNumber;
      case ">": return leftNumber > rightNumber;
      case ">=": return leftNumber >= rightNumber;
      default: throw expressionError("Unsupported binary operator.");
    }
  }
}

export function programFromExpressionDefinition(
  id: string,
  definition: ExpressionDefinition,
  resultType: ExpressionValueType
): ExpressionProgram {
  if (definition.ast === undefined) {
    throw expressionError("ExpressionDefinition requires a safe AST for evaluation.", { programId: id });
  }
  return {
    id,
    ast: definition.ast,
    resultType,
    fallback: definition.fallback ?? defaultFallback(resultType)
  };
}

function defaultFallback(resultType: ExpressionValueType): JsonValue {
  switch (resultType) {
    case "number": return 0;
    case "string": return "";
    case "boolean": return false;
    case "vector2": return { x: 0, y: 0 };
    case "vector3": return { x: 0, y: 0, z: 0 };
    case "null":
    case "json": return null;
  }
}
