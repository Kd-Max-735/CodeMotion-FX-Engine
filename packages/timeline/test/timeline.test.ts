import { describe, expect, it } from "vitest";
import {
  ERROR_CODES,
  type Animatable,
  type CompositionLayer,
  type EasingDefinition,
  type EffectInstance,
  type NullLayer,
  type TransformDefinition
} from "@codemotion/core";
import {
  bakeAnimatable,
  bakeKeyframes,
  createEffectRandom,
  evaluateAnimatable,
  evaluateAnimatableAt,
  evaluateEasing,
  evaluateKeyframes,
  fixedFrameRange,
  frameTime,
  frameToSeconds,
  mapLoopTime,
  migrateEffectTimeSampleV1,
  migrateLegacyAbsoluteEffectTiming,
  resolveEffectTimeSample,
  resolveLayerTime,
  resolveLayerTimeSample,
  resolveNestedTime,
  resolveProjectTimeSample,
  secondsToFrame
} from "../src/index.js";

const transform: TransformDefinition = {
  anchorPoint: { mode: "constant", value: { x: 0, y: 0, z: 0 } },
  position: { mode: "constant", value: { x: 0, y: 0, z: 0 } },
  scale: { mode: "constant", value: { x: 100, y: 100, z: 100 } },
  rotation: { mode: "constant", value: { x: 0, y: 0, z: 0 } }
};

function nullLayer(overrides: Partial<NullLayer> = {}): NullLayer {
  return {
    id: "layer.null",
    type: "null",
    name: "Null",
    visible: true,
    locked: false,
    solo: false,
    startTime: 0,
    endTime: 10,
    inPoint: 0,
    outPoint: 10,
    zIndex: 0,
    transform,
    opacity: { mode: "constant", value: 1 },
    blendMode: "normal",
    masks: [],
    effects: [],
    properties: {},
    ...overrides
  };
}

function compositionLayer(overrides: Partial<CompositionLayer> = {}): CompositionLayer {
  return {
    ...nullLayer(),
    id: "layer.precomp",
    type: "composition",
    properties: { compositionId: "composition.child" },
    ...overrides
  };
}

function effect(
  id: string,
  effectId: string,
  overrides: Partial<EffectInstance> = {}
): EffectInstance {
  return {
    id,
    effectId,
    version: "1.0.0",
    enabled: true,
    mix: { mode: "constant", value: 1 },
    params: {},
    ...overrides
  };
}

function pseudoRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function generatedId(random: () => number): string {
  return [
    Math.floor(random() * 0x1_0000_0000).toString(36),
    Math.floor(random() * 0x1_0000_0000).toString(36)
  ].join(".");
}

describe("fixed logical time", () => {
  it("converts only from explicit frame, seconds, and fps", () => {
    expect(frameToSeconds(75, 30)).toBe(2.5);
    expect(secondsToFrame(2.51, 30, "floor")).toBe(75);
    expect(secondsToFrame(2.51, 30, "ceil")).toBe(76);
    expect(secondsToFrame(2.51, 30)).toBe(75);
    expect(frameTime(60, 24)).toEqual({ frame: 60, seconds: 2.5, fps: 24 });
    expect(fixedFrameRange(2, 4, 2).map((value) => value.seconds)).toEqual([1, 1.5, 2]);
  });

  it("rejects invalid timebase inputs", () => {
    expect(() => frameToSeconds(0.5, 30)).toThrowError(expect.objectContaining({ code: ERROR_CODES.INVALID_TIME }));
    expect(() => frameToSeconds(1, 0)).toThrowError(expect.objectContaining({ code: ERROR_CODES.INVALID_TIME }));
    expect(() => fixedFrameRange(5, 4, 30)).toThrowError(expect.objectContaining({ code: ERROR_CODES.INVALID_TIME }));
  });

  it("maps repeat and ping-pong loops at positive and negative boundaries", () => {
    expect(mapLoopTime(4, 1, 4, "repeat")).toBe(1);
    expect(mapLoopTime(0, 1, 4, "repeat")).toBe(3);
    expect(mapLoopTime(4, 1, 4, "ping-pong")).toBeLessThan(4);
    expect(mapLoopTime(5, 1, 4, "ping-pong")).toBe(3);
    expect(mapLoopTime(-1, 1, 4, "ping-pong")).toBe(3);
    expect(mapLoopTime(10, 1, 4, "none")).toBe(4);
  });

  it("keeps ping-pong folds inside a non-zero half-open range across cycles", () => {
    const samples = [-8, -2.5, -2, -1.5, 3.5, 4, 4.5, 9.5, 10, 10.5]
      .map((time) => mapLoopTime(time, 1, 4, "ping-pong"));
    for (const mapped of samples) {
      expect(mapped).toBeGreaterThanOrEqual(1);
      expect(mapped).toBeLessThan(4);
    }

    const firstFold = [3.5, 4, 4.5].map((time) => mapLoopTime(time, 1, 4, "ping-pong"));
    const laterFold = [9.5, 10, 10.5].map((time) => mapLoopTime(time, 1, 4, "ping-pong"));
    const negativeFold = [-2.5, -2, -1.5].map((time) => mapLoopTime(time, 1, 4, "ping-pong"));
    for (const [before, fold, after] of [firstFold, laterFold, negativeFold]) {
      expect(fold).toBeGreaterThan(before!);
      expect(fold).toBeGreaterThan(after!);
      expect(before).toBe(after);
    }
  });
});

describe("versioned time contract", () => {
  it("keeps effect-local time and random streams invariant under randomized timeline translation", () => {
    const random = pseudoRandom(0x5a17c0de);
    for (let iteration = 0; iteration < 64; iteration += 1) {
      const shift = random() * 500;
      const layerDuration = 0.5 + random() * 20;
      const effectStart = random() * layerDuration * 0.4;
      const effectEnd = effectStart + (layerDuration - effectStart) * (0.2 + random() * 0.8);
      const localSample = effectStart + (effectEnd - effectStart) * random();
      const delta = random() * Math.min(0.1, localSample);
      const fps = 12 + random() * 108;
      const shiftedFps = 12 + random() * 108;
      const baseLayer = nullLayer({ startTime: 0, endTime: layerDuration, outPoint: layerDuration });
      const shiftedLayer = nullLayer({
        startTime: shift,
        endTime: shift + layerDuration,
        outPoint: layerDuration
      });
      const instance = effect(generatedId(random), generatedId(random), {
        startTime: effectStart,
        endTime: effectEnd
      });
      const baseProject = resolveProjectTimeSample({
        projectTime: localSample,
        previousProjectTime: localSample - delta,
        fps
      });
      const shiftedProject = resolveProjectTimeSample({
        projectTime: shift + localSample,
        previousProjectTime: shift + localSample - delta,
        fps: shiftedFps
      });
      const baseEffect = resolveEffectTimeSample(
        instance,
        resolveLayerTimeSample(baseLayer, baseProject),
        baseProject,
        layerDuration
      );
      const shiftedEffect = resolveEffectTimeSample(
        instance,
        resolveLayerTimeSample(shiftedLayer, shiftedProject),
        shiftedProject,
        layerDuration
      );

      expect(shiftedEffect.effectTime).toBeCloseTo(baseEffect.effectTime, 10);
      expect(baseEffect.effectId).toBe(instance.effectId);
      expect(baseEffect.effectInstanceId).toBe(instance.id);
      expect(shiftedEffect.progress).toBeCloseTo(baseEffect.progress, 10);
      expect(shiftedEffect.deltaTime).toBeCloseTo(baseEffect.deltaTime, 10);
      expect(createEffectRandom(987654321, shiftedEffect, "jitter", 37).nextUint32())
        .toBe(createEffectRandom(987654321, baseEffect, "jitter", 37).nextUint32());
    }
  });

  it("defines deltaTime from explicit samples and evaluates Animatable values in their owner time space", () => {
    const random = pseudoRandom(0x711ec7ed);
    const project = resolveProjectTimeSample({ projectTime: 12.75, previousProjectTime: 12.6, fps: 48 });
    const layerDefinition = nullLayer({ startTime: 10, endTime: 20, outPoint: 10 });
    const layer = resolveLayerTimeSample(layerDefinition, project);
    const currentEffect = resolveEffectTimeSample(
      effect(generatedId(random), generatedId(random), { startTime: 1.25, endTime: 4.25 }),
      layer,
      project,
      10
    );
    const animatable: Animatable<number> = {
      mode: "keyframes",
      keyframes: [{ time: 0, value: 0 }, { time: 20, value: 20 }]
    };
    const times = { project, layer, effect: currentEffect };

    expect(project.deltaTime).toBeCloseTo(0.15);
    expect(layer.localTime).toBeCloseTo(2.75);
    expect(currentEffect.effectTime).toBeCloseTo(1.5);
    expect(evaluateAnimatableAt(animatable, "project", times)).toBeCloseTo(12.75);
    expect(evaluateAnimatableAt(animatable, "layer", times)).toBeCloseTo(2.75);
    expect(evaluateAnimatableAt(animatable, "effect", times)).toBeCloseTo(1.5);
  });

  it("outputs runtime-ready type IDs while isolating repeatable random streams by instance ID", () => {
    const random = pseudoRandom(0x19d5b4a1);
    const effectTypeId = generatedId(random);
    const firstInstance = effect(generatedId(random), effectTypeId);
    const secondInstance = effect(generatedId(random), effectTypeId);
    const project = resolveProjectTimeSample({ projectTime: 3.4, previousProjectTime: 3.35, fps: 50 });
    const layer = resolveLayerTimeSample(nullLayer(), project);
    const firstTime = resolveEffectTimeSample(firstInstance, layer, project, 10);
    const secondTime = resolveEffectTimeSample(secondInstance, layer, project, 10);
    const streamName = generatedId(pseudoRandom(0x234fa113));
    const sample = (timeSample: typeof firstTime): number[] => {
      const stream = createEffectRandom(0x79ab31cf, timeSample, streamName, 40);
      return [stream.nextUint32(), stream.nextUint32(), stream.nextUint32(), stream.nextUint32()];
    };

    expect(firstInstance.id).not.toBe(secondInstance.id);
    expect(firstTime.effectId).toBe(firstInstance.effectId);
    expect(firstTime.effectInstanceId).toBe(firstInstance.id);
    expect(secondTime.effectId).toBe(secondInstance.effectId);
    expect(secondTime.effectInstanceId).toBe(secondInstance.id);
    expect(sample(firstTime)).toEqual(sample(firstTime));
    expect(sample(secondTime)).toEqual(sample(secondTime));
    expect(sample(firstTime)).not.toEqual(sample(secondTime));

    const firstChunk = generatedId(random);
    const secondChunk = generatedId(random);
    const thirdChunk = generatedId(random);
    const delimiterFirst = resolveEffectTimeSample(
      effect(thirdChunk, `${firstChunk}\u0000${secondChunk}`),
      layer,
      project,
      10
    );
    const delimiterSecond = resolveEffectTimeSample(
      effect(`${secondChunk}\u0000${thirdChunk}`, firstChunk),
      layer,
      project,
      10
    );
    expect(sample(delimiterFirst)).not.toEqual(sample(delimiterSecond));
  });

  it("migrates 1.0 samples only with their matching original EffectInstance", () => {
    const random = pseudoRandom(0xc73a59e1);
    const instance = effect(generatedId(random), generatedId(random));
    const project = resolveProjectTimeSample({ projectTime: 2, previousProjectTime: 1.9, fps: 30 });
    const current = resolveEffectTimeSample(instance, resolveLayerTimeSample(nullLayer(), project), project, 10);
    const legacy = {
      contractVersion: "1.0.0" as const,
      effectId: instance.id,
      active: current.active,
      projectTime: current.projectTime,
      layerTime: current.layerTime,
      effectTime: current.effectTime,
      progress: current.progress,
      deltaTime: current.deltaTime,
      fps: current.fps,
      frame: current.frame
    };

    expect(migrateEffectTimeSampleV1(legacy, instance)).toMatchObject({
      contractVersion: "1.1.0",
      effectId: instance.effectId,
      effectInstanceId: instance.id
    });
    const unrelated = effect(generatedId(random), generatedId(random));
    expect(() => migrateEffectTimeSampleV1(legacy, unrelated)).toThrow(/does not match/);
  });

  it("migrates legacy absolute effect windows without changing their local placement", () => {
    const migrated = migrateLegacyAbsoluteEffectTiming({
      contractVersion: "0.0.0",
      startTime: 103.25,
      endTime: 108.75
    }, 100);
    expect(migrated).toEqual({
      contractVersion: "1.1.0",
      startTime: 3.25,
      endTime: 8.75
    });
  });
});

describe("layer timing and nested time", () => {
  it("applies layer offset, source trim, and half-open out boundaries", () => {
    const layer = nullLayer({ startTime: 2, endTime: 9, inPoint: 1, outPoint: 4 });
    expect(resolveLayerTime(layer, 1.999).active).toBe(false);
    expect(resolveLayerTime(layer, 2)).toMatchObject({ active: true, elapsed: 0, sourceTime: 1 });
    expect(resolveLayerTime(layer, 4.999).active).toBe(true);
    expect(resolveLayerTime(layer, 5)).toMatchObject({ active: false, sourceTime: 4 });
  });

  it("maps precomposition offset, keyframed remap, repeat, and ping-pong", () => {
    const offset = compositionLayer({
      startTime: 1,
      endTime: 6,
      inPoint: 0,
      outPoint: 5,
      properties: { compositionId: "composition.child", timeOffset: 0.5 }
    });
    expect(resolveNestedTime(offset, 2, 5)).toMatchObject({ nestedActive: true, nestedTime: 1.5 });

    const remapped = compositionLayer({
      properties: {
        compositionId: "composition.child",
        timeRemap: { mode: "keyframes", keyframes: [{ time: 0, value: 0 }, { time: 2, value: 4 }] }
      }
    });
    expect(resolveNestedTime(remapped, 1, 5).nestedTime).toBe(2);

    const repeated = compositionLayer({
      properties: { compositionId: "composition.child", timeOffset: 4, timeLoop: "repeat" }
    });
    expect(resolveNestedTime(repeated, 2, 5).nestedTime).toBe(1);
    const pingPong = compositionLayer({
      properties: { compositionId: "composition.child", timeOffset: 5, timeLoop: "ping-pong" }
    });
    expect(resolveNestedTime(pingPong, 2, 5).nestedTime).toBe(3);
  });
});

describe("document easing set", () => {
  const definitions: EasingDefinition[] = [
    { type: "linear" },
    { type: "easeIn" },
    { type: "easeOut" },
    { type: "easeInOut" },
    { type: "cubicBezier", params: [0.42, 0, 0.58, 1] },
    { type: "spring", params: [100, 10, 1, 0] },
    { type: "bounce" },
    { type: "elastic", params: [1, 0.3] },
    { type: "back", params: [1.70158] },
    { type: "steps", params: [4, 0] },
    { type: "customCurve", params: [0, 0, 0.5, 0.25, 1, 1] }
  ];

  it("implements every documented easing with exact endpoints", () => {
    expect(definitions.map((definition) => definition.type)).toEqual([
      "linear", "easeIn", "easeOut", "easeInOut", "cubicBezier", "spring",
      "bounce", "elastic", "back", "steps", "customCurve"
    ]);
    for (const definition of definitions) {
      expect(evaluateEasing(definition, 0), definition.type).toBe(0);
      expect(evaluateEasing(definition, 1), definition.type).toBe(1);
      expect(Number.isFinite(evaluateEasing(definition, 0.5)), definition.type).toBe(true);
    }
  });

  it("uses deterministic documented parameter behavior", () => {
    expect(evaluateEasing({ type: "linear" }, 0.5)).toBe(0.5);
    expect(evaluateEasing({ type: "easeIn" }, 0.5)).toBe(0.125);
    expect(evaluateEasing({ type: "easeOut" }, 0.5)).toBe(0.875);
    expect(evaluateEasing({ type: "easeInOut" }, 0.5)).toBe(0.5);
    expect(evaluateEasing({ type: "steps", params: [4, 0] }, 0.49)).toBe(0.25);
    expect(evaluateEasing({ type: "customCurve", params: [0, 0, 0.5, 0.25, 1, 1] }, 0.5)).toBe(0.25);
  });

  it("uses damping in critical and overdamped spring responses", () => {
    const underdamped = evaluateEasing({ type: "spring", params: [100, 10, 1, 0] }, 0.5);
    const critical = evaluateEasing({ type: "spring", params: [100, 20, 1, 0] }, 0.5);
    const overdamped = evaluateEasing({ type: "spring", params: [100, 40, 1, 0] }, 0.5);
    const heavilyDamped = evaluateEasing({ type: "spring", params: [100, 100, 1, 0] }, 0.5);

    expect(underdamped).not.toBe(critical);
    expect(critical).toBeGreaterThan(overdamped);
    expect(overdamped).toBeGreaterThan(heavilyDamped);
    expect(underdamped).toBeCloseTo(1.0745905665950333, 12);
    expect(critical).toBeCloseTo(0.9595723180054871, 12);
    expect(overdamped).toBeCloseTo(0.7178288260248471, 12);
    expect(heavilyDamped).toBeCloseTo(0.3903346008787516, 12);
    for (const damping of [10, 20, 40, 100]) {
      const definition: EasingDefinition = { type: "spring", params: [100, damping, 1, 0] };
      expect(evaluateEasing(definition, 0)).toBe(0);
      expect(evaluateEasing(definition, 1)).toBe(1);
    }
  });

  it("rejects invalid easing parameters", () => {
    expect(() => evaluateEasing({ type: "cubicBezier", params: [2, 0, 0, 1] }, 0.5)).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.KEYFRAME_INVALID })
    );
    expect(() => evaluateEasing({ type: "elastic", params: [Number.NaN, 0.3] }, 0.5)).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.KEYFRAME_INVALID })
    );
    expect(() => evaluateEasing({ type: "steps", params: [0, 0] }, 0.5)).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.KEYFRAME_INVALID })
    );
  });

  it("validates every parameterized easing before endpoint and clamp returns", () => {
    const valid: EasingDefinition[] = [
      { type: "cubicBezier", params: [0, -1, 1, 2] },
      { type: "spring", params: [100, 0, 1, -1] },
      { type: "elastic", params: [1, 0.3] },
      { type: "back", params: [0] },
      { type: "steps", params: [1, 1] },
      { type: "customCurve", params: [0, 0, 0.5, 0.25, 1, 1] }
    ];
    for (const definition of valid) {
      expect(evaluateEasing(definition, 0), definition.type).toBe(0);
      expect(evaluateEasing(definition, 1), definition.type).toBe(1);
      expect(Number.isFinite(evaluateEasing(definition, 0.5)), definition.type).toBe(true);
    }

    const invalid: EasingDefinition[] = [
      { type: "cubicBezier", params: [0, 0, 1] },
      { type: "cubicBezier", params: [-0.01, 0, 1, 1] },
      { type: "cubicBezier", params: [0, 0, 1.01, 1] },
      { type: "spring", params: [0, 10, 1, 0] },
      { type: "spring", params: [100, -1, 1, 0] },
      { type: "spring", params: [100, 10, 0, 0] },
      { type: "spring", params: [100, 10, 1, Number.NaN] },
      { type: "spring", params: [100, 10, 1, 0, 1] },
      { type: "elastic", params: [0.99, 0.3] },
      { type: "elastic", params: [1, 0] },
      { type: "elastic", params: [1, Number.POSITIVE_INFINITY] },
      { type: "elastic", params: [1, 0.3, 1] },
      { type: "back", params: [Number.NaN] },
      { type: "back", params: [1, 2] },
      { type: "steps", params: [0, 0] },
      { type: "steps", params: [1.5, 0] },
      { type: "steps", params: [2, 2] },
      { type: "steps", params: [2, 0, 1] },
      { type: "customCurve", params: [0, 0] },
      { type: "customCurve", params: [0, 0, 1] },
      { type: "customCurve", params: [0, 0, 0, 1] },
      { type: "customCurve", params: [0, 0, 1.1, 1] },
      { type: "customCurve", params: [0, 0, 1, Number.NaN] }
    ];
    for (const definition of invalid) {
      expect(() => evaluateEasing(definition, 0), JSON.stringify(definition)).toThrowError(
        expect.objectContaining({ code: ERROR_CODES.KEYFRAME_INVALID })
      );
    }

    const representativeInvalid: EasingDefinition[] = [
      { type: "cubicBezier", params: [2, 0, 0, 1] },
      { type: "elastic", params: [1, 0] },
      { type: "steps", params: [0, 0] }
    ];
    for (const definition of representativeInvalid) {
      for (const input of [0, 1, 0.5, -0.25, 1.25]) {
        expect(() => evaluateEasing(definition, input), `${definition.type}:${input}`).toThrowError(
          expect.objectContaining({ code: ERROR_CODES.KEYFRAME_INVALID })
        );
      }
    }
  });
});

describe("keyframe interpolation and baking", () => {
  it("rejects empty and invalid single-keyframe timelines", () => {
    expect(() => evaluateKeyframes([], 0)).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.KEYFRAME_INVALID })
    );
    expect(() => evaluateKeyframes([{ time: -1, value: 0 }], 0)).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.KEYFRAME_INVALID })
    );
  });
  it("handles sorting, boundaries, duplicates, linear, easing, and hold", () => {
    expect(evaluateKeyframes([{ time: 1, value: 10 }, { time: 0, value: 0 }], -1)).toBe(0);
    expect(evaluateKeyframes([{ time: 1, value: 10 }, { time: 0, value: 0 }], 0.5)).toBe(5);
    expect(evaluateKeyframes([{ time: 0, value: 0, easing: { type: "easeIn" } }, { time: 1, value: 8 }], 0.5)).toBe(1);
    expect(evaluateKeyframes([{ time: 0, value: 1, interpolation: "hold" }, { time: 1, value: 9 }], 0.9)).toBe(1);
    expect(evaluateKeyframes([{ time: 0, value: 1 }, { time: 0, value: 2 }, { time: 1, value: 4 }], 0)).toBe(2);
    expect(evaluateKeyframes([{ time: 0, value: 0 }, { time: 1, value: 10 }], 2)).toBe(10);
  });

  it("interpolates Vector2, Vector3, spline, and tangent bezier values", () => {
    expect(evaluateKeyframes([{ time: 0, value: { x: 0, y: 2 } }, { time: 1, value: { x: 10, y: 4 } }], 0.5)).toEqual({ x: 5, y: 3 });
    expect(evaluateKeyframes([{ time: 0, value: { x: 0, y: 0, z: 0 } }, { time: 1, value: { x: 2, y: 4, z: 6 } }], 0.5)).toEqual({ x: 1, y: 2, z: 3 });
    expect(evaluateKeyframes([{ time: 0, value: 0, interpolation: "spline" }, { time: 1, value: 10 }], 0.5)).toBe(5);
    expect(evaluateKeyframes([
      { time: 0, value: 0, interpolation: "bezier", outTangent: [20] },
      { time: 1, value: 10, inTangent: [0] }
    ], 0.5)).toBe(7.5);
  });

  it("resolves expression and binding branches explicitly", () => {
    expect(evaluateAnimatable(
      { mode: "expression", expression: { language: "cmfx-expression", source: "time" } },
      2,
      { expression: (_definition, time) => time * 2 }
    )).toBe(4);
    expect(evaluateAnimatable(
      { mode: "binding", source: { source: "variable", path: "value" } },
      2,
      { binding: () => 7 }
    )).toBe(7);
    expect(() => evaluateAnimatable(
      { mode: "expression", expression: { language: "cmfx-expression", source: "time" } },
      0
    )).toThrowError(expect.objectContaining({ code: ERROR_CODES.KEYFRAME_INVALID }));
  });

  it("bakes inclusive fixed-frame samples deterministically", () => {
    const animatable: Animatable<number> = {
      mode: "keyframes",
      keyframes: [{ time: 0, value: 0 }, { time: 1, value: 10 }]
    };
    const first = bakeKeyframes(animatable, { startFrame: 0, endFrame: 2, fps: 2 });
    const second = bakeKeyframes(animatable, { startFrame: 0, endFrame: 2, fps: 2 });
    expect(first).toEqual([
      { time: 0, value: 0, interpolation: "linear" },
      { time: 0.5, value: 5, interpolation: "linear" },
      { time: 1, value: 10, interpolation: "linear" }
    ]);
    expect(second).toEqual(first);
    expect(bakeAnimatable(animatable, { startFrame: 0, endFrame: 2, fps: 2 })).toEqual({
      mode: "keyframes",
      keyframes: first
    });
  });
});
