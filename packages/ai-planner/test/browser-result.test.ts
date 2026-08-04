import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

const rasterObservations = vi.hoisted(() => ({
  requests: [] as unknown[],
  formalSources: [] as unknown[],
  rendererSources: [] as unknown[]
}));

vi.mock("@codemotion/effects-2d", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@codemotion/effects-2d")>();
  return {
    ...actual,
    resolveFormal2dRasterSourceV1: (
      ...args: Parameters<typeof actual.resolveFormal2dRasterSourceV1>
    ) => {
      rasterObservations.requests.push(args[0]);
      const source = actual.resolveFormal2dRasterSourceV1(...args);
      if (source !== undefined) rasterObservations.formalSources.push(source);
      return source;
    }
  };
});

vi.mock("@codemotion/exporter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@codemotion/exporter")>();
  return {
    ...actual,
    createProjectFrameProducer: (
      ...args: Parameters<typeof actual.createProjectFrameProducer>
    ) => {
      const [project, media, options] = args;
      if (options === undefined || typeof options === "string") {
        return actual.createProjectFrameProducer(...args);
      }
      const resolver = options.resolveRasterSource;
      if (resolver === undefined) return actual.createProjectFrameProducer(...args);
      return actual.createProjectFrameProducer(project, media, {
        ...options,
        resolveRasterSource: async (request) => {
          const source = await resolver(request);
          if (source !== undefined) rasterObservations.rendererSources.push(source);
          return source;
        }
      });
    }
  };
});

import { P0_BROWSER_PROJECT_AUTHORITY_V1 } from "@codemotion/effects-2d";
import {
  OfflineMockProvider,
  planAnimation,
  serializeAiPlanCompletedResultV2,
  type PlannedAnimation
} from "../src/index.js";

const principal = {
  tenantId: "tenant-result-test",
  userId: "user-result-test",
  taskId: "task-result-test",
  scopes: ["ai:plan"] as const
};

async function planned(prompt = "safe browser title"): Promise<PlannedAnimation> {
  const provider = new OfflineMockProvider();
  return planAnimation(await provider.understand({ principal, prompt }), {
    duration: 1,
    previewFrameLimit: 2
  });
}

function freezeDeep<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && "value" in descriptor) freezeDeep(descriptor.value, seen);
  }
  return Object.freeze(value);
}

describe("AI completed browser result", () => {
  it("serializes a real plan through the fixed P0 authority without mutating the server DTO", async () => {
    const input = await planned();
    const before = structuredClone(input);
    const result = serializeAiPlanCompletedResultV2(input);

    expect(result.contract).toBe("ai-plan-result/v2");
    expect(result.preview).toEqual({
      width: 160,
      height: 90,
      quality: "draft",
      frameCount: input.preview.frameHashes.length,
      timeContractVersion: "1.1.0"
    });
    expect(P0_BROWSER_PROJECT_AUTHORITY_V1.validateAiPlanCompletedResult(result).valid).toBe(true);
    expect(result.editableProject.project.metadata).toEqual({ timeContractVersion: "1.1.0" });
    expect(result.editableProject.project.fonts).toEqual([{
      id: "font.codemotion.unicode-bitmap-v1",
      family: "Codemotion Planner Unicode Bitmap"
    }]);
    expect(input).toEqual(before);

    const serialized = JSON.stringify(result);
    for (const forbidden of [
      '"dsl"', '"understanding"', '"trace"', '"frameHashes"', '"frameNumbers"',
      '"frameTimes"', '"projectId"', '"provider"', '"modelId"',
      '"requestFingerprint"', '"inputHash"', '"usage"', '"confidence"', '"risks"',
      '"metadata":{"ai"'
    ]) expect(serialized).not.toContain(forbidden);
  });

  it("supports frozen input and ignores extra call arguments without accepting forged authority", async () => {
    const input = freezeDeep(await planned("frozen safe title"));
    const expected = serializeAiPlanCompletedResultV2(input);
    const forged = {
      sanitizeBrowserProject: () => ({ valid: true, value: { forged: true } }),
      validateAiPlanCompletedResult: () => ({ valid: true, value: { forged: true } })
    };
    expect((serializeAiPlanCompletedResultV2 as unknown as Function)(input, forged)).toEqual(expected);
  });

  it("allowlists issue codes and replaces raw internal messages", async () => {
    const input = structuredClone(await planned());
    (input.issues as Array<{ code: string; severity: "warning"; message: string }>).push({
      code: "safety",
      severity: "warning",
      message: "C:\\owner-secret\\token.txt provider-internal"
    });
    const result = serializeAiPlanCompletedResultV2(input);
    expect(result.issues).toEqual([{
      code: "SAFETY",
      severity: "warning",
      message: "The planned project did not pass safety validation."
    }]);
    expect(JSON.stringify(result)).not.toMatch(/owner-secret|token\.txt|provider-internal/iu);
  });

  it.each([undefined, null, 0, "raw", true, [], new Array(2), new Date()])(
    "fails closed for non-DTO input %#",
    (value) => {
      expect(() => serializeAiPlanCompletedResultV2(value as unknown as PlannedAnimation))
        .toThrowError("AI plan result serialization failed.");
    }
  );

  it("rejects proxies, accessors, cycles, pollution keys, non-finite values and unknown issues without reading secrets", async () => {
    const base = await planned();
    let getterCalls = 0;
    const attacks: unknown[] = [
      new Proxy(base, { get() { getterCalls += 1; throw new Error("secret-proxy"); } }),
      Object.defineProperty({ ...base }, "storyboard", {
        get() { getterCalls += 1; throw new Error("secret-getter"); },
        enumerable: true
      }),
      Object.defineProperty({ ...base }, "storyboard", {
        set(_value) { getterCalls += 1; },
        enumerable: true
      }),
      { ...base, authority: { forged: true } },
      { ...base, preview: { ...base.preview, frameTimes: [Number.NaN, 1] } },
      { ...base, issues: [{ code: "UNKNOWN_SECRET_CODE", severity: "error", message: "token-secret" }] }
    ];
    const cyclic = structuredClone(base) as PlannedAnimation & { loop?: unknown };
    (cyclic.dsl.metadata as Record<string, unknown>).loop = cyclic.dsl.metadata;
    attacks.push(cyclic);
    const polluted = structuredClone(base) as PlannedAnimation;
    Object.defineProperty(polluted.storyboard.shots[0]!.effects[0]!.params, "__proto__", {
      value: { token: "secret" }, enumerable: true
    });
    attacks.push(polluted);
    const symbolArray = structuredClone(base);
    Object.defineProperty(symbolArray.preview.frameHashes, Symbol("secret"), { value: "token" });
    attacks.push(symbolArray);

    for (const attack of attacks) {
      let message = "";
      try {
        serializeAiPlanCompletedResultV2(attack as PlannedAnimation);
      } catch (error) {
        message = error instanceof Error ? `${error.message}\n${error.cause ?? ""}` : String(error);
      }
      expect(message).toBe("AI plan result serialization failed.\n");
      expect(message).not.toMatch(/secret|token|proxy|get|UNKNOWN/iu);
    }
    expect(getterCalls).toBe(0);
  });

  it("does not consume inherited fields or a polluted Object.prototype", async () => {
    const input = await planned();
    Object.defineProperty(Object.prototype, "providerSecret", {
      value: "must-not-leak",
      configurable: true,
      enumerable: true,
      writable: true
    });
    try {
      expect(() => serializeAiPlanCompletedResultV2(input))
        .toThrowError("AI plan result serialization failed.");
    } finally {
      delete (Object.prototype as { providerSecret?: string }).providerSecret;
    }
    const inherited = Object.create({ storyboard: input.storyboard }) as PlannedAnimation;
    for (const key of ["understanding", "dsl", "issues", "preview", "trace"] as const) {
      Object.defineProperty(inherited, key, { value: input[key], enumerable: true });
    }
    expect(() => serializeAiPlanCompletedResultV2(inherited))
      .toThrowError("AI plan result serialization failed.");
  });

  it("keeps private raster builders absent and renders deterministic formal text and inline SVG previews", async () => {
    const [pipelineSource, rasterSource] = await Promise.all([
      readFile("packages/ai-planner/src/pipeline.ts", "utf8"),
      readFile("packages/ai-planner/src/raster-sources.ts", "utf8")
    ]);
    expect(pipelineSource).toContain("resolveFormal2dRasterSourceV1");
    expect(pipelineSource).toContain("compositionWidth: composition.width");
    expect(pipelineSource).toContain("renderWidth: request.width");
    expect(pipelineSource).toContain("projectTime: projectTime.projectTime");
    expect(pipelineSource).toContain("layerTime: layerTime.localTime");
    expect(pipelineSource).toContain("signal: options.signal");
    expect(`${pipelineSource}\n${rasterSource}`).not.toMatch(
      /textRasterSource|vectorRasterSource|glyphCoverage|parseSvgPathData|function\s+(?:textSource|shapeSource|inlineSvgSource)/u
    );

    const textResult = await new OfflineMockProvider().understand({ principal, prompt: "formal text title" });
    const first = await planAnimation(textResult, { duration: 1, previewFrameLimit: 2 });
    const second = await planAnimation(textResult, { duration: 1, previewFrameLimit: 2 });
    expect(first.preview.frameHashes).toEqual(second.preview.frameHashes);

    const vectorResult = await new OfflineMockProvider().understand({ principal, prompt: "ink contour vector" });
    const vector = await planAnimation(vectorResult, {
      duration: 1,
      previewFrameLimit: 2,
      effectIds: ["fx.draw.inkSpread"]
    });
    expect(vector.dsl.compositions[0]!.layers.some((layer) => layer.type === "svg")).toBe(true);
    expect(vector.preview.frameHashes).toHaveLength(2);
  });

  it("preserves model control characters until the formal adapter rejects them", async () => {
    rasterObservations.requests.length = 0;
    const input = await new OfflineMockProvider().understand({ principal, prompt: "formal text title" });
    const modelText = String.fromCodePoint(65, 0, 66);
    const textLayer = input.storyboard.layers.find((layer) => layer.type === "text");
    if (textLayer?.type !== "text") throw new Error("Expected a model text layer.");
    textLayer.text = modelText;

    await expect(planAnimation(input, { duration: 1, previewFrameLimit: 1 }))
      .rejects.toMatchObject({ code: "FONT_UNAVAILABLE" });

    const request = rasterObservations.requests.at(-1) as {
      readonly layer: { readonly properties: { readonly text: string } };
    };
    expect([...request.layer.properties.text].map((value) => value.codePointAt(0))).toEqual([65, 0, 66]);
    expect(request.layer.properties.text).not.toBe("A B");
  });

  it("hands the formal three-glyph space source to the draft renderer unchanged", async () => {
    rasterObservations.formalSources.length = 0;
    rasterObservations.rendererSources.length = 0;
    const input = await new OfflineMockProvider().understand({ principal, prompt: "formal text title" });
    const textLayer = input.storyboard.layers.find((layer) => layer.type === "text");
    if (textLayer?.type !== "text") throw new Error("Expected a model text layer.");
    textLayer.text = "A B";

    const result = await planAnimation(input, { duration: 1, previewFrameLimit: 1 });
    const formalSource = rasterObservations.formalSources.find((source) =>
      (source as { readonly kind?: unknown }).kind === "text") as {
      readonly kind: "text";
      readonly text: string;
      readonly glyphs: readonly {
        readonly cluster: number;
        readonly bounds: { readonly x: number };
        readonly coverage: { readonly data: Uint8Array };
      }[];
    };

    const dslTextLayer = result.dsl.compositions[0]!.layers.find((layer) => layer.type === "text");
    expect(dslTextLayer?.properties.text).toBe("A B");
    expect(formalSource.text).toBe("A B");
    expect(formalSource.glyphs).toHaveLength(3);
    expect(formalSource.glyphs.map((glyph) => glyph.cluster)).toEqual([0, 1, 2]);
    expect(formalSource.glyphs.map((glyph) => glyph.bounds.x)).toEqual([
      formalSource.glyphs[0]!.bounds.x,
      formalSource.glyphs[1]!.bounds.x,
      formalSource.glyphs[2]!.bounds.x
    ].sort((left, right) => left - right));
    expect(formalSource.glyphs[1]!.coverage.data.every((value) => value === 0)).toBe(true);
    expect(rasterObservations.rendererSources).toContain(formalSource);
  });

  it("stops before draft raster work when the shared signal is already aborted", async () => {
    const providerResult = await new OfflineMockProvider().understand({ principal, prompt: "abort formal raster" });
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(planAnimation(providerResult, {
      duration: 1,
      previewFrameLimit: 2,
      signal: controller.signal
    })).rejects.toThrow("cancelled");
  });
});
