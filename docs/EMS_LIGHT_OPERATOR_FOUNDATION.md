# EMS-Light — General-Operator-Grundlage

**Stand:** v0.1.205 (Roadmap-Block 5 „Horizont + State-Cleanup" abgeschlossen, siehe `docs/EMS_LIGHT_ROADMAP.md`)

## Ziel

Der General Operator führt Supply, Demand, Constraints und Dispatch aller Add-ons in **einen** deterministischen Plan zusammen — ohne parallele Sonderplanner pro Gerät.

## Trennung der Schichten

| Schicht | Aufgabe |
|---------|---------|
| Learning / Forecasts | Beobachtung, Prognosen, Qualität |
| Policy | Betreiberregeln, Prioritäten, Grenzen |
| Forecast Plan | Erwartete Energie/Preise über Horizont |
| Daily Plan | Tagesbilanz und Ziel-Allocation |
| Allocation | Konfliktauflösung, wer bekommt PV/Netz |
| Runtime | neutrale Intents ausführen |
| Profil | herstellerspezifische Writes |
| KI (optional) | Optimierung innerhalb gültiger Pläne |

## PlanContribution (Grundtypen)

Definiert in `src/operator/types.ts`:

- `PlanRole` — supply, demand_fixed, demand_flex, constraint, storage, dispatch, infrastructure, **context**
- `PlanSlotContribution` — Leistung/Energie/Preis pro Zeitfenster
- `PlanContribution` — Beitrag mit stabiler `contributionId`, `flow` (`consume` | `provide` | `constraint` | `context`), `contributor`-Referenz, Rollen, Qualität, `reason_de`, Revision

## Add-on- und System-Contributors

```ts
type OperatorContributorType = "addon" | "system";

type OperatorSystemContributorId = "house_load" | "grid_supply" | "global_constraints";

interface OperatorContributorRef {
    type: OperatorContributorType;
    id: EmsAddonId | OperatorSystemContributorId;
    addonId: EmsAddonId | null;
}
```

- Add-on-Contributions referenzieren ausschließlich IDs aus `src/operator/registry.ts` (19 Add-ons).
- System-Contributions (`house_load`, `grid_supply`, `global_constraints`) sind **nicht** in der Add-on-Registry.
- Hauslast ist bewusst **kein** Add-on.

Hilfsfunktionen: `src/operator/contributor.ts`.

## Contributions (v0.1.127)

Modul `src/operator/contributions/`:

| Datei | Contributor | Rolle |
|-------|-------------|-------|
| `pv.ts` | `pv_forecast` | supply (`pv_forecast.supply`) |
| `house_load.ts` | `house_load` (System) | demand_fixed |
| `weather.ts` | `weather_forecast` | context |
| `constraints.ts` | `house_main_fuse`, `global_constraints`, `grid_supply` | constraint / infrastructure |
| `flexible/*` | battery, wallbox, immersion_heater, air_conditioning | demand_flex, storage, constraint |

Siehe `docs/EMS_LIGHT_FLEXIBLE_CONTRIBUTIONS.md` für flexible Add-ons.

State-Leser → normalisiertes Build-Input → reine Builder-Funktion → `PlanContribution`.

### PV Contribution

- Quellen: `learning.pv_bias.*`, `learning.pv_horizon.*`
- Tages-kWh in `details`; keine künstlichen 15-Min-PV-Slots
- Echter Nullertrag nur bei gültiger Quelle mit Wert `0`
- `details.horizonDays` deckt Tag 0–7 ab (Tag 3–7 aus `learning.pv_horizon.day3-7.*`)

### House Load Contribution

- Quellen: `learning.house_load.*`
- Segment-Baselines mit definierten Zeitgrenzen (`SEGMENT_HOURS`)
- Keine feinere Auflösung innerhalb von Segmenten
- **v0.1.201:** `details.horizonDays` — Tag 3–7 aus `learning.house_load.forecast_horizon_json`
  (`buildDayForecast(acc, dayOffset)` mit `dayOffset` 2–6, gleiche Saison/Wochentag/Day-Type-
  Musterlogik wie „morgen" — kein Fake-Wert, nur weiter in die Zukunft projiziertes Muster)

### Weather Contribution

- Kontext only — keine kWh-Bilanz
- Rolle `context` wird nicht mit `supply` verrechnet
- `weatherMinTempC`/`weatherMaxTempC` pro Forecast-Plan-Tag; Tag 3–7 aus
  `learning.weather.horizon.*` bei gültigem Admin-Mapping (Block 9), sonst `null`

### Constraint Contribution

- Hausanschlussgrenze, Netzimportlimit, effektives Limit, Import erlaubt/gesperrt
- Noch **kein** Abzug aktueller Hauslast vom Sicherungslimit

## Forecast Plan

Siehe `docs/EMS_LIGHT_FORECAST_PLAN.md`.

- Builder: `src/operator/forecast/build.ts`
- States: `planner.intent.forecast_plan.*`
- Tick: nach Grid Supply in `ems_light/tick.ts`

### Teilnahme- und Ausschlussregeln

- Aktiv nur bei vorhandenen, gültigen Daten
- Fehlende Contributors unter `excludedContributors` — nicht als Null bilanziert
- Status `ready` / `degraded` / `missing_inputs` gemäß Pflichtquellen PV + Hauslast

## Add-on-Registry

`src/operator/registry.ts` — alle 19 `EMS_ADDON_IDS` mit Rollen und Metadaten. Registry beschreibt Fähigkeiten, nicht den Live-Aktivierungszustand.

## Grid Supply

`src/operator/supply/grid.ts` — jahreszeitneutrale Netz-/Preis-Schicht (v0.1.125), eingebunden als System-Contributor `grid_supply`.

**Preisquellen-Priorität (v0.1.201):** `dynamic_tariff` (Tibber o. ä.) → `price_learning_fallback`
(gelernter Ø-Preis aus `learning.price_learning.avg_price_7d/30d/90d`, synthetische 15-Min-Slots
für 48 h) → `fixed_tariff` → `none`. Der Learning-Fallback greift nur, wenn keine dynamischen
Slots vorliegen — kein Überschreiben echter Tarifdaten.

## Learning-Integration in flexiblen Contributions (Block 1, v0.1.201)

- **Heizstab** (`immersion_heater`): `src/operator/contributions/flexible/thermal_learning.ts`
  liest `learning.thermal_runtime.*` (Kühlrate, `estimated_empty_at`, Tages-Typ-Median-Laufzeit).
  Bei validem Learning wird `estimated_empty_at` als `deadlineIso` der flexiblen Contribution
  gesetzt und eine kleine Verlust-Marge in `estimateImmersionRequiredEnergyKwh` berücksichtigt.
  Ohne Learning-Daten bleibt die bisherige Physik-Schätzung als Fallback aktiv.
- **Batterie** (`battery`): `src/operator/contributions/flexible/battery_learning.ts` liest
  `learning.battery_runtime.*` (Nachtentladung, Ladeleistung, `topoff_due`). Ist ein gelerntes
  Top-Off-Intervall überschritten, wird `chargeTargetSocPct` automatisch auf 100 % gesetzt —
  unabhängig vom expliziten `topOffRequested`-Flag.
- Beide Signale sind `valid` / `degraded` / `missing` und werden vollständig in `details`
  gespiegelt (Transparenz) — kein Blackbox-Verhalten.

## Batterie-Lade-Logik (Roadmap Block 2, v0.1.202)

Nachfolger von `src/planner/rules/battery_winter.ts` — bewusst **nicht** „Winterlogik"/„Grid
Recovery" genannt: Auslöser ist ein mehrtägiges PV-Defizit (PV-Horizont Tag 0–7 deckt die
Hauslast nicht), das ebenso im Sommer bei mehreren schlechten PV-Tagen auftreten kann.

- `src/operator/contributions/flexible/battery_charge_logic.ts` — reine Bilanz-Funktion
  (`planBatteryChargeLogic`), portiert aus dem Legacy-Planner (Defizit/Reserve/Ziel-Mathematik
  unverändert), liefert nur Energiebedarf (`chargeEnergyKwh`) + Deadline (`bridgeUntilIso`) —
  **keine** eigene Preisfenster-/Slot-Auswahl mehr.
- `src/operator/contributions/flexible/read.ts` liest denselben PV-/Hauslast-Horizont (Tag 0–7,
  Block 1.4) unabhängig von den bereits gebauten Basis-Contributions (Flexible-Tick läuft vor
  dem Forecast Plan).
- Die `battery.charge`-Contribution hebt `chargeTargetSocPct` auf `max(Policy-Ziel,
  chargeLogic.socTargetPct)` an und setzt `deadlineIso = chargeLogic.bridgeUntilIso`, wenn die
  Logik aktiv ist. Die **bereits vorhandene** deadline-basierte Daily-Plan-Allocation
  (preissortiert, siehe `daily_plan/allocation.ts`) übernimmt die Slot-Wahl — dasselbe Muster
  wie die Heizstab-Learning-Deadline aus Block 1.
- In `eco`-Mode schaltet `deficitChargeActive` (aus `chargeLogic.active`) den Netzbezug frei —
  ersetzt das bisherige, extern aus dem Legacy-Planner gelesene `winterGridActive`.
- **Kein Runtime-Umbau nötig:** `src/addons/battery/` bevorzugt `dailyPlanContext.useDailyPlan`
  bereits vor dem Legacy-Fallback (`resolveWinterGridChargeIntent`); da der Daily Plan jetzt auch
  den PV-Defizit-Bedarf kennt, greift der Legacy-Pfad faktisch nur noch, wenn der Daily Plan
  selbst ungültig/fehlend ist.
- Diagnose/Parallel-Vergleich: `chargeLogicActive` (neu) neben `legacyDeficitChargeActive`
  (Zustand von `planner.intent.battery.winter.active`) in den Contribution-Details.
- Admin-Config (`bat_winter_plan_*`) bleibt aus Kompatibilitätsgründen unverändert — nur Labels/
  `reason_de`/VIS-Texte sind auf „Batterie-Lade-Logik" umbenannt.
- Legacy-Dateien (`battery_winter.ts`, `battery_winter_windows.ts`, `battery_winter_config.ts`)
  und States (`planner.intent.battery.winter.*`) sind mit `@deprecated`/„Legacy" markiert —
  Entfernung erst in Roadmap-Block 5.

## Realtime-Fallbacks abgeschaltet (Roadmap Block 3, v0.1.203)

**Ziel:** Add-ons lesen für ihre Steuerentscheidung nur noch Daily Plan + Allocation oder einen
rein lokalen Sicherheits-Default — kein Rückgriff mehr auf den alten Realtime-Planner
(`src/planner/run.ts`, `runPlannerTick`).

- **Heizstab (3.1):** `src/addons/immersion_heater/runtime/engine.ts` liest bei nicht
  verwendbarem Daily Plan (`missing`/`degraded`/`expired`/…) nicht mehr
  `planner.intent.thermal.commanded_stage`/`target_temp_c`. Stattdessen ein lokaler
  Sicherheits-Default: Zieltemperatur = `ih_planning_min_temp_c` (Pflicht-Untergrenze, dieselbe
  Schwelle wie die Operator-Pflicht-Contribution `immersion_heater.ts`), Stufe =
  `ih_force_default_stage` (bereits vorhandener Admin-Key, bisher nur für Force-Modus genutzt).
  `decision_source = thermal_fallback` bezeichnet ab jetzt diesen lokalen Default, nicht mehr den
  alten Planner. `readPlannerThermalStage`/`readPlannerThermalTargetTemp` (`planner/inputs.ts`)
  sind `@deprecated`, ohne Consumer mehr.
- **Klima (3.2):** Bei Prüfung festgestellt, dass `src/addons/air_conditioning/runtime/` **nie**
  `planner.intent.cooling.*` gelesen hat — `climate_fallback` war schon immer die eigenständige,
  lokale Temperatur-/Feuchte-Hysterese-FSM (`fsm.ts`), kein Rückgriff auf den Realtime-Planner.
  Kein Code-Änderungsbedarf, nur Verifikation.
- **Briefing + Diagnose (3.3):** `operator.briefing_de` kommt jetzt aus
  `src/operator/daily_plan/briefing.ts` (`buildOperatorBriefingDe`) — Daily Plan + Allocation des
  aktuellen Slots, statt `formatBriefing()` aus `planner/run.ts` (entfernt). Live-PV-Überschuss/
  -Defizit für Diagnose/VIS kommt aus `src/operator/daily_plan/live_surplus.ts`
  (`buildOperatorLiveSurplus`) direkt aus dem Live-Cache (`live.pv.power_w` /
  `live.battery.pv_ac_power_w` / `live.battery.house_load_w`), kontextualisiert mit dem aktuellen
  Daily-Plan-Slot — neue States `operator.diagnostics.surplus_w`/`deficit_w`/`slot_start_iso`. VIS
  (`vis/generate-ems-view.mjs`) zeigt „Üss" jetzt aus `operator.diagnostics.surplus_w`.
  `planner.surplus_w`/`deficit_w` bleiben als reiner Diagnose-Wert des auslaufenden Realtime-
  Planners bestehen (Legacy, Entfernung erst Block 5), werden von VIS nicht mehr gelesen.
- Der alte Realtime-Planner (`runPlannerTick`) läuft technisch unverändert weiter (Entfernung erst
  Block 4) und schreibt seine `planner.intent.*`-States weiterhin als reine, ungenutzte Diagnose.

## Ein Planner (Roadmap Block 4, v0.1.204)

**Ziel:** Nur noch die Operator-Pipeline pro Tick — kein paralleler Realtime-Planner.

- `runPlannerTick` aus `src/ems_light/tick.ts` entfernt; Produktions-Tick importiert
  `src/planner/run.ts` nicht mehr.
- Planungsregeln: `src/planner/rules/` → `src/operator/planning/` (Thermal/Cooling/Battery/
  Surplus/Batterie-Winter-Hilfsfunktionen); Operator-Contributions und Daily Plan importieren von dort.
- `src/planner/run.ts` bleibt als reine, synchrone `runPlanner()`-Komposition für Unit-Tests —
  schreibt keine States mehr. `runPlannerRuntime` startet nur noch Grid/Forecast/Daily Plan.
- Legacy-Intent-States (`planner.intent.thermal.*`, `cooling.*`, `battery.winter.*`) bleiben bis
  Block 5 als Ensure-Hülle; Produktion beschreibt sie nicht. VIS liest Heizstab/Klima/Batterie-
  Steuerung aus `addons.*.runtime.*`.
- Abnahme: `off_legacy_lazy.test.ts` prüft, dass `/build/planner/run.js` auf dem Tick-Pfad nicht lädt.

## Horizont + State-Cleanup (Roadmap Block 5, v0.1.205)

**Ziel:** Mehr-Tages-Allocation; Legacy-Realtime-Intent-Bäume weg.

- Daily Plan: rollierender Horizont **48 h** ab aktuellem 15-Min-Floor
  (`DAILY_PLAN_HORIZON_HOURS`, `buildDailyHorizonSlots`); `validUntil` = Horizontende.
- Forecast-Slots: PV-Wetterform und Hauslast-Segmente für Horizon-Tage mit vorhandenen
  Prognose-kWh (Tag 0–7 wo Learning liefert) — keine erfundenen Werte.
- Flexible Add-ons (Heizstab, Batterie, Wallbox, Klima) lesen weiter denselben Daily Plan.
- Ensure legt `planner.intent.thermal|cooling|battery.winter` und `planner.surplus_w|deficit_w`
  nicht mehr an; Surface-Cleanup löscht sie auf Alt-Installationen.
- Batterie-Runtime: Manual → Daily Plan → Mirror/Safe-Default (kein Winter-/Planner-Fallback).

## Stand nach v0.1.128

Implementiert:

- Operator-Typen mit Add-on- und System-Contributors, `contributionId`, `flow`
- PV-, Hauslast-, Wetter-, Constraint-Contributions
- Flexible Contributions für Batterie, Wallbox, Heizstab, Klima
- Deterministischer Forecast Plan mit flexiblen Beiträgen (feste Bilanz unverändert)
- **Daily Plan mit zentraler Allocation Engine** (v0.1.128)
- Tests für Contributors, flexible Add-ons, Forecast Plan und Daily Plan

Noch nicht implementiert:

- Wallbox-Live-Dispatch / EVCC-Writes (Control-Pfad teilweise vorhanden)
- Batterie-Entladung
- Drei-Szenarien-Statistik
- Modus `observe`

**KI (seit v0.1.206, Block 6):** optional, Standard aus. Kontext = voller Daily-Plan-Horizont + Learning-Digest.
Slot-Präferenzen erzeugen Plan B; Write-back auf Allocation nur wenn B messbar besser als A ist —
sonst Auto-KI aus (`ai.auto_suspended`). Limits: Tagesaufrufe, Monatskosten, Mindestabstand.
Geräte-Writes nur über bestehende Dryrun/Live-Gates der Runtime.

Runtime-Dispatch aus Daily Plan: Heizstab, Klima, Batterie-Laden aktiv; Wallbox über EVCC-Control.
