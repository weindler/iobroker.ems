# EMS-Light Phase 3D — Shadow Runtime & Controlled Trigger

Version: **0.1.143** (Branch `refactor/v0.1.143-on-demand-planner`)

## 1. Shadow-Zweck

Phase 3D aktiviert erstmals einen **kontrollierten Shadow-Pfad** neben dem produktiven In-Process-Planner:

```text
explizite Aktivierung → manueller Trigger → PlannerOnDemandCoordinator
  → Snapshot v2 → Worker (simulation) → prepared_input_v1.json
  → Paritätsvergleich (Grid-Supply-Stufe) → kompakte Diagnose-States
```

Der bestehende Planner bleibt alleiniger produktiver Planner. Der Shadow-Worker publiziert keine kanonischen Pläne und beeinflusst keine Geräte.

## 2. Standard-Disabled-Regel

- `planner.coordinator.shadow_enabled` default: **`false`**
- **Jeder Adapterstart** setzt Shadow und Coordinator intern auf **deaktiviert** und schreibt den State auf `false` zurück
- Aktivierung allein startet **keinen** Worker
- Restore aktiviert Shadow **nicht** automatisch

### Wichtig: Keine dauerhafte Admin-Einstellung in Phase 3D

`planner.coordinator.shadow_enabled` ist in Phase 3D **kein** persistierter Produktiv-Schalter und **keine** dauerhaft wirksame Konfiguration.

| Aspekt | Phase 3D |
|--------|----------|
| Semantik | **Laufzeit-Freigabe** für die aktuelle Adapter-Session |
| Nach Neustart / Update / Restore | immer **`false`** — unabhängig vom zuletzt gespeicherten State-Wert |
| Persistenz im Objektbaum | State existiert (ioBroker-Objekt), wirkt aber **nicht** als „einmal aktivieren, für immer an“ |
| Dauerhafte Admin-Konfiguration | **nicht** in 3D — geplant für **Phase 3E** (zusammen mit automatischen Triggern und Worker-Übernahme) |

Ein in ioBroker sichtbares `true` aus einer früheren Session wird beim Start **nicht** übernommen. Shadow muss nach jedem Adapterstart **explizit erneut** freigegeben werden — bewusste Sicherheitsregel, damit der Shadow-Pfad nie unbemerkt aktiv bleibt.

## 3. Aktivierungsmechanismus

**Laufzeit-Control-State** (nicht Admin-Konfiguration):

```text
planner.coordinator.shadow_enabled  (write: true, default: false)
```

Bei bewusster Benutzeranforderung während einer laufenden Session (`ack !== true`):

- `true` → `coordinator.enable()` (Coordinator-State → `idle`); startet **keinen** Job
- `false` → `coordinator.disable({ interruptActive: true })` (laufender Shadow-Job wird kontrolliert beendet, kein Pending-Rerun)

Beim Adapterstart (`initPlannerShadowRuntime`):

- Coordinator bleibt intern deaktiviert
- `shadow_enabled` wird auf **`false`** gesetzt (Startup-Reset, keine Wiederherstellung alter Werte)

API: `setPlannerOnDemandCoordinatorEnabled(enabled)` in `compose.ts`.

## 4. Manueller Trigger

```text
planner.coordinator.manual_trigger  (role: button)
```

- Nur `val === true && ack !== true`
- Button wird sofort auf `{ val: false, ack: true }` zurückgesetzt
- Shadow deaktiviert → Skip `planner_disabled`, kein Snapshot/Worker
- Shadow aktiviert → `coordinator.request({ reason: "manual", force: false })`

## 5. Force-Trigger

```text
planner.coordinator.manual_force_trigger  (role: button)
```

Identisches Button-Verhalten, aber `force: true` (umgeht `unchanged_input`-Dedup).

## 6. Keine automatischen Trigger

In Phase 3D **nicht** angebunden:

- State-Änderungen, Preis/Wetter/Lern-/Policy-Änderungen
- Scheduler, Cron, Startup-Lauf, KI-Anforderung

Triggergründe `relevant_change`, `scheduled`, `ai_request`, `startup_recovery` existieren im Vertrag, sind aber ohne produktive Quelle.

## 7. In-Process-Referenz

Referenzpfad für den Vergleich (gleicher Snapshot, neutraler Kern):

```text
Snapshot → gridSupplyBuildInputFromSnapshot → buildGridSupplyForecast → projectionFromSnapshot
```

Keine Operator-Runtime, keine State-Writes, keine Geräte-Runtime.

Optional: `recordGridSupplyShadowReference()` in `reference_store.ts` für Tick-Referenzen (nicht für den primären Shadow-Vergleich in 3D).

## 8. Worker-Projektion

```text
Snapshot → Worker → prepared_input_v1.json → projectionFromPreparedInput
```

## 9. Vergleichsrevision

SHA-256 über kanonisches JSON (`sortKeysDeep` + stabile Slot-Reihenfolge):

- `referenceRevision` — In-Process-Projektion
- `workerRevision` — Worker-Prepared-Projektion

In ioBroker-States gekürzt auf 12 Hex-Zeichen (`shortenRevision`).

## 10. Vergleichsstatus

| Status | Bedeutung |
|--------|-----------|
| `not_available` | Initial / kein Lauf |
| `matched` | Fachlich identisch |
| `mismatch` | Abweichung in Grid-Supply-Projektion |
| `reference_missing` | Keine gespeicherte Referenz |
| `reference_time_mismatch` | Unterschiedliche Zeitachse |
| `worker_failed` | Worker/Validierung fehlgeschlagen |
| `comparison_failed` | Technischer Vergleichsfehler |

Kompaktes Ergebnis: Status, Mismatch-Anzahl, erstes abweichendes Feld, gekürzte Revisionen — **keine** vollständigen Slot-Arrays in States.

## 11. Kompakte ioBroker-States

Gruppe `planner.coordinator.*` — ausschließlich primitive Werte (boolean, number, string).

Diagnose-States werden über `subscribeStatus` → `writePlannerCoordinatorStatusStates` geschrieben (read-before-write via `setStateIfChanged`).

## 12. Lazy Loading

Phase-3C-Garantie bleibt:

- Shadow deaktiviert + kein Trigger → keine schweren Module (`runtime_factory`, Worker, Preparation, Snapshot-Builder)
- Erster erlaubter Trigger lädt Runtime lazy über `compose.ts`
- `initPlannerShadowRuntime` lädt nur leichte Module (States, Status-Brücke)

## 13. Simulation ohne Publish

Worker-Jobs laufen mit `mode: "simulation"`. `PlannerJobLifecycle` überspringt kanonischen Publish. Keine Forecast-/Daily-Plan-Artefakt-Überschreibung.

## 14. Fehlerfälle

| Situation | `last_result` | `comparison_status` |
|-----------|---------------|---------------------|
| Erfolg + matched | `success` | `matched` |
| Erfolg + mismatch | `success` | `mismatch` |
| Disabled | `skipped` | unverändert |
| Unchanged input | `skipped` | **letzter Vergleich bleibt** |
| Worker-Fehler | `failed` | `worker_failed` |

## 15. Shutdown

Reihenfolge in `stopEmsLightPhase1`:

1. `stopPlannerShadowRuntime` — Unsubscribe, Status-Listener entfernen, Coordinator deaktivieren
2. `stopPlannerOnDemandCoordinator` — Worker beenden, Queue abwarten, `stopped`

Keine State-Writes nach `unloadStopped`.

## 16. Bestehender Planner bleibt produktiv

`runPlannerRuntime` / produktive Ticks unverändert. Shadow-Pfad ist isoliert.

## 17. Keine Gerätewirkung

Keine Operator-Writes, keine Geräte-Runtime aus Shadow, kein Execution-Mode-Wechsel.

## 18. Grenzen von Phase 3D

- Nur manueller (optional Force-) Trigger
- Vergleich nur Grid-Supply-Stufe
- Kein produktiver Planner-Wechsel auf Worker
- Keine KI-/Scheduler-Anbindung
- Keine Plan-Übernahme aus Worker-Output

## 19. Geplanter Scope Phase 3E

- **Dauerhafte Admin-Konfiguration** für `shadow_enabled` (persistente Freigabe über Neustarts hinweg, sofern fachlich gewünscht)
- Automatische Trigger (relevant_change, scheduled, …)
- Optional: erweiterte Parität über weitere Preparation-Stufen
- Entscheidung über schrittweise Produktivübernahme
- ioBroker-Admin-UI für Shadow-Konfiguration (falls gewünscht)
