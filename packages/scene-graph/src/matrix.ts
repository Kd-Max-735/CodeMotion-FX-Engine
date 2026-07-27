import { type TransformDefinition, type Vector2, type Vector3 } from "@codemotion/core";
import { evaluateAnimatable } from "@codemotion/timeline";

export type Matrix4 = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number
];

export interface EvaluatedTransform {
  readonly anchorPoint: Vector3;
  readonly position: Vector3;
  readonly scale: Vector3;
  readonly rotation: Vector3;
  readonly skew: Vector2;
  readonly matrix: Matrix4;
}

export const IDENTITY_MATRIX: Matrix4 = Object.freeze([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1
]);

export function multiplyMatrices(left: Matrix4, right: Matrix4): Matrix4 {
  const output = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let index = 0; index < 4; index += 1) {
        value += (left[index * 4 + row] ?? 0) * (right[column * 4 + index] ?? 0);
      }
      output[column * 4 + row] = value;
    }
  }
  return output as unknown as Matrix4;
}

function translation(x: number, y: number, z: number): Matrix4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

function scaling(x: number, y: number, z: number): Matrix4 {
  return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
}

function rotationX(radians: number): Matrix4 {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [1, 0, 0, 0, 0, cosine, sine, 0, 0, -sine, cosine, 0, 0, 0, 0, 1];
}

function rotationY(radians: number): Matrix4 {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [cosine, 0, -sine, 0, 0, 1, 0, 0, sine, 0, cosine, 0, 0, 0, 0, 1];
}

function rotationZ(radians: number): Matrix4 {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [cosine, sine, 0, 0, -sine, cosine, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function skewing(xDegrees: number, yDegrees: number): Matrix4 {
  const x = Math.tan((xDegrees * Math.PI) / 180);
  const y = Math.tan((yDegrees * Math.PI) / 180);
  return [1, y, 0, 0, x, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function ensureFiniteVector(vector: Vector2 | Vector3, label: string): void {
  if (!Object.values(vector).every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new RangeError(`${label} must contain finite numbers.`);
  }
}

export function evaluateTransform(transform: TransformDefinition, time: number): EvaluatedTransform {
  const anchorPoint = evaluateAnimatable(transform.anchorPoint, time);
  const position = evaluateAnimatable(transform.position, time);
  const scale = evaluateAnimatable(transform.scale, time);
  const rotation = evaluateAnimatable(transform.rotation, time);
  const skew = transform.skew === undefined
    ? { x: 0, y: 0 }
    : evaluateAnimatable(transform.skew, time);
  ensureFiniteVector(anchorPoint, "anchorPoint");
  ensureFiniteVector(position, "position");
  ensureFiniteVector(scale, "scale");
  ensureFiniteVector(rotation, "rotation");
  ensureFiniteVector(skew, "skew");

  const radians = {
    x: (rotation.x * Math.PI) / 180,
    y: (rotation.y * Math.PI) / 180,
    z: (rotation.z * Math.PI) / 180
  };
  let matrix = translation(position.x, position.y, position.z);
  matrix = multiplyMatrices(matrix, rotationZ(radians.z));
  matrix = multiplyMatrices(matrix, rotationY(radians.y));
  matrix = multiplyMatrices(matrix, rotationX(radians.x));
  matrix = multiplyMatrices(matrix, skewing(skew.x, skew.y));
  matrix = multiplyMatrices(matrix, scaling(scale.x / 100, scale.y / 100, scale.z / 100));
  matrix = multiplyMatrices(matrix, translation(-anchorPoint.x, -anchorPoint.y, -anchorPoint.z));
  return { anchorPoint, position, scale, rotation, skew, matrix };
}

export function transformPoint(matrix: Matrix4, point: Vector3): Vector3 {
  return {
    x: (matrix[0] * point.x) + (matrix[4] * point.y) + (matrix[8] * point.z) + matrix[12],
    y: (matrix[1] * point.x) + (matrix[5] * point.y) + (matrix[9] * point.z) + matrix[13],
    z: (matrix[2] * point.x) + (matrix[6] * point.y) + (matrix[10] * point.z) + matrix[14]
  };
}
