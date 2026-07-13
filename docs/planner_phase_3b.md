# EMS-Light Phase 3B — ioBroker Snapshot Source & Worker Preparation

## 1. Dependency flow

```text
IoBrokerPlannerSnapshotSource (main process, not yet wired)
    ↓ PlannerSnapshotSource contract
CachedPlannerSnapshotSource
    ↓
buildPlannerInputSnapshot()
    ↓ input.json (runtime job dir)
planner_worker (short-lived Node process, no ioBroker)
    ↓
preparePlannerFromSnapshot() → prepared_input_v1.json
```

No reverse dependency from worker to main process or adapter.

## 2. ioBroker source boundary

`IoBrokerPlannerSnapshotSource` implements `PlannerSnapshotSource` against a slim `PlannerSnapshotIoBrokerHost`:

- `getStateAsync` / `getForeignStateAsync`
- `config` (native adapter config, never returned as-is)
- `getAbsolutePath` for learning persist dirs

The pure builder (`buildPlannerInputSnapshot`) does not import adapter-core or ioBroker types.

## 3. Config whitelist

`plannerRelevantConfigFromHost()` maps only planner-relevant fields into `PlannerRelevantConfig`.

Excluded: passwords, tokens, API keys, credentials, full native config, functions.

## 4. Safe file access

`readJsonFile()` allows only:

- `house_load_learning_v1.json` under `learning/house_load`
- `thermal_runtime_learning_v1.json` under `learning/thermal_runtime`
- `consumer_stats_v1.json` under `learning/consumer_stats`

Traversal and paths outside allowed roots are rejected. Missing optional files → `null`. Invalid JSON → error.

## 5. First worker preparation stage

**Chosen stage:** `buildGridSupplyForecast` (`src/grid_supply/forecast.ts`)

Neutral core extracted from operator runtime. Both `src/operator/supply/grid.ts` and `src/planner_preparation/prepare.ts` import the same implementation.

This is the earliest pure stage in `runGridSupplyTick`:

1. Inputs map 1:1 from `PlannerInputSnapshot` via `gridSupplyBuildInputFromSnapshot`
2. No adapter, no state writes, no device runtimes
3. Deterministic for identical snapshot content (uses `snapshot.capturedAt` as `now`)
4. Produces 15-minute price/import slots and policy limits

Also derives constraint contribution status via `buildHouseMainFuseConstraintContribution` and `buildGlobalConstraintsContribution` (read-only, pure).

## 6. Input / output contract

**Input:** `PlannerInputSnapshot` schema v2 in `input.json`

**Output:** `PlannerPreparedInput` in `prepared_input_v1.json`

```ts
{
  schemaVersion: 1;
  inputRevision: string;
  preparationRevision: string; // SHA-256 canonical
  capturedAt, timezone, horizonStart, horizonEnd;
  slots: PlannerPreparedSlot[];
  policy: PlannerPreparedPolicy;
  diagnostics: PlannerPreparationDiagnostics;
}
```

Budget: 64 KiB. Atomic write in job runtime directory only.

## 7. Determinism

- Planning time = `snapshot.capturedAt` (not worker wall clock)
- `preparationRevision` excludes `preparationRevision` and `generatedAt` fields
- Sorted keys for canonical hashing

## 8. Error handling

Worker validates before preparation:

1. JSON parse
2. Schema v2 structure
3. 200 KiB input budget
4. `inputRevision` SHA-256 match
5. Forbidden snapshot content scan

Legacy v1 stub inputs require explicit `request.kind === "legacy_stub"`. Snapshot v2 preparation requires `request.kind === "planner_snapshot_v2"`. No automatic schema fallback.

Errors return exit code 2 with compact code (`invalid_schema_version`, `input_revision_mismatch`, `invalid kind`, etc.).

## 9. Runtime boundary (Phase 3B)

**Not activated:**

- No calls from `main.ts`, `ems_light/*`, planner tick, scheduler
- No worker spawn in normal adapter operation (except isolated tests)
- No ioBroker state writes
- No canonical durable plan semantics change (stub plans remain for publish contract)

## 10. Phase 3C outlook

- Wire `buildPlannerInputSnapshotFromIoBroker` into job lifecycle on trigger
- Move PV/house-load/weather contributions into worker
- Replace stub forecast/daily artifacts with real plans
- Generation-guarded publish from worker output
