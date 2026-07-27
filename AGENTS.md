# Repository Rules

- Use this directory as the only working directory. Do not create additional worktrees.
- The sole integration branch is `integration`.
- This is a from-zero project. Never read from, copy from, restore from, fetch from, check out from, or merge from `D:\CodeMotion FX Engine` or any old project commit.
- Only the group named by the current row in `27_GOVERNANCE.md` may write, and only while that row is `OPEN`.
- Work is strictly serial: the development group reports PASS, Group 7 verifies, Group 8 re-verifies and commits, then the user sends the next segment.
- Do not reset, checkout, clean, overwrite, move, or delete `doubao_glm_api_package`.
- Keep the whole `doubao_glm_api_package/` directory ignored and untracked. Never force-add any part of it.
- Never delete files or directories in batches. Delete at most one explicitly named file per operation after authorization.
- Before and after every integration commit, inspect `git status` and the complete staged diff. Do not include another stage's changes.
- Public Schema/API changes are owned by Group 1 and require its approval before development starts.
- A stage gate cannot pass while any required owner, scope, evidence, or security item is `BLOCKED`.
- Do not pull, merge, push, force-push, or rewrite the remote during S0. If `origin` becomes non-empty or history differs, stop and report BLOCKED.

The authoritative governance order is Chapter 27 in `27_GOVERNANCE.md`.
