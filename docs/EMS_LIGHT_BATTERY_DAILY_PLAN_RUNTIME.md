# EMS-Light — Batterie Daily-Plan Runtime (v0.1.132)

## 1. Ziel

Der unterstützte Batterie-**Ladepfad** (`sonnen_em`) nutzt die aktuelle Daily-Plan-Allocation als **maximale Ladeleistungsfreigabe** im aktuellen 15-Minuten-Slot. Safety, FSM, Feedback, Ownership, Restore und die zentrale `executeBatteryWrite`-Funktion bleiben unverändert.

## 2. Ladepfad only

- `battery.charge` wird ausgewertet
- `battery.reserve` ist Constraint (kein Ladeintent)
- `battery.discharge` bleibt unsupported — wird ignoriert, erzeugt keinen Intent

## 3. Entladung unsupported

Keine Entladewrites, keine negative Leistung, keine `control.discharge`-Capability.

## 4. Entscheidungsreihenfolge

```text
Safety / Fault / Lockout
→ manueller User Intent (manual_override)
→ gültiger Daily Plan (battery.charge)
→ Battery Winter (Fallback)
→ Legacy Planner (Fallback)
→ Grid Balance (Fallback, nur ohne autoritativen Daily Plan)
→ sicherer Grundzustand / Restore
```

## 5. Daily-Plan-Quelle

Bevorzugt: `planner.intent.allocation.battery.plan_json`

Fallback: `planner.intent.daily_plan.plan_json` (nur `battery.charge`)

## 6. Allocation als Ladeleistungsobergrenze

`effective_charge_power_w = min(allocatedPowerW, hardware_max_charge_w)`

## 7. PV / Grid / Mixed

- `pv_surplus` → `charge`, Energiequelle PV
- `grid` → `grid_charge` (Capability `enable_grid_charge` erforderlich)
- `mixed` → Gesamtleistung als Obergrenze, Quelle diagnostisch `mixed`
- `none` / 0 W → keine Ladefreigabe

## 8. Battery Intent und FSM

Daily Plan → `deviceIntentFromDailyPlan()` → `validateBatteryIntent()` → `stepSonnenFsm()` → `executeBatteryWrite()`

Keine direkten Fremd-Writes aus dem Daily-Plan-Leser.

## 9. SOC / Reserve / Top-Off

- Max-SOC aus Limits; bei erreichtem Ziel keine Ladefreigabe
- Top-Off aus resolved Intent (`top_off_requested`) → Ziel 100 %
- Reserve wird nicht unterschritten (keine Entladung)

## 10. Ownership

Request-ID: `daily-plan-{revision}`. Bestehende FSM-Ownership-Logik.

## 11. Restore

Bei Slot-Ende / Intent-Widerruf / 0-W-Plan: bestehende FSM-Restore-Sequenz.

## 12. Battery Winter als Fallback

Nur wenn Daily Plan fehlt, ungültig oder abgelaufen. **Nicht** bei gültigem Plan mit 0 W oder `unallocated`.

## 13. Grid Balance als Fallback

`isBatteryDailyPlanAuthoritative()` blockiert Grid-Balance-Writes solange ein gültiger Daily Plan für den Slot autoritativ ist — auch bei 0 W.

## 14. Gültige 0-W-Planentscheidung

Kein Winter-, Legacy- oder Grid-Balance-Fallback. `daily_plan_blocks_grid_balance = true`.

## 15. Dryrun und Live

Identische Planlogik; Writes nur über bestehende Gates und `executeBatteryWrite`.

## 16. Runtime-States

Unter `addons.battery.runtime.*`: `decision_source`, `daily_plan_authoritative`, `allocated_charge_power_w`, `effective_charge_power_w`, `energy_source`, `legacy_fallback_*`, …

## 17. Cache

Plan-JSON-Cache keyed by revision; Reset bei Modul-Stop.

## 18. Bekannte Einschränkungen

- Entladesteuerung fehlt weiterhin
- `generic_readonly`: Daily Plan nur diagnostisch
- Passive PV-Ladung im Eigenverbrauchsmodus ohne aktiven Write wird diagnostisch erkannt

## 19. Spätere Entladesteuerung

Separater Block für `battery.discharge` / Dispatch — nicht Teil von v0.1.132.

## Abgrenzung

| Add-on | Daily-Plan-Anbindung |
|--------|----------------------|
| Heizstab | aktiv (Leistungsobergrenze) |
| Klima | aktiv (Leistungsobergrenze) |
| Wallbox | read-only Diagnose |
| Batterie Laden | aktiv (v0.1.132) |
| Batterie Entladen | ❌ |
