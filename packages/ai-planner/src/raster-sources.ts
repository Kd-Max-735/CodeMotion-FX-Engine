import { createHash } from "node:crypto";
import type { CoverageBuffer } from "@codemotion/renderer-api";

function hashNumber(value: string): number {
  return Number.parseInt(createHash("sha256").update(value).digest("hex").slice(0, 8), 16) >>> 0;
}

export function coverageAsset(identity: string, size = 17): CoverageBuffer {
  const data = new Uint8Array(size * size);
  const eccentricity = 0.75 + (hashNumber(identity) % 20) / 100;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = ((x + 0.5) / size - 0.5) / eccentricity;
      const dy = (y + 0.5) / size - 0.5;
      data[y * size + x] = Math.round(Math.max(0, Math.min(1, (0.5 - Math.hypot(dx, dy)) * size * 0.45)) * 255);
    }
  }
  return Object.freeze({ width: size, height: size, data, rowOrder: "top-to-bottom" as const });
}
