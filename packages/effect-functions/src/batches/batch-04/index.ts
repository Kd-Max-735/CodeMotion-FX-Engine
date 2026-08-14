import type { EffectToolDefinition } from "../../types.js";
import { BOIDS_DEFINITION } from "./boids.js";
import { CLOTH_DEFINITION } from "./cloth.js";
import { COLLISION_SHATTER_DEFINITION } from "./collision-shatter.js";
import { FLOW_FIELD_DEFINITION } from "./flow-field.js";
import { FLUID_LITE_DEFINITION } from "./fluid-lite.js";
import { ORBIT_FIELD_DEFINITION } from "./orbit-field.js";
import { RIGID_BODY_2D_DEFINITION } from "./rigid-body-2d.js";
import { ROPE_DEFINITION } from "./rope.js";
import { SOFT_BODY_DEFINITION } from "./soft-body.js";
import { SPRING_DEFINITION } from "./spring.js";

export {
  BOIDS_DEFINITION,
  CLOTH_DEFINITION,
  COLLISION_SHATTER_DEFINITION,
  FLOW_FIELD_DEFINITION,
  FLUID_LITE_DEFINITION,
  ORBIT_FIELD_DEFINITION,
  RIGID_BODY_2D_DEFINITION,
  ROPE_DEFINITION,
  SOFT_BODY_DEFINITION,
  SPRING_DEFINITION
};

export const BATCH_04_DEFINITIONS: readonly EffectToolDefinition[] = Object.freeze([
  ORBIT_FIELD_DEFINITION,
  FLOW_FIELD_DEFINITION,
  SPRING_DEFINITION,
  RIGID_BODY_2D_DEFINITION,
  SOFT_BODY_DEFINITION,
  CLOTH_DEFINITION,
  ROPE_DEFINITION,
  FLUID_LITE_DEFINITION,
  BOIDS_DEFINITION,
  COLLISION_SHATTER_DEFINITION
]);
