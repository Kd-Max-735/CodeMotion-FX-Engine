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
