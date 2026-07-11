# EMS-Light — General-Operator-Grundlage

**Stand:** v0.1.128

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

### House Load Contribution

- Quellen: `learning.house_load.*`
- Segment-Baselines mit definierten Zeitgrenzen (`SEGMENT_HOURS`)
- Keine feinere Auflösung innerhalb von Segmenten

### Weather Contribution

- Kontext only — keine kWh-Bilanz
- Rolle `context` wird nicht mit `supply` verrechnet

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

## Stand nach v0.1.128

Implementiert:

- Operator-Typen mit Add-on- und System-Contributors, `contributionId`, `flow`
- PV-, Hauslast-, Wetter-, Constraint-Contributions
- Flexible Contributions für Batterie, Wallbox, Heizstab, Klima
- Deterministischer Forecast Plan mit flexiblen Beiträgen (feste Bilanz unverändert)
- **Daily Plan mit zentraler Allocation Engine** (v0.1.128)
- Tests für Contributors, flexible Add-ons, Forecast Plan und Daily Plan

Noch nicht implementiert:

- Wallbox-Live-Dispatch / EVCC-Writes
- Batterie-Entladung
- Vollständige Abschaltung alter Einzelplanner
- KI-Optimierung
- Drei-Szenarien-Statistik

Runtime-Dispatch aus Daily Plan (Stand v0.1.132): Heizstab, Klima, Batterie-Laden aktiv; Wallbox read-only diagnostisch.
