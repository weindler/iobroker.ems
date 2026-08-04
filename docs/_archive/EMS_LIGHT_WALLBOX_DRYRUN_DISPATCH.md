# EMS-Light — Wallbox Dryrun-Dispatch (v0.1.133)

## 1. Ziel des Dryrun-Dispatch

Die Wallbox erzeugt aus der validierten Daily-Plan-Allocation einen **neutralen EMS-Dispatch** im Dryrun: Intent, technisches Ziel, Mapping-Readiness und `dryrun_command_json`. Es werden **keine** EVCC- oder Wallbox-Fremd-States geschrieben — auch nicht im Live-Modus.

## 2. Neutraler Wallbox-Intent

Modul: `src/addons/wallbox/runtime/intent.ts`

- Herstellerneutrale Felder: `action`, `enabled`, `targetPowerW`, `targetCurrentA`, `phases`, `source`, Deadline/Energie, Revision, `validUntil`
- Keine EVCC-Modusnummern, keine Fremd-State-Pfade im Intent

## 3. Connected-Gate

```text
connected = false → action = none, enabled = false, targetPowerW = 0
```

Unbekannter Connected-Status → `missing_telemetry`, keine Ladefreigabe. Kein gecachter positiver Intent nach Disconnect.

## 4. Daily-Plan-Allocation

Quelle: `wallbox.ev_session` aus dem Daily Plan (bevorzugt Addon-Allocation-JSON).

Aktive Status: `allocated`, `partially_allocated`

| Allocation | Intent |
|------------|--------|
| positiv, technisch nutzbar | `charge`, `enabled = true` |
| gültig 0 W | `hold`, `enabled = false` |
| unallocated/disabled | `hold` oder `none` |
| Plan fehlt/ungültig | `none` — kein autonomer Fallback |

Externe EVCC-Pläne bleiben Diagnose only.

## 5. Leistungs- und Stromumrechnung

- Basis: Phasen × Min/Max-Strom × 230 V (wie Daily-Plan-Reader)
- `targetCurrentA = targetPowerW / (phases × 230 V)`, gerundet auf 1-A-Schritte
- Unter Mindestleistung → `hold` / `degraded`
- Über Maximalleistung → Begrenzung mit Diagnose

## 6. Phasenbehandlung

Keine automatische Phasenumschaltung in v0.1.133. Aktive oder konfigurierte Phasenanzahl nur als Eingang. Fehlende Phasen → `degraded`, keine Ladefreigabe.

## 7. Energiequelle

Aus Allocation: `pv_surplus`, `grid`, `mixed`, `none`. Dient Diagnose und späterer Moduswahl — in v0.1.133 kein Modus-Write.

## 8. Deadline

Wiederverwendung der bestehenden Wallbox-Deadline-Diagnose (`deadline_reachable`, geplante Energie bis Deadline).

Bei `deadline_at_risk`: Intent darf weiterhin `charge` sein, wenn Allocation positiv — keine eigenmächtige Leistungserhöhung.

## 9. EVCC-Zielmodell

Modul: `src/addons/wallbox/runtime/dispatch.ts` — `WallboxDispatchTarget`

`desiredEvccMode` nur bei vorhandenem Modus-Write-Mapping (in v0.1.133 nicht vorhanden → immer `null`).

## 10. Mapping-Readiness

`WallboxDispatchReadiness` prüft Legacy-Write-Rollen: `set_enabled`, `set_current_a`, `set_charge_power_w`.

`liveDispatchSupported = false` (fest in v0.1.133).

## 11. Dryrun-Command

`dryrun_command_json`: semantische Rolle, gewünschter Wert, aktueller gelesener Wert, `writeRequired`. Keine Ausführung.

UI-Text: „Dryrun — keine Wallbox-Kommandos ausgeführt.“

## 12. Plan-/Realitätsvergleich

Erweitert um `charging_below_plan` / `charging_above_plan` (Toleranz: 300 W, `WALLBOX_PLAN_POWER_TOLERANCE_W`).

Nur Diagnose — kein Fault, kein Write, keine Korrektur.

## 13. Governance

Bei Governance off: kein `charge`-Intent, `dispatch_action = none`, Telemetrie sichtbar.

## 14. Dryrun und Live

Gleicher Pfad: Intent → Ziel → Dryrun-States. `runtime_control_available = false`, `write_allowed = false` (fest).

## 15. Garantierte Write-Sperre

Kein `setForeignState`, keine Write-Queue, keine Failsafe-Aufrufe im Dispatch-Pfad.

## 16. Legacy-Failsafe-Abgrenzung

`failsafe.ts` unverändert; Dispatch importiert keine Failsafe-Funktionen.

## 17. Voraussetzungen für späteres Live

- Separater Live-Block mit Freigabe, Write-Feedback, Retry
- EVCC-Modus-Write-Mapping
- Governance + `liveDispatchSupported`-Freigabe
- Tests für echte Fremd-State-Writes

## Runtime-States (Dispatch)

Unter `addons.wallbox.runtime.*`:

`dispatch_status`, `dispatch_reason_de`, `dispatch_action`, `dispatch_intent_json`, `dispatch_target_json`, `target_enabled`, `target_power_w`, `target_current_a`, `target_phases`, `target_evcc_mode`, `dispatch_source`, `dispatch_valid_until`, `dispatch_daily_plan_revision`, `deadline_status`, `deadline_risk`, `control_mapping_complete`, `control_mapping_missing_json`, `dryrun_command_json`
