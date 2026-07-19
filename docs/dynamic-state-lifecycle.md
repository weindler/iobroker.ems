# Dynamic State Lifecycle (Phase 4B1)

**Version:** 0.1.143
**Branch:** `refactor/v0.1.143-production-surface-cleanup`
**Status:** Implemented in code; not yet installed on production.

## Purpose

Stop creating ioBroker object trees for devices that were never configured, and allow controlled cleanup of unambiguous placeholder trees left by older ensures.

## Definitions

### Configured (Klima-Unit)

A unit index `N` (Admin capacity `1..AC_UNIT_COUNT`) is **configured** when either:

1. `ac_uN_enabled === true`, or
2. at least one mapping `ac_uN_*_target` is a non-empty string.

Not sufficient: historical object existence, default Admin slot, empty native fields, auto-created placeholders, or “disabled” alone when no real config ever existed.

### Disabled-but-configured

`enabled === false` **and** configured (e.g. mappings present). Objects **must remain**. Runtime stays inactive; cleanup must not delete.

### Removed (bereinigungsfähig)

Previously configured device no longer present in current Admin/native config:

- Klima: unit no longer configured by the definition above → allowlisted unit + mapping trees may be deleted.
- Fahrzeug: `vehicle_id` absent from `wb_vehicle_profiles` → allowlisted `addons.wallbox.vehicles.<id>` may be deleted.

### Unclear → skip

If an ID is not on the allowlist, looks foreign/absolute, overlaps protected prefixes, or config cannot be re-checked → **do not delete**.

## Fahrzeugprofile

| Situation | Objects |
|-----------|---------|
| `wb_vehicle_profiles: []` | Only parent channel `addons.wallbox.vehicles` |
| Row with valid `vehicle_id` | Full profile tree (even if `enabled: false`) |
| Row removed from table | Controlled cleanup may remove `addons.wallbox.vehicles.<id>` |

Privacy-safe IDs (`sanitizeVehicleId`) and profile isolation unchanged. No fixed profile count.

## Ensure behavior

| Area | Rule |
|------|------|
| AC runtime | Only `configuredAcUnitIndexes(config)` |
| AC mapping ensure | Only mapping commands for configured units |
| AC consumer stats init | Only configured units |
| Vehicles | Only profiles from `wb_vehicle_profiles` |

## Cleanup allowlist

Relative IDs only (adapter namespace implied):

1. `addons.air_conditioning.units.unit_{1-5}` — if unit not configured
2. `addons.air_conditioning.mapping.unit_{1-5}_*` — if unit not configured
3. `addons.wallbox.vehicles.<vehicleId>` — if id not in current profiles

Never delete: foreign objects, userdata, aliases, mapped external targets, configured-but-disabled devices, Phase-4A compatibility states (`planner.intent.*`, `allocation.*.plan_json`, `learning.persistence.*_json`), planner authority/takeover/coordinator data, execution modes.

No broad `deleteObjectRecursive` on entire addon prefixes.

## Upgrade / recovery

1. Ensure configured trees.
2. Run `runDynamicSurfaceCleanup` (bootstrap phase C2).
3. Idempotent: second run deletes 0.
4. Interrupt-safe: re-check config before each delete; missing objects count as skip.
5. Log: `checked` / `deleted` / `skipped`.

## Expert surface

Diagnostic/advanced planner trees set `common.expert: true` (ioBroker-supported). Admin planner shadow/authority/takeover fields use jsonConfig `"expert": true`. Core user states (e.g. `global.execution_mode`) remain non-expert. Compatibility states may be expert-marked later; **not** removed or renamed in 4B1.

## Out of scope (unchanged)

Execution modes, startup-rearm, restore dryrun clamp, planner authority/lease/takeover semantics, scheduler, large JSON relocation, learning persistence contracts, VIS.
