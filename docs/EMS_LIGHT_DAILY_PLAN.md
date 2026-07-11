# EMS-Light — Daily Plan und Allocation Engine

**Stand:** v0.1.128

## 1. Zweck des Daily Plans

Der Daily Plan entscheidet deterministisch für den **aktuellen lokalen Tag** (ab jetzt bis Tagesende):

- welche Contributions teilnehmen,
- welcher Bedarf Pflicht- oder flexibel ist,
- welche Leistung je 15-Minuten-Slot zugeteilt wird,
- aus welcher Quelle (PV-Überschuss oder Netz),
- welcher Bedarf nicht erfüllt werden kann und warum.

Es handelt sich um **Planungs- und Vorschauwerte** — noch kein Runtime-Dispatch.

## 2. Abgrenzung zum Forecast Plan

| Forecast Plan | Daily Plan |
|---------------|------------|
| Erwartungen über Horizont | Entscheidung für heute |
| Feste Bilanz PV − Hauslast | Allocation an flexible Verbraucher |
| Keine Zuteilung | Konkrete Leistungs-/Energiezuweisung |
| Inkl. morgen / PV-Tage 3–7 | Nur Rest des aktuellen Tages |

Pipeline:

```text
Forecast Plan + Contributions + Global Mode + Policy + Constraints
→ Allocation Engine → Daily Plan → planner.intent.daily_plan.*
```

## 3. Allocation Engine

Modul: `src/operator/daily_plan/allocation.ts`

Phasen:

1. **Mandatory** — zuerst (z. B. `immersion_heater.mandatory`)
2. **Deadline** — Wallbox EV Session mit Deadline
3. **Flexible** — Battery Charge, Immersion Flexible, Klima-Units

Energiequellen in v0.1.128:

- `pv_surplus` — nur bei echtem zeitaufgelösten PV-Überschuss
- `grid` — nur bei Freigabe und verfügbarem Importlimit
- `mixed` — Kombination
- **Keine Batterieentladung** als Quelle

## 4. Planungshorizont und Slots

- **15-Minuten-Slots** ab Beginn des aktuellen Slots bis lokales Tagesende
- Keine Slots nach Tagesende, keine Neubewertung vergangener Slots
- Zeitzone aus Adapter-Config (`intentAdminConfigFromAdapter`)
- Fehlende Werte = `null`, nicht `0`

## 5. Feste Bilanz

```text
fixedBalancePowerW = pvForecastPowerW − fixedHouseLoadPowerW
availablePvSurplusPowerW = max(0, fixedBalancePowerW)
```

Nur wenn beide Eingangswerte vorhanden. Tages-PV-kWh werden **nicht** künstlich auf Slots verteilt.

## 6. PV- und Grid-Verfügbarkeit

**Netzimport pro Slot:**

```text
remainingGridImportPowerW = max(0, effectiveImportLimitW − fixedHouseLoadPowerW)
```

- `effectiveImportLimitW` = Minimum aus globalem Importlimit und Hausanschlusslimit
- Hauslast im Slot unbekannt → kein freies Grid annehmen

## 7. Mandatory-Bedarf

- Höchste Priorität
- PV bevorzugt, Grid nur bei `gridEligible` und Policy-Freigabe
- Global Mode `off`: dokumentiert, aber nicht alloziert

## 8. Deadline-Bedarf

Wallbox `wallbox.ev_session`:

- Mindestleistung aus Restenergie ÷ verbleibende Slotzeit bis Deadline
- Günstigere Grid-Slots bevorzugt (Preis)
- `connected = false` → ausgeschlossen, kein Planfehler

## 9. Flexible Bedarfe

- Policy-Reihenfolge aus `global_policy_energy_priority_json`
- PV-first Contributions (Immersion Flexible) nur aus PV
- Keine künstliche Zeitverteilung bei fehlenden Slotfenstern → `unallocated`

## 10. Policy-Prioritäten

Reihenfolge:

1. mandatory
2. forced / Betreiberbefehl
3. Deadline
4. effektive Betreiberpolicy (`energyPriority`)
5. `priorityBand`
6. alphabetische `contributionId` (Tie-Breaker)

Contribution-ID hat Vorrang vor Add-on-ID in der Policy-Liste.

## 11. Mutual Exclusions

Aus `global_policy_mutual_exclusions_json`:

- Pro Slot, primär für **Grid-Allocation**
- Höher priorisierter Beitrag gewinnt
- PV nicht gesperrt, wenn Policy nur Grid ausschließt
- Ungültige Regeln werden ignoriert (Plan ggf. `degraded`)

## 12. Technische Constraints

- Maximalleistung je Contribution
- Importlimit je Slot
- Global Mode und `gridImportAllowed`
- Mutual Exclusions

## 13. Unallozierter Bedarf

`planner.intent.daily_plan.unallocated_json` — pro Contribution:

- angeforderte / allozierte / fehlende Energie
- deutscher Grund (kein PV-Slot, Netz gesperrt, Limit, Exclusion, …)

## 14. State-Pfade

**Daily Plan:** `planner.intent.daily_plan.*`

**Allocation pro Add-on:** `planner.intent.allocation.{battery|wallbox|immersion_heater|air_conditioning}.*`

Semantische Revision — reine Timestamp-Änderung erhöht Revision nicht.

## 15. Revisionslogik

`dailyPlanRevisionPayload()` — stabil ohne `generatedAt`.

## 16. Read-only / Planungsstatus

- **Heizstab-Runtime (v0.1.129):** liest Daily-Plan-Allocation als Leistungsobergrenze im Auto-Modus; siehe `docs/EMS_LIGHT_IMMERSION_DAILY_PLAN_RUNTIME.md`
- **Klima-Runtime (v0.1.130):** liest Daily-Plan-Allocation pro Unit + Governance-Gate; siehe `docs/EMS_LIGHT_AC_DAILY_PLAN_RUNTIME.md`
- **Wallbox (v0.1.133):** Daily-Plan-Allocation → neutraler Dryrun-Dispatch (Intent, Ziel, Mapping-Readiness); siehe `docs/EMS_LIGHT_WALLBOX_DRYRUN_DISPATCH.md`
- **Batterie-Laden (v0.1.132):** Daily-Plan-Allocation als Ladeleistungsfreigabe; siehe `docs/EMS_LIGHT_BATTERY_DAILY_PLAN_RUNTIME.md`
- Batterie-Entladung weiterhin unsupported
- Keine direkten Geräte-Writes aus dem Daily Plan selbst
- Legacy-Thermal-Planner bleibt als Fallback für Heizstab

## 17. Noch nicht vorhanden

- Batterie-Entladesteuerung / `battery.discharge` Dispatch
- KI-Optimierung
- Statistikvergleich
- Observe-Modus
