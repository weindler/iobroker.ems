# Phase 4A — Production State Surface Audit

**Date:** 2026-07-18  
**Branch:** `refactor/v0.1.143-production-surface-cleanup`  
**Baseline tag:** `planner-shadow-gate3-verified`  
**Version:** 0.1.143  

Machine-readable companion: [`state-surface-inventory.json`](./state-surface-inventory.json).  
Read-only tool: `npm run audit:states` → `build/audit/run_state_surface_audit.js`.

## Problem statement

A production instance currently exposes on the order of **~1534** adapter states. That is far beyond a normal operator surface. Growth came from planner shadow/coordinator/authority/takeover trees, forecast/daily plan JSON mirrors, learning modules, and fully expanded device trees (including disabled AC units and vehicle slots).

Phase 4A is **inventory only**: no runtime behavior change, no object deletion, no authority activation.

## How states are created

Central helper: `src/ems_light/state_util.ts` (`setObjectNotExistsAsync` / `setStateIfChanged`).

| Orchestrator | Role |
|--------------|------|
| `src/bootstrap/ensure_static_tree.ts` | Channels, execution, addon basis, mappings, EMS-Light, backup |
| `src/ems_light/index.ts` `ensureEmsLightStateTree` | Planner, policy, intent, learning |
| Lazy runtimes | `planner.authority.*`, `planner.takeover.authorization.*` |

Dynamic growth: `ensureDynamicVehicleProfiles`, AC unit trees, dryrun mirrors on first write, consumer stats.

## Family inventory (estimated static leaf counts)

| Family | Pattern | ~Count | Target class |
|--------|---------|-------:|--------------|
| Wallbox (excl. vehicles) | `addons.wallbox.*` | 200 | A Core |
| Learning | `learning.*` | 180 | B Advanced |
| Battery + mirror | `addons.battery.*`, `ems_mirror.*` | 140 | A Core |
| Air conditioning | `addons.air_conditioning.*` | 120 | A Core (risk: disabled units) |
| Global / execution / audit | `global.*`, `command.*`, … | 50 | A Core |
| Backup / support / info | `backup.*`, `support.*`, `info.backup.*` | 46 | B Advanced |
| Immersion heater | `addons.immersion_heater.*` | 45 | A Core |
| User intent | `user_intent.*` | 40 | B Advanced |
| Planner core | `planner.intent.*` (legacy) | 39 | F Compatibility (VIS) |
| EMS-Light live/system | `system.*`, `live.*`, … | 36 | A Core |
| Coordinator + shadow compare | `planner.coordinator.*` | 33 | C Diagnostics |
| Global modes + policy | `global_modes.*`, `policy.*` | 26 | B Advanced |
| Contributions | `planner.intent.contributions.*` | 23 | D File data |
| Authorization | `planner.takeover.authorization.*` | 23 | C Diagnostics |
| Takeover | `planner.takeover.*` | 22 | C Diagnostics |
| Authority + memory | `planner.authority.*` | 21 | C Diagnostics |
| Daily plan | `planner.intent.daily_plan.*` | 17 | D File data |
| Forecast plan | `planner.intent.forecast_plan.*` | 14 | D File data |
| Allocations | `planner.intent.allocation.*` | 12 | F Compatibility |
| Grid supply | `planner.intent.supply.grid.*` | 10 | B Advanced |
| Vehicle profiles | `addons.wallbox.vehicles.<id>.*` | 0 + **64×vehicles** | A Core |
| Dryrun mirrors | `addons.<addon>.dryrun.*` | dynamic | C Diagnostics |

**Catalog static sum ≈ 1000+**; live ~1534 includes dynamics and full AC/mapping expansion.

## Classification totals (catalog estimate)

| Class | Meaning | ~Static |
|-------|---------|--------:|
| A Core User | Required for normal operation/status | 591 |
| B Advanced User | Occasional technical interest | 302 |
| C Temporary Diagnostics | Time-boxed / pilot only | 99 |
| D Internal File Data | Should not be permanent states | 54 |
| E Obsolete | Unused / superseded | 0 (none confirmed yet) |
| F Compatibility Contract | Still required by readers/VIS/migration | 51 |

## Largest producers

1. **Wallbox + mappings + vehicles** — operational but mapping/dryrun JSON and empty vehicle trees inflate count.  
2. **Learning + persistence mirrors** — many scalars plus dual-written JSON.  
3. **Battery architecture tree** — keep status; mapping/dryrun are advanced.  
4. **AC fixed 5-unit expansion** — disabled units still create large subtrees.  
5. **Planner intent JSON mirrors** (forecast/daily/allocations/contributions) — high bytes, low operator value as states.  
6. **Shadow/authority/takeover** — ~99 diagnostic states with internal vocabulary.

## Large JSON investigation

| ID family | Runtime readers | Backup | VIS | File destination candidate |
|-----------|-----------------|--------|-----|----------------------------|
| `forecast_plan.*_json` | Forecast tick writer; snapshot hot path excludes | optional | no | `ems-runtime.<n>/planner/forecast/` |
| `daily_plan.*_json` | Daily tick; durable canonical already in `ems.<n>/planner/` | file-oriented | no | keep durable files; drop state mirror |
| `allocation.<addon>.plan_json` | Addon daily_plan modules/tests | no | no | runtime files after reader migration (**F**) |
| `contributions.*_json` | Plan builders | no | no | `ems-runtime.<n>/planner/contributions/` |
| `policy_*_json` / `user_intent.*_json` | Engines | partial | partial | compact status + file |
| `learning.persistence.*_json` | Mirror of durable files | files are SoT | no | stop dual-write |
| Shadow comparison fields | Coordinator bridge | no | no | keep as short scalars in diag mode only |

**Do not move JSON until** each row’s readers, backup, and external script risk are confirmed (Phase 4B+).

## Target normal user surface

Allowed concepts:

- Planner **off** / **automatic**
- Compact status, last run, next run, quality, active source, last error, manual rerun

**Must not** appear in normal UI: shadow, candidate, lease, generation, takeover, worker_dryrun jargon.

Hard budgets:

- Planner core in normal operation: **≤ ~30** always-present states  
- Temporary planner diagnostics: only with explicit diagnostic/pilot mode  
- No permanent large slot/contribution JSON states  
- Dynamic device states only for **configured/enabled** devices  
- Overall adapter count far below ~1534

## ioBroker-compliant visibility levers

Documented only (no invented metadata):

| Lever | Where | Effect |
|-------|-------|--------|
| `expertMode` | Admin jsonConfig field | Show only in Admin expert mode (Admin ≥ 7.4.3) |
| `hidden` | Admin jsonConfig field | Hide field (bool/formula) |
| `common.expert` | Object `common` | Object tree visible only in expert mode (`@iobroker/types`) |
| `common.custom` | Object `common` | Custom settings — **not** a hide flag |

This adapter currently does **not** set `common.expert` on planner diagnostic states; Global planner gates have no `expertMode`.

## Recommended cleanup order (later phases)

1. Stop ensuring AC/vehicle/mapping trees for disabled/unconfigured devices (largest easy win).  
2. Gate planner pilot admin fields + `common.expert` on coordinator/authority/takeover.  
3. Introduce diagnostic mode; move C-class trees behind it (no deletion yet).  
4. Migrate D-class JSON to durable/runtime files; keep compact status states.  
5. Retarget F-class readers (allocation `plan_json`, VIS) then shrink compatibility states.  
6. Only then deprecate/remove obsolete objects with migration notes.

## Out of scope for 4A

- Functional runtime changes  
- Deleting existing ioBroker objects  
- Authority activation  
- Execution-mode / startup-rearm semantics  
- `vis/` modifications  
