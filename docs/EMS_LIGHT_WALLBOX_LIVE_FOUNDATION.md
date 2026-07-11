# EMS-Light — Wallbox Live Foundation (v0.1.134)

## 1. Zweck

Die Wallbox-Live-Foundation bereitet den späteren Live-Schreibpfad strukturell vor, **ohne** reale EVCC- oder Wallbox-Writes freizugeben.

## 2. Neutraler Command-Kandidat

Modul: `src/addons/wallbox/runtime/command.ts`

Aus dem finalen Dryrun-Dispatch (`WallboxDryrunDispatchResult`) wird ein `WallboxCommandCandidate` erzeugt:

- Aktion: `none | hold | charge`
- Ziel-Leistung, Ziel-Strom, Energiequelle
- `connected`, `technicallyReady`, `blocked`, `blockReason`
- Revisionen (Dispatch / Daily Plan)

Keine EVCC-Modusnummern, keine Fremd-State-Pfade.

## 3. Zentrale Execution-Schnittstelle

Modul: `src/addons/wallbox/runtime/execute.ts`

- `executeWallboxWrite()` — **einziger** zukünftiger Write-Pfad
- `runWallboxLiveFoundation()` — Orchestrierung nach Dispatch
- `WALLBOX_LIVE_WRITE_RELEASED = false` (fest in v0.1.134)

## 4. Geschlossenes Release-Gate

Auch bei `global.execution_mode = live` und `addons.wallbox.mode = live`:

```text
attempted = false
executed = false
blocked = true
reason = release_gate_closed
```

Die Blockade liegt **innerhalb** von `executeWallboxWrite()`, nicht nur in vorgelagerten Gates.

## 5. Interne Foundation-Phasen (`live_foundation_phase`)

Die Werte `observe | dryrun | live` sind **interne** Live-Foundation-Phasen im State `live_foundation_phase`. Sie sind **kein** globaler EMS-Ausführungsmodus.

Global und Add-on kennen weiterhin nur `dryrun | live` (`execution_mode.ts`). Es wird **kein** Global-Modus `observe` eingeführt.

| Phase | Bedingung | Command-Kandidat | `executeWallboxWrite` |
|-------|-----------|------------------|------------------------|
| `observe` | Add-on oder Governance aus | nein | nicht aufgerufen |
| `dryrun` | Global/Add-on ≠ live | ja (Diagnose) | nicht aufgerufen |
| `live` | Global + Add-on live | ja | aufgerufen, blockiert am Release-Gate |

`live_foundation_phase=observe` bedeutet: keine Foundation-Ausführung (inaktiv), **nicht** dass der globale Runtime-Modus `observe` heißt.

## 6. Connected-Gate

`connected = false` → kein `charge`-Kandidat, Blockgrund `vehicle_disconnected`. SOC 0 bleibt unkritisch.

## 7. Readiness vs. Write-Freigabe

```text
technicallyReady != writeAllowed
```

- `technicallyReady`: Dispatch-Zielwerte plausibel, Mapping vollständig, technische Grenzen eingehalten
- Technische Min-/Max-Leistung: aus EVCC-Telemetrie (`activePhases`/`configuredPhases`, `minCurrentA`/`maxCurrentA` → `resolveWallboxPowerLimits` in `daily_plan.ts`), im `WallboxPlanDecision`-Snapshot — **nicht** aus der Allocation-Planung selbst
- Geplante Ziel-Leistung/Strom: aus Dispatch (Daily-Plan-Allocation, bereits gekappt)
- `write_allowed`: weiterhin **false** (fest)
- `runtime_control_available`: weiterhin **false** (Semantik unverändert)
- `live_write_released`: **false** (neu, explizit)

## 8. Diagnose-States

Unter `addons.wallbox.runtime.*`:

- `command_candidate_json`, `command_candidate_present`
- `live_foundation_phase`, `live_write_released`
- `execution_attempted`, `execution_executed`, `execution_block_reason`

### Semantik `execution_attempted`

```text
execution_attempted = Es wurde versucht, einen externen Geräte-Write auszulösen.
```

Der Aufruf von `executeWallboxWrite()` allein zählt **nicht** als Versuch. Solange das Release-Gate geschlossen ist, bleibt `execution_attempted = false`.

Entsprechend: `execution_executed = false` solange kein externer Write gesendet wurde.

## 9. Garantie: keine realen Writes

Kein `setForeignStateAsync`, kein `writeForeignIfChanged`, keine HTTP/MQTT-Steuerung in v0.1.134.

Legacy-Failsafe (`failsafe.ts`) bleibt unverändert und wird durch die Live Foundation nicht aktiviert.

## 10. Nicht enthalten

- keine reale EVCC-Steuerung
- keine Modus-Writes
- keine Stromvorgabe / Leistungsbegrenzung (extern)
- keine Start-/Stop-Freigabe (extern)
- keine Phasenumschaltung
- keine Ownership-Übernahme
- kein Feedback-/Ack-Zyklus
- kein Restore
- keine Live-Write-Freigabe

Nächster Block: Release-Gate öffnen + echte Writes mit Feedback und Tests.
