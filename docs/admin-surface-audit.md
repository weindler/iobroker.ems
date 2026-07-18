# Phase 4A — Admin Surface Audit

**Date:** 2026-07-18  
**Sources:** `admin/jsonConfig.json`, `admin/i18n/{en,de}.json`, `io-package.json`  
**Version:** 0.1.143  

## Admin architecture

- UI type: Admin **jsonConfig** tabs (`io-package` `common.adminUI.config: "json"`).  
- `native` defaults in `io-package.json` are empty; defaults live in jsonConfig field `default`s.  
- Tabs: Global, Wallbox, Battery, Immersion, Climate, Dynamic Tariff, Learning, Policy, Intent.  
- Scale: on the order of **~500** data-bound native fields.  
- Conditional `hidden` today: Sonnen battery profile only. **No** `expertMode` usage yet.

## Planner-related native fields (complete)

| Native key | Options | Default | Tentative class |
|------------|---------|---------|-----------------|
| `planner_runtime_mode` | `off`, `shadow_manual`, `shadow_auto` | `off` | Developer / support |
| `planner_takeover_evaluation_mode` | `disabled`, `observe` | `disabled` | Developer / support |
| `planner_takeover_authorization_mode` | `disabled`, `manual_prepare` | `disabled` | Developer / support |
| `planner_authoritative_source` | `legacy`, `worker_dryrun` | `legacy` | Developer / near internal |
| `ac_planner_outdoor_likely_temp_c` | number | `28` | Advanced (climate planning) |

These four Global gates are **fully visible** to every admin user today — primary Phase 4 UX risk.

### Concepts that are not separate admin fields

| Concept | Reality |
|---------|---------|
| `shadow_manual` / `shadow_auto` | Values of `planner_runtime_mode` |
| `worker_dryrun` | Value of `planner_authoritative_source` |
| `worker_authoritative` | Runtime **state**, not config |
| Session shadow | State `planner.coordinator.shadow_enabled` |
| prepare / confirm / activate / deactivate | Runtime **button states** under takeover authorization / authority |

## Classification of broader admin fields

| Class | Examples |
|-------|----------|
| **Normal user** | `global_execution_mode`, `global_mode_default`, addon enable/mode, core mappings (SOC, power, EVCC connected), basic climate enable/temps, price-now, intent defaults |
| **Advanced** | Failsafe timeouts, hardware limits, winter params, immersion thermal, vehicle table, policy JSON strings, most learning enable/lookback |
| **Developer / support** | Dense objectId matrices (EVCC write/read, AC cmd/feedback ×5), Sonnen sequence timings, stats offsets, mutual-exclusion JSON |
| **Internal (should not be visible)** | None as native config today; the hazardous surface is **states** (coordinator/takeover/authority) plus the four planner gates if left on Global without expert gating |

## Target admin UX

**Normal:**

- Execution mode (dryrun/live) with clear warnings  
- Global mode default  
- Addon on/off and essential mappings  
- Planner: **Off** / **Automatic** only (map internally to safe runtime defaults)

**Advanced / Expert:**

- Detailed mappings, learning knobs, policy JSON  
- Legacy shadow_manual if still needed for support  

**Developer / Support (expert or hidden):**

- `planner_takeover_evaluation_mode`  
- `planner_takeover_authorization_mode`  
- `planner_authoritative_source`  
- Any future diagnostic-mode toggles  

Internal vocabulary (`shadow`, `takeover`, `worker_dryrun`, `candidate`) must not appear in normal labels.

## ioBroker-compliant hiding

| Mechanism | Use for |
|-----------|---------|
| jsonConfig `expertMode` | Hide developer fields unless Admin expert mode (prefer raising admin dependency if used) |
| jsonConfig `hidden` | Formula-hide fields when planner off / addon disabled |
| Object `common.expert` | Hide diagnostic **states** in object tree for non-expert Admin |

Do **not** invent undocumented `common.hidden` / custom visibility flags.

## VIS coupling (observed, `vis/` not modified)

Existing dashboard bindings use legacy `planner.intent.*` / surplus / global_mode paths — **not** coordinator/takeover/authority. Hiding pilot states should not break that dashboard; changing legacy intent IDs remains a compatibility risk (class F).
