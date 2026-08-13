import { describe, expect, it } from "vitest";
import {
  P0_EFFECT_CARDS,
  P0_EFFECTS,
  effectCardForEffectId,
  effectCardSupportsLayer,
  hashPixelSurface,
  createV22SampleEffectInstance,
  renderEffectCardFrame,
  verifyP0EffectCardRuntime
} from "../src/index.js";

const expectedIds = P0_EFFECTS.map((definition) => definition.effectId);
const fiveProgressPoints = [0, 0.25, 0.5, 0.75, 1] as const;
const originalIds = [
  "fx.motion.fade", "fx.motion.slide", "fx.text.typewriter", "fx.draw.handwriting",
  "fx.light.neonGlow", "fx.post.gaussianBlur", "fx.transition.wipe", "fx.composite.maskReveal"
] as const;
const expansionGroups = [
  ["第一组", ["fx.motion.scalePop", "fx.motion.rotateIn", "fx.motion.bounce", "fx.motion.elastic", "fx.motion.float", "fx.motion.shake", "fx.text.characterCascade", "fx.text.kineticTypography"]],
  ["第二组", ["fx.text.textPathReveal", "fx.text.textMorph", "fx.text.scrambleDecode", "fx.text.wordExplode", "fx.text.textExtrude3D", "fx.vector.pathTrim", "fx.vector.pathMorph", "fx.vector.shapeRepeater"]],
  ["第三组", ["fx.vector.radialBurst", "fx.draw.brushReveal", "fx.draw.inkSpread", "fx.draw.chalkStroke", "fx.light.scanBeam", "fx.light.lensFlare", "fx.light.energyPulse", "fx.post.directionalBlur"]],
  ["第四组", ["fx.post.radialBlur", "fx.post.motionBlur", "fx.transition.radialWipe", "fx.transition.liquidWipe", "fx.transition.pixelDissolve", "fx.composite.trackMatte", "fx.composite.blend", "fx.composite.displacementMap"]]
] as const;

function expectRealFrames(effectIds: readonly string[]): void {
  for (const effectId of effectIds) {
    const card = effectCardForEffectId(effectId)!;
    const frames = fiveProgressPoints.map((progress) => renderEffectCardFrame(card, progress));
    for (const frame of frames) expect(frame.data).toHaveLength(frame.width * frame.height * 4);
    expect(frames.some((frame) => frame.data.some((channel) => channel !== 0)), `${effectId} has no non-empty frame`).toBe(true);
    expect(new Set(frames.map(hashPixelSurface)).size, effectId).toBeGreaterThan(1);
  }
}

describe("P0 40-effect cards", () => {
  it("publishes neon glow as a compatible text-stack effect", () => {
    expect(effectCardForEffectId("fx.light.neonGlow")?.supportedTargets).toContain("text");
  });
  it("adapts exactly 40 unique registered effects in frozen order", () => {
    expect(P0_EFFECTS).toHaveLength(40);
    expect(P0_EFFECT_CARDS.map((card) => card.effectId)).toEqual(expectedIds);
    expect(new Set(P0_EFFECT_CARDS.map((card) => card.effectId)).size).toBe(40);
    expect(new Set(P0_EFFECT_CARDS.map((card) => card.id)).size).toBe(40);
    for (const card of P0_EFFECT_CARDS) {
      expect(card.name.length).toBeGreaterThan(0);
      expect(card.description.length).toBeGreaterThan(0);
      expect(/[\u3400-\u9fff]/u.test(`${card.name}${card.description}`)).toBe(true);
      expect(card.tags.length).toBeGreaterThan(0);
      expect(card.preview.kind).toBe("runtime-loop");
      expect(card.thumbnail.kind).toBe("runtime-frame");
      expect(card.defaultDuration).toBeGreaterThan(0);
      expect(card.supportedTargets.length).toBeGreaterThan(0);
      expect(card.parameterSchema).toMatchObject({ type: "object", additionalProperties: false });
      expect(Object.keys(card.defaultParams).length).toBeGreaterThan(0);
      expect(["light", "medium", "heavy"]).toContain(card.performanceClass);
      expect(card.status).toBe("verified");
      expect(card.acceptanceState).toBe("pending-human");
      expect(card.editableParameterNames.length).toBeGreaterThan(0);
      expect(card.ai.explanation.length).toBeGreaterThan(0);
      expect(effectCardForEffectId(card.effectId)).toBe(card);
      const definition = P0_EFFECTS.find((item) => item.effectId === card.effectId)!;
      expect(definition.presets.length, card.effectId).toBeGreaterThanOrEqual(3);
    }
  });

  it("clones the exact card instance preset used by preview and editor insertion", () => {
    for (const card of P0_EFFECT_CARDS) {
      const instance = createV22SampleEffectInstance(card.effectId, `effect.test.${card.id}`);
      expect(instance?.params).toEqual(card.defaultParams);
      expect(instance?.params).not.toBe(card.defaultParams);
    }
  });

  it("reports all 40 real registered runtimes as available", () => {
    expect(verifyP0EffectCardRuntime()).toEqual(expectedIds.map((effectId) => ({
      effectId, available: true, renders: true
    })));
  });

  it("keeps the original eight real and time-varying at five time points", () => {
    expectRealFrames(originalIds);
  }, 15_000);

  it.each(expansionGroups)("renders %s through real runtimes at five time points", (_name, effectIds) => {
    expectRealFrames(effectIds);
  }, 30_000);

  it("keeps every default parameter inside its declared closed Schema and exposes a rejectable bound", () => {
    for (const definition of P0_EFFECTS) {
      const schema = definition.parameterSchema as Record<string, unknown>;
      const properties = schema.properties as Record<string, Record<string, unknown>>;
      const required = schema.required as readonly string[];
      expect(schema.additionalProperties, definition.effectId).toBe(false);
      for (const name of required) {
        const property = properties[name]!;
        const value = definition.defaultPreset[name];
        expect(value, `${definition.effectId}.${name} default`).not.toBeUndefined();
        if (property.type === "number") {
          expect(value, `${definition.effectId}.${name} minimum`).toBeGreaterThanOrEqual(property.minimum as number);
          expect(value, `${definition.effectId}.${name} maximum`).toBeLessThanOrEqual(property.maximum as number);
        }
        if (Array.isArray(property.enum)) expect(property.enum, `${definition.effectId}.${name} enum`).toContain(value);
      }
      expect(Object.values(properties).some((property) => property.maximum !== undefined || Array.isArray(property.enum)), definition.effectId).toBe(true);
    }
  });

  it("exposes target and dual-input conditions that match runtime requirements", () => {
    const byId = new Map(P0_EFFECT_CARDS.map((card) => [card.effectId, card]));
    expect(effectCardSupportsLayer(byId.get("fx.text.typewriter")!, "text")).toBe(true);
    expect(effectCardSupportsLayer(byId.get("fx.text.typewriter")!, "image")).toBe(false);
    expect(effectCardSupportsLayer(byId.get("fx.draw.handwriting")!, "text")).toBe(true);
    expect(effectCardSupportsLayer(byId.get("fx.light.neonGlow")!, "image")).toBe(true);
    expect(effectCardSupportsLayer(byId.get("fx.light.neonGlow")!, "shape")).toBe(false);
    expect(byId.get("fx.transition.wipe")?.fixture.secondaryInput).toBe(true);
    expect(byId.get("fx.composite.maskReveal")?.fixture.secondaryInput).toBe(true);
    expect(P0_EFFECT_CARDS.filter((card) => card.fixture.secondaryInput)).toHaveLength(8);
    expect(P0_EFFECT_CARDS.filter((card) => card.fixture.inputKind === "text")).toHaveLength(9);
    expect(P0_EFFECT_CARDS.every((card) => card.fixture.fixtureId.length > 0)).toBe(true);
  });
});
