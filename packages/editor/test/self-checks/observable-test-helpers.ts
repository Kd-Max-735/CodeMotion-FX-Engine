import type { ObservableFrameObservation } from "../../src/self-checks/observable-self-check.js";
import { expect } from "vitest";

export function observation(frame: number, overrides: Partial<ObservableFrameObservation> = {}): ObservableFrameObservation {
  return Object.freeze({
    frame,
    time: frame / 10,
    activity: 10,
    coverage: 0.3,
    spread: 0.2,
    speed: 0.2,
    directionX: 0.15,
    directionY: -0.05,
    coherence: 0.6,
    angularMotion: 0,
    finite: true,
    ...overrides
  });
}

export function publicSummaryJson(value: unknown): string {
  return JSON.stringify(value);
}

export function expectNoInternalParticleData(json: string): void {
  expect(json).not.toMatch(/positions|velocities|particles|fragments|seed|stepCount|backend|algorithm/u);
}
