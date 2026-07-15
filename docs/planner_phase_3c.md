# EMS-Light Phase 3C — On-Demand Planner Coordinator Foundation

## 1. Purpose

`PlannerOnDemandCoordinator` orchestrates on-demand planner worker runs from the main process:

```text
explicit request → snapshot build → job input → worker → prepared output validation → compact status
```

Shadow/foundation only — the in-process planner in `src/planner/index.ts` remains unchanged.

## 2. State model

States: `disabled`, `idle`, `building_snapshot`, `starting_worker`, `worker_running`, `validating_output`, `succeeded`, `failed`, `stopping`, `stopped`.

`getStatus()` returns a detached copy with compact metadata only.

## 3. Disabled by default

Constructed with `enabled: false`. Adapter startup registers the coordinator but does not request jobs.

Disabled construction loads only the lightweight compose shell (`compose.ts`, `coordinator.ts`, trigger/status/types). Heavy runtime modules (`runtime_factory.ts`, snapshot builder, operator, worker job pipeline) are loaded lazily on the first actual coordinator run via dynamic `import()`.

Allowed at startup: small contract modules such as `planner_preparation/types.js`.

## 4. Trigger contract

`PlannerTriggerRequest`: `reason`, `requestedAt`, optional `correlationId`, optional `force`.

Reasons: `manual`, `relevant_change`, `scheduled`, `ai_request`, `startup_recovery`, `test`.

Trigger reasons are used for diagnostics, coalescing priority, and status display only.

No production trigger wiring in Phase 3C.

## 5. Force rule

Worker reruns on identical successful `inputRevision` happen **only** when:

```ts
request.force === true
```

Trigger reason alone never bypasses unchanged-input deduplication.

Examples:

* `manual` + same revision + `force: false` → `unchanged_input`
* `scheduled` + same revision + `force: true` → worker runs

## 6. Single-flight

At most one active worker job. Parallel requests coalesce to one pending follow-up run.

## 7. Coalescing

Pending trigger merged by priority (`manual`/`ai_request` highest). Only one compact pending slot — no queue growth.

Force coalescing rule:

```ts
pendingForce = pendingForce || incoming.force === true
```

A later non-forced request must not clear a pending `force: true`.

## 8. Unchanged-input deduplication

After a successful run, identical `inputRevision` skips the worker unless:

* previous run failed
* `force === true`

Skip result: `lastResult = skipped`, `lastSkipReason = unchanged_input`, state returns to `idle`, `lastInputRevision` remains the last successful revision.

## 9. Worker validation

Exit code 0 alone is insufficient. Coordinator validates result contract, jobId, generation, and `prepared_input_v1.json`.

Jobs use `mode: "simulation"` — canonical durable plans are not published.

## 10. Simulation publish behaviour

`PlannerJobLifecycle` publishes canonical plans only when:

```text
exitCode === 0 && !timedOut && mode !== "simulation"
```

Existing `mode: "publish"` paths are unchanged.

## 11. Shutdown

`stop()` is idempotent: rejects new work, clears pending rerun, shuts down active worker, sets `stopped`.

Adapter unload awaits coordinator shutdown:

```text
main.onUnload → await stopEmsLightPhase1() → await stopPlannerOnDemandCoordinator()
```

No fire-and-forget stop in the real unload path.

## 12. Error codes

Examples: `planner_disabled`, `coordinator_stopping`, `worker_timeout`, `worker_exit_nonzero`, `result_missing`, `result_generation_mismatch`, `result_input_revision_mismatch`, `prepared_output_missing`, `prepared_output_invalid`, `prepared_output_budget_exceeded`.

## 13. Retention and cleanup

Uses existing planner job lifecycle and repository cleanup. Failed job retention rules from Phase 2 preserved.

## 14. Memory discipline

Coordinator retains only compact metadata — no full snapshot, prepared output, or price arrays in status.

## 15. Runtime composition

Minimal wiring in `src/ems_light/index.ts`:

* import from `planner_coordinator/compose` (not heavy runtime factory)
* register coordinator after `runPlannerRuntime` with `{ enabled: false }`
* await stop in `stopEmsLightPhase1()`

No automatic triggers, timers, or subscriptions. No large ioBroker JSON state writes.

## 16. Not yet activated

* production trigger sources
* replacing in-process planner
* publishing worker stub plans to canonical durable paths
* ioBroker status states for coordinator diagnostics

## 17. Phase 3D outlook

* wire selected triggers (manual/admin first)
* optional enable flag via config
* compare worker preparation vs in-process planner
* gradual plan artifact migration
