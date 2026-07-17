# EMS-Light Phase 3E — Automatic Triggers, Candidate Pipeline, Takeover Prep

Version: **0.1.143** (Branch `refactor/v0.1.143-on-demand-planner`)

## 1. Ziel

Kontrollierbarer automatischer Shadow-Betrieb plus weitere Pure-Planner-Stufen im Worker bis zu einem normalisierten Plan-Kandidaten. **Keine** produktive Planner-Übernahme.

## 2. Native Betriebsart

Admin-Key: `planner_runtime_mode`

| Wert | Bedeutung |
|------|-----------|
| `off` (Default) | Kein Worker, keine Auto-Trigger, manuelle Trigger → `planner_disabled` |
| `shadow_manual` | Nur manuelle/Force-Trigger |
| `shadow_auto` | Manuell + State-/Schedule-/Startup-Trigger |

- Ungültige Werte → `off` (geklampt, Diagnose-Log)
- Altes `planner.coordinator.shadow_enabled=true` aktiviert **nichts**, wenn native `off`
- Session-Override (`shadow_enabled`) kann bei native shadow_* temporär pausieren; verändert nie die Native-Config
- Session-Override wird beim Adapterstart verworfen; bei native shadow_* wird die Session automatisch ge-armed
- Sichtbar: `planner.coordinator.configured_mode` / `effective_mode`

## 3. Triggerklassen

`configuration`, `mapping`, `forecast`, `price`, `telemetry`, `constraint`, `learning`, `schedule`, `startup`, `manual`, `manual_force`

Modul: `src/planner_trigger/` (leichtgewichtig, keine schweren Planner-Imports).

Denylist verhindert Selbstschleifen (`planner.coordinator.*`, Forecast-/Daily-Outputs, …).

## 4. Entprellung / Coalescing / Schedule

Konstanten:

- Debounce / Quiescence: 15 s
- Mindestabstand Auto-Jobs: 60 s
- Max Delay: 120 s
- Schedule: 15-Minuten-Slot + Tageswechsel
- Startup: nur `shadow_auto`, nach Delay

Force bleibt beim Coalescing sticky. Stop entfernt alle Timer.

## 5. Worker-Stufen (gemeinsame Pure Functions)

```text
Snapshot
  → preparePlannerFromSnapshot (Grid-Supply)
  → collectContributionsFromSnapshot (PV/House/Weather/Constraints/Flex)
  → buildForecastPlan
  → buildDailyPlanFromForecast / Allocation
  → plan_candidate_v1.json
```

In-Process-Referenz und Worker nutzen dieselben Core-Funktionen (`src/planner_candidate/`).

## 6. Candidate-Bereich

`ems-runtime.<instance>/planner/candidate/<jobId>/plan_candidate_v1.json`

Nicht kanonisch, nicht von Runtimes konsumierbar. Kanonischer Publish bleibt für Simulation gesperrt.

## 7. Publish-Policy

`PlannerPublishTarget`: `none` | `candidate` | `canonical`

Phase 3E: nur `none`/`candidate`. `canonical` erfordert mehrere unabhängige Gates (`productiveTakeoverMode`, offene `releaseGate`, non-simulation, …) — in 3E permanent geschlossen.

## 8. Semantischer Vergleich

`comparePlanCandidates`: Horizont, Slots, Preise, Constraints, Allocations, Totals.
Status: `matched` | `mismatch` | `not_comparable` | `validation_failed` | `worker_failed` | …

Kompakte States: Status, Domäne, Slot-Anzahl, gekürzte Revisionen — keine großen Diff-JSONs.

## 9. Lazy Loading

- `off` / `shadow_manual` ohne Trigger: keine schweren Module
- Trigger-Collector bleibt leicht
- Schwere Module erst bei tatsächlichem Coordinator-Lauf

## 10. Grenzen Phase 3E

- Kein kanonisches Publish
- Keine Runtime-Nutzung des Candidates
- Kein Live-Write aus Worker
- Bisheriger In-Process-Planner bleibt produktiv

## 11. Nächste Phase (Vorschlag)

- Mehrfaktor-Takeover-Gate + Dual-Run
- Admin-Feinsteuerung Debounce/Intervalle
- Erweiterte Parität (Text-unabhängige Reason-Codes)
- Candidate-Retention/Pruning
