# Planner Shadow Gate 3 — Production Verification

**Date:** 2026-07-18  
**Branch:** `refactor/v0.1.143-on-demand-planner`  
**Verified commits:**

- `f802be8` — `fix: expose planner coordinator failure stages`
- `bd58688` — `fix: resolve planner paths via adapter-core, not adapter method`

Version remained **0.1.143**. No worker authority activation and no canonical publish were enabled.

## Configuration under test

- `planner_runtime_mode` = `shadow_auto`
- `planner_authoritative_source` = `worker_dryrun`
- `global.execution_mode` = `dryrun`

## Results

### Manual force run

| Field | Value |
|-------|-------|
| `last_result` | `success` |
| `comparison_status` | `matched` |
| mismatch count | `0` |
| duration | ~630 ms |

### Automatic schedule run

| Field | Value |
|-------|-------|
| `last_result` | `success` |
| `comparison_status` | `matched` |
| mismatch count | `0` |
| duration | ~713 ms |

Worker and in-process reference plans matched completely (same candidate/reference revisions, zero mismatches).

## Memory

| Metric | Value |
|--------|-------|
| RSS before worker job | 156.8 MiB |
| RSS after worker exit | 156.8 MiB |
| Worker delta | 0 MiB |

## Authority / safety gates (unchanged)

| State | Value |
|-------|-------|
| `worker_authoritative` | `false` |
| `canonical_allowed` | `false` |
| `lease_active` | `false` |
| `fallback_latched` | `false` |

No productive control takeover occurred.

## Known limitation

The planner exposes a large technical state surface for diagnostics and dual-run observation. Cleanup and operator-facing simplification are deferred to **Phase 4**.
