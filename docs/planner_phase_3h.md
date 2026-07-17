# EMS-Light Phase 3H — Controlled Authoritative Worker Takeover (Dryrun)

Version: **0.1.143** (Branch `refactor/v0.1.143-on-demand-planner`)

## Legacy vs Worker-Dryrun

| Zustand | Bedeutung |
|---------|-----------|
| `legacy` | Legacy-Planner autoritativ |
| `worker_pending` | Source `worker_dryrun` konfiguriert, noch keine Aktivierung |
| `worker_dryrun` | Worker-Plan autoritativ — **nur** bei `execution_mode=dryrun` |
| `legacy_fallback` | Worker widerrufen; Session-Latch blockiert Auto-Reaktivierung |

Native Config `planner_authoritative_source` allein aktiviert **niemals** Worker.

## Pilot-Readiness

Konservative Schwellen (getrennt von voller 96/24h-Evidence):

- 8 eligible Runs, 8 consecutive Matches
- 30 min Observation, ≥1 Slot-Transition
- 0 Mismatches/Failures, letzter Lauf ≤20 min

Takeover-Readiness für Prepare/Activate ist ein **inklusives ODER**:

```text
takeoverReady = fullEvidenceReady || dryrunPilotReady
```

Beide `true` bleibt erlaubt. Nur für Worker-Dryrun — niemals für Live.

## Activate-Ablauf

1. Phase-3G Prepare → Challenge → Confirm → Grant
2. `planner.authority.activate_worker_dryrun` (ack=false)
3. Capability (scope `worker_dryrun`) aus Grant
4. Lease (TTL 24h, In-Memory)
5. Candidate → Worker-Canonical → Read-back → Authority-Pointer
6. Effektive Quelle `worker_dryrun`

## Scoped Capability / Lease / Permit

- Capability: nur aus gültigem Grant + aktuellen Bedingungen; scope fest `worker_dryrun`
- Lease: Hauptprozess only, kein Restart-Überleben
- Permit: einmalig pro Candidate-Publish; bei Fehler → Legacy-Fallback

## Fallback

Deterministisch: Latch → Publish sperren → Lease/Permit invalidieren → Pointer auf Legacy → Legacy-Lauf anfordern.

Keine automatische Reaktivierung in derselben Session.

## Neustart / Live

- Restart → immer `worker_pending` / `legacy`, nie automatische Lease
- `execution_mode ≠ dryrun` → sofortiger Fallback

## Speicher

Im Worker-Modus: kein routinemäßiger Legacy-Planner; keine großen Plan-JSON-States; Worker endet nach Job.

## Live bleibt unmöglich

`worker authority + execution_mode != dryrun = unmöglich`
