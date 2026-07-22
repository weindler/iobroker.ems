# EMS-Light Wallbox Vehicle SOC & Energy Fallback (v0.1.139)

Read-only foundation: deterministic SOC resolution with defined fallbacks, energy content and charge requirement derivation. **No new charging permission, no device writes, no planner/dispatch integration.**

## Purpose

Central pure resolver `resolveVehicleSocAndEnergy()` evaluates available vehicle SOC per profile, applies a fixed fallback chain, derives battery energy and required energy to target SOC, and publishes source/quality/reason diagnostics.

Separation preserved:

```text
Raw telemetry → validation → SOC resolution → energy derivation → state publish → charging gate (unchanged)
```

SOC resolution is **not** a charging permission.

## SOC sources and priority

1. `direct` — fresh numeric SOC in 0..100 (including real **0%**)
2. `energy_rollforward` — baseline SOC + measured session charge energy × configured efficiency
3. `range_estimate` — current range / configured reference range at 100%
4. `last_trusted` — stored profile baseline within configured max age
5. `unknown` — no usable source (`resolvedSocPct = null`, **not** published as 0)

| Source | Quality | Estimated |
|--------|---------|-----------|
| direct | high | no |
| energy_rollforward | medium | yes |
| range_estimate | low | yes |
| last_trusted | low | yes |
| unknown | none | no |

### Direct SOC rules

- Valid: finite number in `[0, 100]` including **0** and **100**
- Invalid: `null`, `undefined`, `NaN`, negative, >100, stale configured reading
- **`connected=false` does not invalidate SOC** — it only blocks charging via existing gates

### Real 0% vs unknown

- Raw telemetry states may still hold raw values
- Resolved states use empty/`unknown` for missing SOC — never invent 0 for unknown

## Profile fields (optional, backward compatible)

| Field | Admin key | Validation |
|-------|-----------|------------|
| Reference range at 100% | `reference_range_at_100_pct_km` | >0, finite; required for range fallback |
| Charge efficiency | `charge_efficiency_pct` | (0, 100]; required for rollforward input energy and rollforward |
| SOC fallback max age | `soc_fallback_max_age_min` | ≥0; `0`/missing disables last-trusted |

Default profile list remains `wb_vehicle_profiles = []`. No demo profiles.

## Energy formulas

When resolved SOC, usable capacity and target SOC are valid:

```text
currentBatteryEnergyKwh = capacity × resolvedSoc / 100
targetBatteryEnergyKwh = capacity × targetSoc / 100
requiredBatteryEnergyKwh = max(0, target − current)
requiredInputEnergyKwh = requiredBattery / (efficiency/100)   // only if efficiency configured
```

## Energy rollforward

Requires same-profile trusted baseline, valid capacity, configured efficiency, fresh session energy counter, monotonic counter (no reset/backward jump). Only **positive** measured charge deltas. No discharge guessing, no cross-profile energy.

On counter reset: baseline rollforward discarded, falls back to next source.

## Range fallback

`estimatedSoc = clamp(currentRange / referenceRangeAt100 × 100, 0, 100)` — no learning, no temperature/style correction.

## Last trusted

Profile-isolated stored baseline reused only when `soc_fallback_max_age_min > 0` and age is within limit.

## Persistence and profile isolation

Per-vehicle baseline stored in memory and mirrored to:

```text
addons.wallbox.vehicles.<vehicle_id>.estimation.baseline_*
```

No global SOC cache. Profile switch uses only that profile's baseline and telemetry. Inactive profiles keep their own data; active mirror states reflect only the active profile.

## Published states

Per profile (`estimation.*`):

- `resolved_soc_pct`, `resolved_soc_source`, `resolved_soc_quality`, `resolved_soc_estimated`
- `current_battery_energy_kwh`, `target_battery_energy_kwh`
- `required_battery_energy_kwh`, `required_input_energy_kwh`
- `resolved_target_soc_pct`, `soc_energy_ready`, `soc_energy_reason_code`, `baseline_valid`
- Baseline mirror: `baseline_soc_pct`, `baseline_soc_source`, `baseline_at`, `baseline_session_energy_kwh`

Active mirrors under `addons.wallbox.runtime.active_vehicle_*`.

`planning.required_energy_kwh` now reflects resolver output (diagnostic only).

## Reason codes

Stable codes include: `direct_soc_valid`, `direct_soc_stale`, `energy_rollforward_valid`, `energy_rollforward_counter_reset`, `range_estimate_valid`, `last_trusted_valid`, `last_trusted_expired`, `no_usable_soc_source`, etc.

## Connected=false

Charging remains blocked (`activeForCharging=false`, dispatch unchanged). SOC/energy diagnostics may still resolve for display/planning prep.

### Baseline provenance (v0.1.139 correction)

Two separate persistence roles per profile:

| Role | Updated by | Used for |
|------|------------|----------|
| **Rollforward anchor** | fresh `direct` only | `energy_rollforward` (always vs original direct SOC + session counter) |
| **Last-trusted snapshot** | `direct`, `energy_rollforward`, `range_estimate` | `last_trusted` fallback within max age |

`range_estimate` and `last_trusted` never create or overwrite rollforward anchors. `last_trusted` never renews its own snapshot timestamp.

## Explicit non-goals (v0.1.139)

- No real wallbox writes, safety/FSM/feedback/ownership/restore changes
- No daily-plan allocation or dispatch action changes
- No automatic reference-range or efficiency learning
- No cross-profile data bleed
- No behavior change from the vehicle SOC/energy module itself when `WALLBOX_LIVE_WRITE_RELEASED = true` (v0.1.177) — this module stays read-only regardless of the write gate
