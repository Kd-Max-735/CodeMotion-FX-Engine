import { expect } from "vitest";
import { EFFECT_TOOL_REGISTRY } from "../../src/registry.js";

export function expectValidParameterContract(markdown: string, toolName: string): readonly string[] {
  const definition = EFFECT_TOOL_REGISTRY.getByToolName(toolName);
  expect(definition, `${toolName} must exist in Registry`).toBeDefined();
  if (definition === undefined) return [];
  const schema = definition.parameterSchema;
  expect(typeof schema).toBe("object");
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return [];
  const properties = schema.properties;
  expect(typeof properties).toBe("object");
  if (typeof properties !== "object" || properties === null || Array.isArray(properties)) return [];

  const block = markdown.match(
    /<!-- self-check-parameter-contract:start -->([\s\S]*?)<!-- self-check-parameter-contract:end -->/u
  );
  expect(block, `${toolName} needs one important-parameter contract`).not.toBeNull();
  const rows = [...(block?.[1] ?? "").matchAll(/^\| `([^`]+)` \| ([^|]+) \|/gmu)];
  expect(rows.length, `${toolName} needs important parameters`).toBeGreaterThan(0);
  for (const row of rows) {
    expect(Object.hasOwn(properties, row[1]!), `${toolName}.${row[1]} must be a real Schema key`).toBe(true);
    expect(row[2], `${toolName}.${row[1]} needs a Chinese label`).toMatch(/[\u3400-\u9fff]/u);
  }
  expect(block?.[1]).toContain("最终生效值");
  expect(block?.[1]).toContain("metadata.observed_effect");
  return rows.map((row) => row[1]!);
}
