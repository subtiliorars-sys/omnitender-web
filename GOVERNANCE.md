# GOVERNANCE — omnitender-web

**Tier A — Universal.** Rendered by `install-governance.sh` from
`agent-corps/templates/GOVERNANCE.md.tmpl` on 2026-06-11.

This repo is governed under the **Corps Constitution**
(`agent-corps/CORPS_CONSTITUTION.md`). That file defines WHAT each invariant and
tier mean; this file records WHICH invariants bind THIS repo and the dated state
of each. Higher tiers add to lower; every repo is at least Tier A.

> A rule with no mechanism is just a wish (Constitution §0.3). Every box below
> names its mechanism class — **hook** (git/CI), **gate** (runtime refusal/
> approval), **test** (regression guard), **middleware** (per-request), or
> **receipt** (tamper-evident audit). Prose-only compliance is non-compliance.

## Binding invariant checklist (Tier A)

Check a box only when its named mechanism is PRESENT and PASSING in this repo —
not when you intend to add it.

### Tier A — Universal (binds every repo)
- [ ] **S-4 Verify before done** — risky work (auth/data/irreversible/money/security) gets a recorded RED-TEAM pass before merge. _(test + receipt; PR-checklist line)_
- [ ] **S-6 Post-incident amends** — a shipped defect's fix lands with a regression test that would have caught it; lesson recorded. _(test)_
- [ ] **S-8 Branch per task; stage only your own** — no `git add -A`/`-a`; parallel work uses worktrees. _(hook: advisory pre-commit add-all detector + doctrine)_
- [ ] **T-4 No endorsement entanglement** — brands stay separate; no implied AA/program affiliation on public surfaces. _(hook: brand-string CI lint + PR checklist)_
- [ ] **T-5 Principles before personalities** — access is role/permission-based; honorary labels carry zero permissions. _(test)_
- [ ] **M-1 Fail-closed auth** — privileged endpoints deny by default; missing/invalid creds => 401/403; root-singleton reads use the strict verifier. _(gate + test; A-tier: if any auth)_
- [ ] **M-2 No secrets in code** — creds in env/config only; pre-commit secret-scan hook blocks token/key patterns; leaks are revoked. _(hook)_
- [ ] **M-3 Protected default branch** — direct pushes to the deploy/default branch blocked unless explicitly overridden; deploy-pushes treated as deploys. _(hook)_
- [ ] **M-9 Confirm before deploy** — no automated deploy without a human approval or CI test gate in front; deploys observable (healthcheck + smoke). _(hook + gate)_

## Verification standard (Constitution §5)

This repo is **governed** only when ALL of:

- [ ] `GOVERNANCE.md` present with tier assignment + a dated audit (this file).
- [ ] git-guards active — `git config core.hooksPath` returns `.githooks`.
- [ ] Every invariant this tier binds has its named mechanism present and passing
      (hook / gate / test / middleware / receipt) — not prose.
- [ ] Red-team GO recorded for every D-tier surface touched.
- [ ] The Owner merged the governance PR.

Re-audit on the Phase 5 cadence (quarterly) and on ANY change to an
auth / exec / data / money surface (Constitution §5).

## Dated audit log

Append a dated entry each audit. Keep the lab-bench standard: a fresh agent should
be able to read the latest entry and know exactly what is and isn't satisfied.

### 2026-06-11 — initial scaffold (carrier install)
- State: **UNAUDITED.** Checklist rendered for Tier A; no invariant verified yet.
- Next: run the per-repo rollout loop (audit vs checklist → gap list with severity →
  mechanical fixes → red-team the risky ones → Owner merges → record state here).
- Auditor: _(unfilled)_  ·  Red-team verdict: _(n/a — not yet audited)_

## Amendments

Only the Owner ratifies/amends/repeals invariants (Constitution §6). Agents may
PROPOSE amendments via PR against `CORPS_CONSTITUTION.md`; nothing is in force
until the Owner merges it. Decisions reserved to the Owner (six-gate parameters,
erasure-vs-backup semantics, §6 itself) are never guessed — the affected surface
stays closed until ruled.
