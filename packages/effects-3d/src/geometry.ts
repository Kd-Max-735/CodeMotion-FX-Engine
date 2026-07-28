import type { RenderQuality } from "@codemotion/core";
import type {
  PixelSurface,
  TextExtrude3DParams,
  TextExtrusionGeometry
} from "./types.js";

function occupied(source: PixelSurface, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= source.width || y >= source.height) return false;
  return source.data[(y * source.width + x) * 4 + 3]! > 0;
}

export function createTextExtrusionGeometry(
  source: PixelSurface,
  params: Pick<TextExtrude3DParams, "depth" | "bevel">,
  quality: RenderQuality
): TextExtrusionGeometry {
  const stride = quality === "draft" ? 3 : quality === "preview" ? 2 : 1;
  const boundary: number[] = [];
  let occupiedCells = 0;
  let exposedEdges = 0;
  let minX = source.width;
  let minY = source.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < source.height; y += stride) {
    for (let x = 0; x < source.width; x += stride) {
      if (!occupied(source, x, y)) continue;
      occupiedCells += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + stride);
      maxY = Math.max(maxY, y + stride);
      const edges = [
        !occupied(source, x - stride, y),
        !occupied(source, x + stride, y),
        !occupied(source, x, y - stride),
        !occupied(source, x, y + stride)
      ];
      const edgeCount = edges.filter(Boolean).length;
      if (edgeCount > 0) {
        boundary.push(x, y, edges[0] ? 1 : 0, edges[1] ? 1 : 0, edges[2] ? 1 : 0, edges[3] ? 1 : 0);
        exposedEdges += edgeCount;
      }
    }
  }
  const depth = Math.max(0, Math.min(1, params.depth));
  const bevel = Math.max(0, Math.min(0.25, params.bevel));
  const bounds = occupiedCells === 0
    ? [0, 0, 0, 0, 0, depth] as const
    : [minX, minY, 0, maxX, maxY, depth] as const;
  return Object.freeze({
    width: source.width,
    height: source.height,
    depth,
    bevel,
    occupiedCells,
    frontTriangles: occupiedCells * 4,
    sideTriangles: exposedEdges * 2,
    boundary: new Int32Array(boundary),
    bounds
  });
}
