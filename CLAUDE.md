# CLAUDE.md — omnitender-web

## Working agreement
- Fast, direct execution; token-efficient. Scope searches narrowly (ask before repo-wide scans).
- This repo ships `.githooks/` (secret-scan + multi-instance guard). Run agent-corps `install.sh` once so a Claude SessionStart hook auto-enables them (`git config core.hooksPath .githooks`).

<!-- BEGIN git-guards protocol (agent-corps) — paste/keep this block in a repo's CLAUDE.md -->
## Multi-instance git protocol (several AI sessions may work this repo at once)

The user runs parallel AI instances; assume you are **not alone in this clone**. Enforced by
committed `.githooks/` (auto-enabled per clone by the Claude `SessionStart` hook that agent-corps
`install.sh` installs) — `pre-commit` blocks secrets, `pre-push` gates the deploy branch.

1. **Work on a branch, not the deploy/default branch.** `git switch -c work/<topic>`. For true
   parallel work in one clone, use a **git worktree** (`git worktree add ../<repo>-<topic> work/<topic>`)
   so instances never share a dirty tree — this makes the collision impossible.
2. **Stage only files YOU changed this session.** Never `git add -A` / `git add .` / `git commit -a`
   — the tree may hold another instance's WIP. Verify the branch in the SAME command as the commit.
   Unexplained dirty/untracked files: leave them alone and tell the user.
3. **A push to the deploy branch = a deploy.** Do it deliberately:
   `git pull --rebase origin <deploy-branch>`, then `ALLOW_DEPLOY_PUSH=1 git push`. The pre-push hook
   blocks anything else and refuses if the remote moved. (Only repos with a `.githooks/deploy-branch`
   file auto-deploy; elsewhere the gate is a no-op.)
4. **Never bypass the hooks** (`--no-verify`) unless the user explicitly asks.
5. **Recovery if a sibling wipes your uncommitted work:** staged blobs + orphaned commits survive in
   `.git/objects`. `git fsck --unreachable --no-reflogs`, identify by `git cat-file -p <sha>`, and
   check unreachable commits' trees (`git ls-tree -r <sha>`) for a full snapshot to `git show` back.
<!-- END git-guards protocol -->
