# EMS-Light — Wallbox Daily-Plan Read-only (v0.1.131)

## 1. Ziel der Wallbox-Plananbindung

Die Wallbox wertet den EMS Daily Plan **diagnostisch** aus: aktuelle Slot-Allocation, Leistung, Energiequelle, Deadline und Plan-/Realitätsvergleich. Es werden **keine** EVCC- oder Wallbox-Kommandos geschrieben.

## 2. Read-only-Grenze

- `runtime_control_available = false` (fest)
- `write_allowed = false` (fest)
- unabhängig von `global.execution_mode` und `addons.wallbox.mode`
- Legacy-Failsafe-Writes bleiben unverändert, werden aber nicht für die Planauswertung genutzt

## 3. `connected` als erstes Gate

```text
connected = false → keine EV-Ladeaktion, keine aktive Ladefreigabe
```

- `vehicle_soc_pct = 0` ist unkritisch
- SOC wird nicht auf `null` umgeschrieben
- keine Deadline-Warnung ohne verbundenes Fahrzeug
- Decision Source: `vehicle_disconnected`

## 4. SOC 0 bei nicht verbundenem Fahrzeug

Kein Ladebedarf allein aus SOC oder Ziel-SOC. Alte Allocationen gelten nicht als aktiv.

## 5. Daily-Plan-Quelle

Bevorzugt: `planner.intent.allocation.wallbox.plan_json`

Fallback: `planner.intent.daily_plan.plan_json` (nur `wallbox.ev_session`)

## 6. Aktuelle Slot-Allocation

Slot via `slotStartIsoFloored()` — dieselben Operator-Zeithelfer wie Daily Plan, Heizstab und Klima.

Aktive Status: `allocated`, `partially_allocated`

## 7. Leistungsgrenzen

Technische Mindest-/Maximalleistung aus Phasen × Strom × 230 V (EVCC-Telemetrie). Keine automatische 3-Phasen-Annahme. Allocation unter Mindestleistung → keine Freigabe.

## 8. Deadline- und Energieauswertung

- verbleibende Energie aus SOC/Kapazität (wenn bekannt)
- geplante Energie bis Deadline aus vorhandenen Allocation-Einträgen
- Deadline erreichbar: `true` / `false` / `unknown`
- keine neue Allocation

## 9. PV-/Grid-Aufteilung

Aus Allocation: `energySource`, `pvPowerW`, `gridPowerW`, `estimatedCostCt` (null ohne Preis).

## 10. Vergleich Plan gegen tatsächlichen Ladestatus

`plan_execution_status`:

| Wert | Bedeutung |
|------|-----------|
| `in_plan` | lädt mit aktiver EMS-Allocation |
| `charging_without_plan` | lädt ohne EMS-Freigabe |
| `planned_but_not_charging` | Freigabe, lädt nicht |
| `not_planned_not_charging` | keine Freigabe, lädt nicht |
| `vehicle_disconnected` | Fahrzeug nicht verbunden |
| `charging_below_plan` | lädt unter geplanter Allocation (>300 W Toleranz) |
| `charging_above_plan` | lädt über geplanter Allocation (>300 W Toleranz) |

Keine automatische Korrektur, keine Faults allein wegen Abweichung.

## 11. Externe EVCC-Planinformation

EVCC-Planzeiten (`plan_time`, `effective_plan_time`) werden weiter gespiegelt, aber **nicht** als EMS-Allocation oder steuernder Fallback verwendet. Decision Source `external_plan_only` bei fehlendem gültigen Daily Plan.

## 12. Governance

`isAddonGovernanceEnabledFromState(..., "wallbox")` — bei deaktivierter Governance keine Planfreigabe, Telemetrie bleibt sichtbar.

## 13. Runtime-/Diagnosestates

Unter `addons.wallbox.runtime.*`:

- Entscheidung: `decision_source`, `reason_de`, `plan_execution_status`
- Daily Plan: `daily_plan_status`, `daily_plan_valid`, `daily_plan_revision`, Slot-Zeiten
- Allocation: `charging_allowed_by_plan`, `allocated_power_w`, `energy_source`, PV/Grid-Anteile
- Deadline: `deadline_iso`, `remaining_energy_kwh`, geplante Energie/Kosten bis Deadline
- Horizont: `first_planned_slot`, `last_planned_slot`, `active_planned_slots`, `max_planned_power_w`
- Read-only: `runtime_control_available`, `write_allowed` (immer false)

## 14. Cache und Lifecycle

- Allocation-JSON wird bei Revisionsänderung geparst
- Cache-Reset bei Modul-Stop
- Parse-Fehler invalidiert Cache
- States nur bei Änderung (`setStateIfChanged`)

## 15. Dryrun und Live

Gleiche read-only-Auswertung in Dryrun und Live. Keine EVCC-Writes.

## 16. Ausdrücklich fehlende EVCC-Writes

Kein Moduswechsel, keine Strombegrenzung, keine Planzeit-Übertragung, kein Start/Stop.

## 17. Nächster späterer Dispatch-Schritt

Wallbox-Live-Steuerung / EVCC-Dispatch nach erfolgreicher Validierung der Dryrun-States. Siehe `docs/EMS_LIGHT_WALLBOX_DRYRUN_DISPATCH.md`.

## Abgrenzung

| Add-on | Daily-Plan-Anbindung |
|--------|----------------------|
| Heizstab | ✅ Runtime-Leistungsobergrenze (v0.1.129) |
| Klima | ✅ Runtime-Leistungsobergrenze + Governance (v0.1.130) |
| Wallbox | ✅ read-only Diagnose + Dryrun-Dispatch (v0.1.133) |
| Batterie | ✅ Ladepfad an Daily Plan (v0.1.132) |

Keine KI, keine Batterieentladung, keine EVCC-Steuerung in diesem Block.
