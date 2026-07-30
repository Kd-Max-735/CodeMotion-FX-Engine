import type { RenderQuality } from "@codemotion/core";
import type {
  TextExtrude3DParams,
  TextExtrude3DRasterInput,
  TextExtrusionGeometry
} from "./types.js";

function occupied(source: TextExtrude3DRasterInput["surface"], x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= source.width || y >= source.height) return false;
  return source.data[(y * source.width + x) * 4 + 3]! > 0;
}

export function createTextExtrusionGeometry(
  input: TextExtrude3DRasterInput,
  params: Pick<TextExtrude3DParams, "depth" | "bevel">,
  quality: RenderQuality
): TextExtrusionGeometry {
  const source = input.surface;
  const stride = quality === "draft" ? 3 : quality === "preview" ? 2 : 1;
  const boundary: number[] = [];
  const vertices: number[] = [];
  const indices: number[] = [];
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
      const x0 = x / source.width * 2 - 1;
      const x1 = Math.min(source.width, x + stride) / source.width * 2 - 1;
      const y0 = 1 - y / source.height * 2;
      const y1 = 1 - Math.min(source.height, y + stride) / source.height * 2;
      const z0 = 0;
      const z1 = Math.max(0, Math.min(1, params.depth));
      const addQuad = (
        points: readonly [number, number, number][],
        normal: readonly [number, number, number]
      ) => {
        const base = vertices.length / 6;
        for (const point of points) vertices.push(...point, ...normal);
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      };
      addQuad([[x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [x1, y0, z1]], [0, 0, 1]);
      addQuad([[x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z0]], [0, 0, -1]);
      if (edges[0]) addQuad([[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], [-1, 0, 0]);
      if (edges[1]) addQuad([[x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [x1, y0, z0]], [1, 0, 0]);
      if (edges[2]) addQuad([[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]], [0, 1, 0]);
      if (edges[3]) addQuad([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [0, -1, 0]);
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
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    boundary: new Int32Array(boundary),
    bounds
  });
}
