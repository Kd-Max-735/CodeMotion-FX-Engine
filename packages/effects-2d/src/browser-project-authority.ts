import { createBrowserProjectAuthorityV1 } from "@codemotion/schema/internal/browser-project-authority";
import type { BrowserProjectAuthorityV1 } from "@codemotion/schema";
import { evaluateAnimatable } from "@codemotion/timeline";
import { P0_EFFECTS_BY_ID } from "./catalog.js";

export const P0_BROWSER_PROJECT_AUTHORITY_V1: BrowserProjectAuthorityV1 = createBrowserProjectAuthorityV1(
  P0_EFFECTS_BY_ID,
  evaluateAnimatable
);
