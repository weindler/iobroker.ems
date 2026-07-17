# EMS-Light Phase 3F — Controlled Candidate Takeover Gate / Dual Run

Version: **0.1.143** (Branch `refactor/v0.1.143-on-demand-planner`)

## 1. Begriffe

| Begriff | Bedeutung |
|---------|-----------|
| **Authoritative Plan** | Einmalig berechnetes Dual-Run-Ergebnis der In-Process-Pipeline für denselben Snapshot/Generation; Vergleich nutzt genau diese gespeicherte Projektion. Operativer Publish der Geräte-Runtimes bleibt der bestehende Planner-Pfad. |
| **Candidate Plan** | Worker-Ergebnis unter `ems-runtime.<instance>/planner/candidate/` |
| **Dual Run** | Korrelierter Lauf: authoritative Projektion + Candidate + Vergleich + Evidence |
| **Takeover Evaluation** | Bewertung der technischen Readiness — **keine** Umschaltung |
| **Takeover** | Produktive Worker-Übernahme — **nicht in Phase 3F** |

## 2. Native Konfiguration

`planner_takeover_evaluation_mode`: `disabled` (Default) | `observe`

- Ungültig → clamp `disabled`
- Effektiv nur bei `planner_runtime_mode = shadow_auto`
- Bei `off` / `shadow_manual` → effektiv `disabled`, Status `not_evaluated`
- Force-/Manual-Läufe: diagnostischer Vergleich möglich, **keine** Evidence-Eligibility

## 3. Dual-Run-Ablauf

```text
Trigger (shadow_auto)
  → Snapshot (einmal)
  → Authoritative Berechnung genau einmal
       (computeAuthoritativeDualRunProjection → gespeicherte Projektion)
  → Worker (simulation) → Candidate-Datei
  → Vergleich nutzt die gespeicherte authoritative Projektion
       (kein erneutes buildPlanCandidateFromSnapshot auf der Referenzseite)
  → Korrelation (Generation, Input-Revision, Horizont, Slotdauer, Schema)
  → Evidence-Update (nur observe)
  → kompakte States
```

Die authoritative Seite des Dual Runs ist die **einmalige** In-Process-Berechnung für diesen Lauf.
Vergleich und Evidence **wiederverwenden** dasselbe Objekt; sie erzeugen keine zweite Referenzberechnung.

Fehlgeschlagene authoritative Berechnung oder fehlgeschlagenes Publish-Seal → `authoritative_failed`.
Solche Läufe sind **nicht** eligible für positive Matches / `ready`.

Bestehendes kanonisches Publish des Produktiv-Planners wartet **nicht** auf den Worker.
Fehler im Dual-Run/Evidence-Pfad sind isoliert.

## 4. Normalisierung

Gemeinsamer Vertrag `NormalizedPlannerPlan` (UTC-ISO ohne Subsekunden, Watt ganzzahlig, Energie/Preise kanonisiert).
Nicht im Hash: Job-ID, Pfade, `generatedAt`, freie Texte, Laufzeiten.

## 5. Evidence

Datei: `ems-runtime.<instance>/planner/takeover/evidence_v1.json`

Zustände: `not_evaluated` | `collecting` | `ready` | `blocked`

Konservative Readiness (Defaults):

- ≥ 96 eligible Runs
- ≥ 96 consecutive Matches
- ≥ 24 h Observation
- ≥ 2 distinct UTC days
- ≥ 1 Slot-Transition und ≥ 1 Day-Transition
- 0 Mismatches / 0 Failures in der Serie
- letzter eligible Lauf nicht stale

`ready` heißt nur: Beobachtungskriterien erfüllt — **keine Freigabe**.

## 6. Canonical-Sperre

- `PlannerPublishTarget` / `resolvePlannerPublishTarget` bleibt hart geschlossen
- Capability `CanonicalPublishPermit` — **kein** produktiver Mint in 3F
- `resolvePlannerTakeoverDecision`: `canonicalAllowed` immer `false`
- State `planner.takeover.canonical_allowed` immer `false`

## 7. Retention

Candidate-Root: Alters-/Anzahl-/Größenlimit; aktive Jobs geschützt; canonical unberührt.

## 8. Nächste Phase (nicht 3F)

Mehrfaktor-Freigabe, Permit-Mint nur unter unabhängigen Gates, Canary, produktiver Takeover — jeweils bewusst getrennte Schritte.
