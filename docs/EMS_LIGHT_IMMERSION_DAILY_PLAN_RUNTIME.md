# EMS-Light — Heizstab Daily-Plan Runtime (v0.1.129)

## 1. Ziel der Runtime-Anbindung

Im Automatikbetrieb liest die Heizstab-Runtime die aktuelle Daily-Plan-Allocation und nutzt sie als **maximale Leistungsobergrenze** für die Stufenauswahl. Safety, Fault/Lockout, Mindestlaufzeit, Mindestpause, Temperaturregelung, Dryrun und Live-Gates bleiben unverändert in der bestehenden FSM.

Der Daily Plan ersetzt keine technische Runtime-Logik und schreibt keine Relais direkt.

## 2. Entscheidungsreihenfolge

```text
Safety / Fault / Lockout
→ manueller Off-Befehl
→ manueller Force-Befehl
→ gültige Daily-Plan-Allocation (Auto)
→ deterministischer Legacy-Thermal-Planner (temporärer Fallback)
→ sicherer AUS-Zustand
```

Modul: `src/addons/immersion_heater/runtime/daily_plan.ts`, Integration in `engine.ts`.

## 3. Daily Plan als Leistungsobergrenze

`allocated_power_w` ist die Summe gültiger Mandatory- und Flexible-Allocations im aktuellen 15-Minuten-Slot. Die Runtime wählt die **höchste technisch zulässige Stufe** mit `nominalPowerW <= allocated_power_w`.

Beispiel: Allocation 1.700 W, Stufen 1.700 / 3.400 / 5.100 W → nur Stufe 1.

## 4. Mandatory und Flexible Allocation

| Contribution | Bedeutung |
|---|---|
| `immersion_heater.mandatory` | Pflichtbedarf im Plan, höhere fachliche Priorität |
| `immersion_heater.flexible` | Slotgebundene flexible Leistung, keine eigenständige PV-Überschussentscheidung in der Runtime |

Beide Anteile werden summiert; Doppelzählung derselben Slot-Contribution wird abgelehnt.

## 5. Stufenauswahl

Bestehendes Phasen-/Stufenmodell (`config.stages`). Keine separate Stufenlogik.

Ist die Allocation kleiner als die kleinste verfügbare Stufe, wird **nicht neu gestartet** (Grund im Runtime-State). Eine laufende Mindestlaufzeit wird nur gemäß bestehender FSM-Regeln behandelt.

## 6. Auto, Force und Off

| Modus | Verhalten |
|---|---|
| **Off** | Daily Plan ignorieren, sicher AUS, `decision_source = manual_off` |
| **Force** | Bisheriges Force-Verhalten, Daily Plan nicht als Begrenzung, `decision_source = manual_force` |
| **Auto** | Daily Plan prüfen; bei gültigem Plan mit 0 W kein Thermal-Fallback |

Wichtig: **gültiger Daily Plan + 0 W → AUS laut Plan**, der alte Thermal-Planner darf nicht einschalten.

## 7. Legacy-Fallback

Der bestehende Thermal-Planner (`planner.intent.thermal.commanded_stage`) bleibt als **temporärer Fallback** erhalten.

Fallback nur bei fehlendem, ungültigem, abgelaufenem oder nicht zuordenbarem Daily Plan — **nicht** bei gültigem Plan mit bewusst 0 W Allocation.

## 8. Safety und FSM

Unverändert: Fault-Erkennung, Lockout, Relaisfeedback, Leistungsfeedback, Chatter, Mindestlaufzeit, Mindestpause, Temperaturgrenzen, Write-Gates.

Endgültige Entscheidung:

```text
Daily-Plan-Freigabe ∧ technische Runtimebedingungen ∧ Safety ∧ Write-Gates
```

## 9. Dryrun und Live

- **Dryrun:** Daily Plan lesen, Allocation auswerten, Runtime-States schreiben, keine Fremd-State-Writes
- **Live:** gleiche Auswertung, bestehende Write-Gates und `applyStageWrites`

## 10. Runtime-State-Pfade

Unter `addons.immersion_heater.runtime.*`:

| State | Bedeutung |
|---|---|
| `decision_source` | `manual_off`, `manual_force`, `daily_plan`, `thermal_fallback`, `safety`, `fault`, `lockout`, `safe_default` |
| `daily_plan_status` | z. B. `daily_plan_valid`, `daily_plan_zero_allocation`, `fallback_active` (via ungültig → Fallback) |
| `daily_plan_revision` | Revision des Daily Plans |
| `daily_plan_slot_start` / `daily_plan_slot_end` | aktueller Slot (ISO) |
| `allocated_power_w` | summierte Allocation |
| `mandatory_allocated_power_w` | Mandatory-Anteil |
| `flexible_allocated_power_w` | Flexible-Anteil |
| `allocation_status` | z. B. `allocated`, `none`, `duplicate` |
| `allocation_reason_de` | deutsche Begründung |

## 11. Verhalten bei Planwechsel

Bei Revision- oder Slotwechsel wird die Allocation neu eingelesen (Cache an Revision gebunden). Mindestlaufzeit/-pause und FSM-Regeln verhindern abruptes Chattering.

## 12. Bekannte Einschränkungen

- Nur Heizstab-Runtime angebunden; Batterie, Wallbox und Klima lesen den Daily Plan noch nicht
- Legacy-Thermal-Planner bleibt vorläufig als Fallback
- Keine KI, keine direkten Relais-Writes aus dem Daily Plan
- AC-Governance-Runtime-Lücke unverändert

## 13. Abgrenzung zu Klima, Wallbox und Batterie

| Add-on | Daily-Plan-Runtime |
|---|---|
| Heizstab | ✅ v0.1.129 |
| Batterie | ❌ unverändert |
| Wallbox | ❌ read-only |
| Klima | ❌ unverändert |

Quelle bevorzugt: `planner.intent.allocation.immersion_heater.plan_json`  
Slot-Helfer: `src/operator/daily_plan/slots.ts` (`slotStartIsoFloored`)
