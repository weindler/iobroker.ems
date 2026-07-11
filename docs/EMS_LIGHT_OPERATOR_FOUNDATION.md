# EMS-Light — General-Operator-Grundlage

**Stand:** v0.1.125

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

- `PlanRole` — supply, demand_fixed, demand_flex, constraint, storage, dispatch, infrastructure
- `PlanSlotContribution` — Leistung/Energie/Preis pro Zeitfenster
- `PlanContribution` — Add-on-Beitrag mit Rollen, Qualität, `reason_de`, Revision

## Add-on-Registry

`src/operator/registry.ts` — alle 19 `EMS_ADDON_IDS` mit Rollen und Metadaten (`canContributeToPlan`, `canDispatch`, `requiresGovernance`). Registry beschreibt Fähigkeiten, nicht den Live-Aktivierungszustand.

## Grid Supply

`src/operator/supply/grid.ts` — jahreszeitneutrale Netz-/Preis-Schicht:

- Eingänge: Dynamic Tariff (Tibber-Slots), aktueller Preis, Policy, Global Mode, Fixed-Tariff-Fallback
- Ausgabe: `GridSupplyForecast` + States unter `planner.intent.supply.grid.*`
- Keine Allocation — nur normalisierte Ressource für Batterie, Wallbox, später WP/EV

Batterie-spezifische Logik (`battery_winter`, `grid_balance`) nutzt dieselbe Slot-Beschaffung über `readTibber15MinPriceSlots` → Grid Supply.

## Stand nach v0.1.125

Implementiert:

- Operator-Typen und Registry
- Grid-Supply-Berechnung und States
- Tick-Integration (`ems_light/tick.ts`)
- Migration der Preis-Slot-Leser für Winter/Grid Balance
- Cursor Rule `.cursor/rules/ems-light-development.mdc`

Noch nicht implementiert:

- Vollständiger Forecast Plan
- Vollständiger Daily Plan
- Zentrale Allocation
- Wallbox-Dispatch
- Batterie-Entladung
- KI-Optimierung
- Drei-Szenarien-Statistik
