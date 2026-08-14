# Repository Rules

- Use this directory as the only working directory. Do not create additional worktrees.
- The sole integration branch is `integration`.
- This is a from-zero project. Never read from, copy from, restore from, fetch from, check out from, or merge from `D:\CodeMotion FX Engine` or any old project commit.
- A stage receives the sole write permission when the required prior PASS exists and the user sends that current-stage prompt from the total execution table to the corresponding group window. No separate Group 8 `OPEN` edit is required.
- Work is strictly serial: the development group reports PASS, Group 7 verifies, Group 8 re-verifies and commits, then the user sends the next segment.
- The user removed `doubao_glm_api_package/` before Stage 6. Keep it absent: never restore, rebuild, copy, or reference it from an old directory, old commit, or backup. Its ignore rule remains as a guard against accidental recreation and tracking.
- V1 has one model Provider: the server-side Volcengine Ark model `doubao-seed-2-0-lite-260428`. Do not add another model Provider or a client-side model integration.
- Never delete files or directories in batches. Delete at most one explicitly named file per operation after authorization.
- Before and after every integration commit, inspect `git status` and the complete staged diff. Do not include another stage's changes.
- Public Schema/API changes are owned by Group 1 and require its approval before development starts.
- A stage gate cannot pass while any required owner, scope, evidence, or security item is `BLOCKED`.
- During this S0 closeout only Group 8 may write. After `[G8-S0 PASS]`, the next authorization is the user's `1-S1` prompt; Group 8 does not run a separate gate-opening step.
- Until `origin` is successfully reverified, do not pull, merge, push, force-push, or rewrite remote history. A network reset does not invalidate the recorded empty-remote evidence or block `1-S1`; a successful check showing unexpected history is BLOCKED before any remote integration.

The authoritative governance order is Chapter 27 in `27_GOVERNANCE.md`.

## Current server single-tool architecture

- The user's 2026-08-14 direction supersedes the V2.2 card/model-selection workflow and every conflicting AI retrieval, ranking, composition, browser-rendering, and editor workflow. The authority is `docs/api/current-server-single-tool-architecture.md`.
- The user manually selects exactly one snake_case tool. The sole Ark model reads only that selected tool's Chinese Markdown and returns exactly `{ "type": "selected_tool", "data": { ...effectParams } }`.
- Model parameters and server-authorized inputs/resources are separate contracts. Resource IDs, paths, URLs, images, video, audio, masks, LUTs, depth maps, fonts, models, and textures never enter the model parameter Schema.
- Preview, rendering, and export are server-only. Preserve authentication, exact Origin, CSRF, tenant isolation, media safety, audit, preview, and export safety chains.
- Do not develop ReAct, Agent, multi-tool calls, multi-effect composition, or a front-end editing page before all 120 real effect functions are complete.
- This refactor may use parallel coding only under the disjoint `effect-functions` batch and field-spec directory ownership recorded in the current architecture. Shared contracts, registry, governance, staging, and Git commits remain serial.
- Add versioned paths and adapters; do not batch-delete historical code. The public registry must not import a batch until its implementation exists and passes its contract tests.
- Never restore, reconstruct, or reference `D:\CodeMotion FX Engine`, an old commit, a backup, or `doubao_glm_api_package/`.

## Historical V2.2 sample-card refactor

- The user's 2026-08-05 refactor prompt authorized the initial controlled eight-effect sample-card refactor. The user's 2026-08-13 direction extended the original card workflow to all 40 registered P0 effects. This workflow is historical and is superseded where it conflicts with the current server single-tool architecture.
- Historical group PASS records remain evidence, but Group 7/Group 8 handoffs do not apply to this refactor. No separate stage-opening prompt is required.
- Preserve all 40 registered P0 effects and the existing authentication, tenant isolation, media safety, preview, and export chains.
- The user's 2026-08-13 Git instruction supersedes the earlier no-commit rule: create a local commit after each tested logical iteration so every change has a rollback point. A commit does not mean human visual acceptance or publication. Inspect status and the complete staged diff before every commit, report the commit hash afterward, and do not push without explicit authorization.

## Current local development authentication

- The user's 2026-08-05 authorization replaces the former one-time-code development login only for Vite `configureServer` on literal `127.0.0.1:4174`.
- `npm run dev` must require no authentication environment setup and must use `strictPort: true`.
- The browser may request only an empty local auto-session; tenant, user, scopes, Cookie attributes, and redirects remain server-owned.
- Production OIDC, server sessions, exact Origin checks, CSRF, tenant isolation, and all API authorization checks remain unchanged.
