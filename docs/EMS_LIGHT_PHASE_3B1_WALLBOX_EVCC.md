# EMS-Light Phase 3B.1 — Wallbox vollständig auf EVCC-Mappings

## Architekturentscheidung

```text
beliebige Wallbox → EVCC → EMS-Light (read-only)
```

- **EVCC** ist die einzige Wallbox-Abstraktion von EMS-Light.
- Die konkrete Wallbox wird ausschließlich in **EVCC** konfiguriert.
- EMS-Light liest standardisierte **EVCC-Datenpunkte**.
- Direkte herstellerspezifische Wallbox-Mappings (z. B. go-e) werden **nicht mehr** in der Runtime verwendet.
- Alte go-e-Konfigurationsfelder (`wb_set_*`) bleiben nur aus **Kompatibilitätsgründen** in der Instanz-Konfiguration erhalten.
- **Diese Phase enthält noch keine EVCC-Steuerung** — keine Writes an EVCC oder Wallbox.

## Admin-Oberfläche (Tab „Wallbox“)

Herstellerneutral, nur EVCC-Gruppen:

| Gruppe | Felder |
|--------|--------|
| EVCC — Betriebsdaten | Modus, enabled, connected, charging, Ladeleistung, Sitzungsenergie |
| EVCC — Fahrzeug und Ladeziel | Fahrzeug-SOC, Ziel-SOC, Plan aktiv, Plan-Ziel-SOC, Planzeit, effectivePlanTime |
| EVCC — Ladepunktdaten | aktive/konfigurierte Phasen, min/max Ladestrom |

Intent-relevante EVCC-Felder (`intent_evcc_*`) sind auf dem Wallbox-Tab konfiguriert; der Tab „EMS-Light User Intent“ enthält nur Defaults und ioBroker-Request-Einstellungen.

## Runtime

- **Wallbox Input → ausschließlich EVCC** (`readEvccTelemetrySnapshot`, Intent-Engine `readEvccIntentSnapshot`).
- Ausgabe: `addons.wallbox.evcc.*`, `live.wallbox.*` (enabled, charging, charge_power_w, vehicle_soc_pct).
- Fehlende Werte: `missing` / nicht verfügbar — **niemals** als `0` oder `false` erfunden.
- Legacy go-e-Ausgänge (`set_enabled`, `set_current_a`, …) werden vom neuen EVCC-Runtime-Pfad nicht gelesen.
- Wallbox-Failsafe schreibt nur noch, wenn Legacy-Write-Mappings konfiguriert sind.

## Konfigurationsschlüssel

### EVCC Telemetrie (neu)

`wb_evcc_enabled_state`, `wb_evcc_connected_state`, `wb_evcc_charging_state`, `wb_evcc_charge_power_w_state`, `wb_evcc_session_energy_kwh_state`, `wb_evcc_vehicle_soc_state`, `wb_evcc_plan_*`, `wb_evcc_active_phases_state`, …

### Intent (unverändert, Phase 3B)

`intent_evcc_mode_state`, `intent_evcc_target_soc_state`, `intent_evcc_deadline_state`, `intent_evcc_immediate_state`, `intent_evcc_source_timestamp_state`

### Legacy (deprecated, nicht in Admin sichtbar)

`wb_set_enabled_*`, `wb_set_current_a_*`, `wb_set_charge_power_w_*`, `wb_set_phase_switch_*`, `wb_vehicle_soc_*`, `wb_feedback_power_*`

## Abgrenzung Phase 3C+

- Keine EVCC-Writes
- Kein Planner / Operator / Execution für Wallbox
- Keine automatische Übersetzung go-e → EVCC
