# Phase 4A — State Surface Migration Plan

**Status:** 4B1 shipped; 0.1.150 lean purge of Shadow/operator mirrors while planner forced off.
**Baseline:** production surface cleanup line 0.1.150.

## Goals

1. Normal operators see a compact planner surface (≤ ~30 planner states).
2. Large plan JSON lives in durable/runtime files, not permanent states.
3. Device trees exist only for configured/enabled devices.
4. Pilot/diagnostic vocabulary stays out of normal Admin UI.
5. Preserve backup/restore, dryrun safety, and VIS compatibility until explicitly migrated.

## Path conventions (already established)

| Kind | Root |
|------|------|
| Durable | `ems.<instance>/planner/` (canonical plans, learning under `ems.<instance>/learning/`) |
| Runtime / shadow / jobs | `ems-runtime.<instance>/planner/` |

## Phase sequence

### 4B — Stop over-creation + controlled placeholder cleanup (4B1)

- Ensure AC unit/mapping states only when unit **configured** (enabled OR mapping target).
- Ensure vehicle profile states only for configured `wb_vehicle_profiles`.
- Controlled allowlist cleanup for never-configured AC slots and orphan vehicle folders.
- Expert-mark planner coordinator/authority/takeover/authorization (`common.expert`).
- Admin planner gates: jsonConfig `expert: true` (fields retained).
- **Expected reduction:** hundreds of unused leaves on typical installs (measured in tests).
- Still **no** large JSON relocation; compatibility states retained.
### 4C — Admin + visibility gating

- Collapse Global planner selects to Off / Automatic for normal UI.
- Move evaluation/authorization/authoritative_source behind `expertMode` or Support tab.
- Set `common.expert: true` on `planner.coordinator.*`, `planner.takeover.*`, `planner.authority.*` (new objects / extend carefully — do not break existing without migration note).
- Raise Admin dependency if relying on `expertMode`.

### 4D — Diagnostic mode

- Explicit config/state: diagnostic mode off by default.
- When off: do not refresh C-class detail states (or write stubs only).
- When on: full comparison/revision/RSS detail for support.
- Still **no** automatic object deletion in this step.

### 4E — JSON → files (after wipe / reader audit)

Deferred until after Export-Register + Fresh-Install checklist.
Until then: keep Compatibility JSON states; Export is source-of-truth for Learning/Stats (`consumer_stats` included from 0.1.144).

Order:

1. `learning.persistence.*_json` (files already SoT)
2. `forecast_plan.*_json` → `ems-runtime.<n>/planner/forecast/`
3. `daily_plan.*_json` mirrors (canonical files already)
4. `contributions.*_json`
5. `allocation.<addon>.plan_json` **after** addon readers accept file/path API (**F**)

Each move requires:

- Runtime reader checklist
- Backup/export checklist
- External script / VIS risk check
- Compact replacement states (status, revision, generated_at, error)

### 4F — Compatibility retirement

- Inventory VIS and scripts against `planner.intent.*`.
- Provide aliases or dual-write window.
- Only then mark E-obsolete and schedule object cleanup with user-facing release notes.

### 4G — Object cleanup (future)

- Remove obsolete objects only with versioned migration + optional quarantine under runtime.
- Never delete in-place without backup fence.

## Risk register

| Risk | Mitigation |
|------|------------|
| Addon breaks without `allocation.*.plan_json` | File API + dual-write window; tests first |
| VIS breaks on intent ID rename | Treat as F until VIS updated; prefer add compact IDs first |
| Backup misses file-only plans | Extend export to include `ems.<n>/planner/` (already path-aware) |
| Users activate worker_dryrun by accident | Expert-gate authoritative_source; keep defaults legacy/off |
| Hidden states confuse support | Diagnostic mode + docs; keep IDs stable for support |

## Success metrics

| Metric | Today | Target |
|--------|------:|-------|
| Live state count (typical) | ~1534 | ≪ 800 mid-term; planner ≤30 core |
| Permanent large JSON plan states | many | 0 |
| Disabled AC unit full trees | yes | no |
| Empty vehicle trees | possible | no |
| Normal Admin shows shadow/takeover jargon | yes | no |

## Explicit non-goals (still)

- Enabling worker authority / canonical publish
- Changing execution_mode or startup-rearm semantics
- Modifying `vis/` in cleanup commits without a dedicated VIS phase
