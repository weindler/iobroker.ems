# EMS-Light — Wallbox Live Foundation (v0.1.177)

## 1. Zweck

Die Wallbox-Live-Foundation ist der Schreibpfad vom Daily-Plan-Dispatch bis zum externen Gerät. Seit v0.1.177 führt sie für den **EVCC-Control-Pfad** echte Writes aus, verifiziert sie per Feedback und sichert sie über eine eigene Ownership-/Fault-/Restore-Schicht ab (analog Heizstab/Batterie).

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

- `executeWallboxWrite(host, input)` — **einziger** Write-Pfad, führt bei `liveEligible=true`, `phase=live`, keinem aktiven Fault die konfigurierten Write-Operationen via `writeForeignIfChanged` aus
- `runWallboxLiveFoundation(host, input)` — Orchestrierung nach Dispatch inkl. Write, Ownership- und Fault-Ergebnis
- `WALLBOX_LIVE_WRITE_RELEASED = true` (kontrollierte Freigabe seit v0.1.177)

## 4. Release-Gate — jetzt kontrolliert offen

Writes werden nur ausgeführt, wenn **alle** Bedingungen erfüllt sind:

```text
WALLBOX_LIVE_WRITE_RELEASED = true   (statisches Kill-Switch, im Code)
AND writePlan.liveEligible = true    (nur EVCC-Control-Pfad, Mapping vollständig bestätigt)
AND phase = "live"                   (global.execution_mode + addons.wallbox.mode beide live)
AND faultActive = false              (kein offener Fault/Lockout)
```

Fehlt eine Bedingung:

```text
attempted = false | true (je nach Gate)
executed  = false
blocked   = true
reason    = release_gate_closed | fault_lockout | not_live_eligible | already_at_target
```

Der Legacy-Direktpfad (`legacy_direct`) ist strukturell **nie** `liveEligible` (siehe `control_mapping.ts`) — er kann über dieses Gate grundsätzlich nicht live schreiben.

## 5. Interne Foundation-Phasen (`live_foundation_phase`)

Die Werte `observe | dryrun | live` sind **interne** Live-Foundation-Phasen im State `live_foundation_phase`. Sie sind **kein** globaler EMS-Ausführungsmodus.

Global und Add-on kennen weiterhin nur `dryrun | live` (`execution_mode.ts`). Es gibt **keinen** Global-Modus `observe`.

| Phase | Bedingung | Command-Kandidat | `executeWallboxWrite` |
|-------|-----------|------------------|------------------------|
| `observe` | Add-on oder Governance aus | nein | nicht aufgerufen |
| `dryrun` | Global/Add-on ≠ live | ja (Diagnose) | nicht aufgerufen |
| `live` | Global + Add-on live | ja | aufgerufen, Write nur bei `liveEligible` + kein Fault |

## 6. Connected-Gate

`connected = false` → kein `charge`-Kandidat, Blockgrund `vehicle_disconnected`. SOC 0 bleibt unkritisch.

## 7. Readiness vs. Write-Freigabe

```text
technicallyReady != writeAllowed
```

- `technicallyReady`: Dispatch-Zielwerte plausibel, Mapping vollständig, technische Grenzen eingehalten
- `writeAllowed = WALLBOX_LIVE_WRITE_RELEASED && writePlan.liveEligible && phase === "live"`
- `runtime_control_available`: spiegelt `writePlan.liveEligible`
- `live_write_released`: **true** (v0.1.177)

## 8. Safety-Schicht (Ownership / Fault / Restore)

Analog Batterie/Heizstab, siehe Module `runtime/ownership.ts`, `runtime/fault.ts`, `runtime/restore.ts`:

- **Ownership** (`WallboxOwnershipState`): wird bei jedem erfolgreichen Write gesetzt (`grantWallboxOwnership`) — EMS "besitzt" damit den EVCC-Mode, solange Live aktiv ist.
- **Fault/Lockout** (`WallboxFaultState`): Write-Fehler oder terminale Feedback-Mismatches (`mismatch`/`timeout`/`invalid`) setzen `faultActive=true` und blockieren weitere Writes, bis der State `addons.wallbox.runtime.fault_reset` manuell auf `true` gesetzt wird.
- **Safe-Restore** (`WallboxRestorePlan`): verlässt EMS den Live-Pfad mit aktiver Ownership (Governance aus, Add-on-Mode ≠ live, o.ä.), wird der EVCC-Mode auf den konfigurierten Hold-Wert zurückgeschrieben (`wb_evcc_set_mode_target` → `wb_evcc_mode_hold_value`). Ohne bestätigtes Hold-Mapping (`holdModeValueConfirmed`) ist Restore `possible=false` — es wird nichts erraten.
- **Periodischer Safety-Tick** (`index.ts`, alle 10s): treibt Feedback-Auswertung (`tickWallboxFeedback`) und Safe-Restore-Prüfung unabhängig vom Daily-Plan-Takt.

## 9. Diagnose-States

Unter `addons.wallbox.runtime.*`:

- `command_candidate_json`, `command_candidate_present`
- `live_foundation_phase`, `live_write_released`
- `execution_attempted`, `execution_executed`, `execution_block_reason`
- `ownership_active`
- `fault_active`, `fault_code`, `fault_message`, `fault_reset` (write, Momentschalter)

### Semantik `execution_attempted`

```text
execution_attempted = Es wurde versucht, einen externen Geräte-Write auszulösen.
```

`execution_executed = true` nur wenn mindestens eine Operation tatsächlich geschrieben wurde (Wert hat sich geändert). Bei bereits korrektem Zielwert: `executed=false`, `reason=already_at_target` — kein unnötiger Write.

## 10. Weiterhin nicht enthalten

- keine Steuerung des Legacy-Direktpfads (go-e) — strukturell nie live-eligible
- keine Phasenumschaltung (`set_phase`) im Write-Pfad
- kein automatischer Fault-Reset — bewusst manuell, analog Heizstab

Siehe auch: `docs/EMS_LIGHT_WALLBOX_FEEDBACK_CONTRACT.md`, `docs/EMS_LIGHT_WALLBOX_EVCC_WRITE_CONTRACT.md`.
