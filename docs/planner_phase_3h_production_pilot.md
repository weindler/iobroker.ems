# EMS-Light Phase 3H — Produktiv-Dryrun-/RAM-Testplan

**Noch keine Installation ausführen**, bis Phase 3H committed und gepusht ist und dieser Plan bewusst gestartet wird.

## Vorbereitung

1. Vollständiges ioBroker-/Backitup-Backup
2. EMS-Konfiguration exportieren
3. Version/Commit dokumentieren (Baseline `v0.1.124`)
4. RAM-Baseline von `v0.1.124` messen (RSS des Adapterprozesses)
5. `global.execution_mode` ausdrücklich `dryrun`
6. Kein Live-Release; relevante Geräte-States dokumentieren

## Installation

1. Neue Version installieren
2. Start: Legacy bzw. `worker_pending` — **keine** automatische Worker-Autorität
3. Startup-Logs prüfen
4. RAM vor Planner-Worker-Läufen messen

## Shadow-/Pilotphase

1. `planner_runtime_mode=shadow_auto`
2. `planner_takeover_evaluation_mode=observe`
3. `planner_authoritative_source=worker_dryrun`
4. Pilot-Readiness sammeln (≥8 Matches, ≥30 min, Slotwechsel)
5. Mismatch-/Failure-Zähler prüfen (müssen 0 bleiben)

## Autorisierung und Aktivierung

1. Prepare → Challenge-ID → Confirm → Grant prüfen
2. `planner.authority.activate_worker_dryrun=true` (ack=false)
3. Prüfen: `effective_authority=worker_dryrun`, `worker_authoritative=true`, `canonical_allowed=true`
4. Weiterhin `execution_mode=dryrun`

## Beobachtung

- Mehrere 15-Minuten-Slots
- Worker-Starts und -Exits (kein dauerhafter Worker)
- RSS vor/nach Jobs / nach Exit über States:
  - `planner.authority.memory.rss_before_worker_job_mib`
  - `planner.authority.memory.rss_after_worker_exit_mib`
  - `planner.authority.memory.last_worker_delta_mib`
  - `planner.authority.memory.legacy_module_loaded`
- Planrevisionen und Dryrun-Dispatches
- **Keine** realen Geräte-Writes

## Fallback-Test

Kontrollierten, ungefährlichen Fehler auslösen (nur mit vorgesehenem Test-Hook / Dev-Modus):

- Takeover fällt auf Legacy
- `fallback_latched=true`
- Keine automatische Reaktivierung
- Legacy-Plan wieder verfügbar

## Abbruchkriterien → zurück auf v0.1.124

- Unerwarteter Live-Write
- Fehlender Legacy-Fallback
- Beschädigte Planner-Daten
- Wiederholte Worker-Crashes
- Stark wachsender RSS
- Blockierter Adapter-Shutdown
- Restore-/Backup-Probleme
- Beeinträchtigung Heizstab / Klima / EVCC
