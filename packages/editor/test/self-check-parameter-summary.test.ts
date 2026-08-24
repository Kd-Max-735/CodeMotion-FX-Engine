import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EFFECT_TOOL_REGISTRY,
  validateAndNormalizeEffectEnvelope
} from "@codemotion/effect-functions";
import {
  SELF_CHECK_IMPORTANT_PARAMETER_TOOL_NAMES,
  importantParameterDefinitions,
  selfCheckParameterInformation
} from "../src/self-check-parameter-summary.js";

const RULE_DIRECTORY = join(
  process.cwd(),
  "packages/effect-functions/self-check-rules/tools"
);

describe("90 effect self-check parameter summaries", () => {
  it("covers exactly the 90 tools that have self-check Markdown", async () => {
    const markdownTools = (await readdir(RULE_DIRECTORY))
      .filter((name) => name.endsWith(".md"))
      .map((name) => name.slice(0, -3))
      .sort();
    const catalogTools = [...SELF_CHECK_IMPORTANT_PARAMETER_TOOL_NAMES].sort();

    expect(markdownTools).toHaveLength(90);
    expect(new Set(catalogTools).size).toBe(90);
    expect(catalogTools).toEqual(markdownTools);
  });

  it("uses only real Schema keys and values from normalized final parameters", async () => {
    for (const toolName of SELF_CHECK_IMPORTANT_PARAMETER_TOOL_NAMES) {
      const definition = EFFECT_TOOL_REGISTRY.getByToolName(toolName);
      expect(definition, `${toolName} must exist in Registry`).toBeDefined();
      if (definition === undefined) continue;

      const schema = definition.parameterSchema;
      expect(typeof schema).toBe("object");
      if (typeof schema !== "object" || schema === null || Array.isArray(schema)) continue;
      const properties = schema.properties;
      expect(typeof properties).toBe("object");
      if (typeof properties !== "object" || properties === null || Array.isArray(properties)) continue;

      const effectiveEnvelope = validateAndNormalizeEffectEnvelope(definition, toolName, {
        type: toolName,
        data: definition.defaults
      });
      const fields = importantParameterDefinitions(toolName);
      const information = selfCheckParameterInformation(toolName, effectiveEnvelope.data);

      expect(fields.length, `${toolName} needs important parameters`).toBeGreaterThan(0);
      expect(Object.keys(information)).toEqual(fields.map(([name]) => name));
      for (const [name, label] of fields) {
        expect(Object.hasOwn(properties, name), `${toolName}.${name} must be a real Schema key`).toBe(true);
        expect(label, `${toolName}.${name} needs a Chinese label`).toMatch(/[\u3400-\u9fff]/u);
        expect(information[name]).toEqual({ label, value: effectiveEnvelope.data[name] });
      }

      const markdown = await readFile(join(RULE_DIRECTORY, `${toolName}.md`), "utf8");
      const contract = markdown.match(
        /<!-- self-check-parameter-contract:start -->([\s\S]*?)<!-- self-check-parameter-contract:end -->/u
      );
      expect(contract, `${toolName}.md needs one parameter contract`).not.toBeNull();
      const documentedKeys = [...(contract?.[1] ?? "").matchAll(/^\| `([^`]+)` \|/gmu)]
        .map((match) => match[1]);
      expect(documentedKeys).toEqual(fields.map(([name]) => name));
      expect(contract?.[1]).toContain("最终生效值");
      expect(contract?.[1]).toContain("metadata.observed_effect");
    }
  });

  it("fails closed for unknown tools and invalid parameter values", () => {
    expect(() => importantParameterDefinitions("not_a_real_effect")).toThrow(/未定义重要自检参数/u);
    expect(() => selfCheckParameterInformation("film_grain", { amount: "not-a-number" }))
      .toThrow();
  });
});
