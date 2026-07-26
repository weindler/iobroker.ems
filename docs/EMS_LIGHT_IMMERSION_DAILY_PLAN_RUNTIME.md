# EMS-Light — Heizstab Daily-Plan Runtime (v0.1.129, Sicherheits-Default seit v0.1.203)

## 1. Ziel der Runtime-Anbindung

Im Automatikbetrieb liest die Heizstab-Runtime die aktuelle Daily-Plan-Allocation und nutzt sie als **maximale Leistungsobergrenze** für die Stufenauswahl. Safety, Fault/Lockout, Mindestlaufzeit, Mindestpause, Temperaturregelung, Dryrun und Live-Gates bleiben unverändert in der bestehenden FSM.

Der Daily Plan ersetzt keine technische Runtime-Logik und schreibt keine Relais direkt.

**Wiedereinschalt-Hysterese (v0.1.175, verfeinert v0.1.179):** Im Auto-Modus wird erst wieder geheizt, wenn die Puffertemperatur unter `Zieltemperatur − Hysterese (K)` fällt (Feld `ih_temperature_hysteresis_k`, bisher nur im Force-Modus genutzt). Ausschalten bleibt unverändert bei Zielerreichung. Reduziert häufige kurze Ein-/Aus-Zyklen, ohne Mindestlaufzeit/-pause anzufassen. Siehe `src/addons/immersion_heater/runtime/fsm.ts` (Reason `auto_reheat_hysteresis`).

**Wichtig (v0.1.179):** Die Hysterese-Sperre greift nur, wenn das Tagesziel seit dem letzten vollständigen Abkühlen unter `Ziel − Hysterese` auch wirklich erreicht wurde (`persist.autoTargetReached`). Stoppt der Heizstab vorher — z.B. weil der PV-Überschuss kurz einbricht oder die Daily-Plan-Allocation für den Slot auf 0 W fällt, bevor die Puffertemperatur das Ziel erreicht hat — darf das kein dauerhafter Nachheiz-Stopp sein. Ohne diese Unterscheidung lud der Heizstab nie bis zum vollen Tagesziel durch, weil jede frühe Unterbrechung sofort als „Ziel erreicht“ missinterpretiert wurde. Der Flag wird beim Abkühlen unter die untere Schwelle zurückgesetzt.

## 2. Entscheidungsreihenfolge

```text
Safety / Fault / Lockout
→ manueller Off-Befehl
→ manueller Force-Befehl
→ gültige Daily-Plan-Allocation (Auto)
→ lokaler Sicherheits-Default (Pflicht-Untergrenze, kein Realtime-Planner — Roadmap Block 3.1)
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
| **Auto** | Daily Plan prüfen; bei gültigem Plan mit 0 W kein Sicherheits-Default |

Wichtig: **gültiger Daily Plan + 0 W → AUS laut Plan**, der Sicherheits-Default darf nicht einschalten.

## 7. Sicherheits-Default (Roadmap Block 3.1)

Seit v0.1.203 gibt es **keinen Rückgriff mehr auf den alten Realtime-Planner** (`planner.intent.thermal.commanded_stage`/`target_temp_c`). Ist der Daily Plan nicht verwendbar, nutzt `engine.ts` einen rein lokalen Default: Zieltemperatur = `ih_planning_min_temp_c` (Pflicht-Untergrenze, dieselbe Schwelle wie die Operator-Pflicht-Contribution), Stufe = `ih_force_default_stage` (bereits vorhandener Admin-Key). Kein Zugriff auf `planner.intent.*`-States.

`decision_source = thermal_fallback` bezeichnet ab jetzt diesen lokalen Sicherheits-Default, nicht mehr den alten Planner. Fallback nur bei fehlendem, ungültigem, abgelaufenem oder nicht zuordenbarem Daily Plan — **nicht** bei gültigem Plan mit bewusst 0 W Allocation.

Der alte Thermal-Planner (`operator/planning/thermal.ts`) wird seit Block 4 nicht mehr im Produktions-Tick ausgeführt; `planner.intent.thermal.*` bleibt bis Block 5 als unbeschriebene Legacy-Hülle und wird von der Runtime nicht gelesen.

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
