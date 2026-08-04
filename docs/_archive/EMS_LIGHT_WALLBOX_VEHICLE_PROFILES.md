# EMS-Light Wallbox Vehicle Profiles (v0.1.138)

> **Deprecated (v0.1.227):** Fat `wb_vehicle_profiles` + `addons.wallbox.vehicles.<id>.*` state trees are removed.
> Use slim admin table `wb_vehicle_map` (`evcc_vehicle_id`, optional `display_name` / `battery_capacity_net_kwh` / `max_ac_charge_power_w` / `enabled`).
> EVCC-first remaining energy works with an empty map. This document is historical.

Read-only / diagnostic foundation for multiple vehicle profiles per wallbox charging point.

## Separation: Wallbox vs Vehicle

| Entity | Responsibility |
|--------|----------------|
| **Wallbox** | Charging point, connection status, current session, technical loadpoint limits, EVCC control path, runtime execution |
| **Vehicle** | Profile, battery capacity, vehicle charge limits, SOC/range, individual targets, planning parameters |

Effective charge limits will later be the minimum of wallbox, vehicle, EVCC control, grid/policy and daily-plan allocation. v0.1.138 prepares only the **vehicle side**.

## Multiple Vehicles per Wallbox

A single wallbox can charge **any number** of different vehicles over time. There is **no fixed profile limit** in runtime code.

Admin configuration uses a dynamic table:

```text
wb_vehicle_profiles[]   (ioBroker jsonConfig type: table)
```

Default for new installations:

```text
wb_vehicle_profiles = []
```

No example vehicles are preconfigured as stored defaults. UI help text may show unbinding examples (e.g. `ford_explorer`) only as hints.

## Object Structure

```text
addons.wallbox.vehicles.<vehicle_id>/
├── config/
├── telemetry/
├── estimation/
├── planning/
└── runtime/
```

Folders are created as `type=folder` for each configured profile. Existing objects are never deleted or retyped.

## Vehicle ID and Privacy

- `vehicle_id` — safe ioBroker segment (`[a-z0-9_]`), stable across restarts
- **No VIN** in object paths, diagnostics or snapshots
- EVCC technical IDs map via configured fields; optional hashed prefix `evcc_<sha256-trunc>`

## Admin Configuration

Wallbox tab → **Fahrzeugprofile**:

- `wb_vehicle_profiles` — dynamic table (unlimited rows)
- `wb_manual_vehicle_id` — configured manual selection
- `wb_evcc_vehicle_id_state` / `wb_evcc_vehicle_name_state` — optional EVCC detection states

Each table row includes: `vehicle_id`, `display_name`, `enabled`, `source`, `is_guest`, EVCC mapping, capacity, charge limits, SOC targets, telemetry state IDs (`soc_state`, `range_state`, `connected_state`, `charging_state`, `session_energy_state`).

## Profile Sources

Unified model `WallboxVehicleProfile` with sources `manual`, `evcc`, `hybrid`.

## Profile Resolution vs Connection

Three distinct concepts:

| Concept | Meaning |
|---------|---------|
| **profileResolved** | A vehicle profile was uniquely identified or validly selected |
| **connected** | Physical connection at the loadpoint (EVCC/loadpoint telemetry) |
| **activeForCharging** | Diagnostic only: `profileResolved && connected` — no write path in v0.1.138 |

### Semantics of global states

| State | Meaning |
|-------|---------|
| `active_vehicle_id` | Currently resolved/selected profile (`vehicle_id`), **even when disconnected** |
| `vehicle_profile_resolved` | Profile identity successfully resolved |
| `vehicle_connected` | Physical connection for the resolved context |
| `vehicle_active_for_charging` | Would allow charging actions later; always `false` when disconnected |
| `active_vehicle_detection_status` | `resolved`, `disconnected`, `ambiguous`, `unknown`, … |

### Connected gate (absolute)

```text
connected=false → no charging permission, no command, no write
```

But:

```text
connected=false does NOT clear profileResolved or active_vehicle_id
```

Example:

```text
active_vehicle_id = ford_explorer
vehicle_profile_resolved = true
vehicle_connected = false
vehicle_active_for_charging = false
active_vehicle_detection_status = disconnected
```

## Active Vehicle Resolution Priority

1. Unambiguous EVCC match
2. Valid manual selection (`wb_manual_vehicle_id`)
3. Exactly one enabled profile (lower confidence)
4. Otherwise `ambiguous` / `unknown` — no “last vehicle” fallback

## Profile Switch and Stale Telemetry

- Each profile reads only its configured telemetry states
- EVCC live telemetry is merged **only** for the resolved profile while connected
- Inactive profiles keep their own last values; EVCC SOC does not bleed across profiles
- Per-profile `telemetry.stale` and `telemetry.last_update` indicate freshness

## Guest and Unknown

- **guest** — explicit guest profile via manual selection only
- **unknown** — no match; no inheritance from another profile

## Planning Capability

Categories: `soc_and_capacity`, `energy_only`, `limits_only`, `insufficient` — diagnostic only, no daily-plan integration.

## ActiveVehicleSnapshot

Serializable snapshot with `profileResolved`, `activeForCharging`, `connected`, profile limits, SOC source, `planningCapability`, stable `reasons[]`.

## Backward Compatibility

Legacy paths remain authoritative:

- `addons.wallbox.evcc.vehicle_soc_pct`
- `addons.wallbox.status.vehicle_soc_pct`
- `live.wallbox.vehicle_soc_pct`

Per-vehicle states under `addons.wallbox.vehicles.*` are additive.

## Not Included

- No automatic SOC estimation from charged energy
- No daily-plan or dispatch changes
- No real EVCC/wallbox writes triggered by this module itself (vehicle profiles feed the daily plan, not the write path directly)
- Since v0.1.177 the write gate itself is controlled-open (`WALLBOX_LIVE_WRITE_RELEASED = true`) for the EVCC control path — see `EMS_LIGHT_WALLBOX_LIVE_FOUNDATION.md`
- No new timers or polling loops in this module

## Module Path

`src/addons/wallbox/vehicles/`
