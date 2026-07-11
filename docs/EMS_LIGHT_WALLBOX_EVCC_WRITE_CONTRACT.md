# EMS-Light — Wallbox EVCC Write Contract (v0.1.135)

## 1. Schichtenmodell

```text
Daily Plan / Dispatch
        ↓
WallboxCommandCandidate
        ↓
WallboxWritePlan
        ↓
executeWallboxWrite()
```

Der Write Contract übersetzt — er plant nicht neu und ändert keine Dispatch-Entscheidungen.

## 2. Vorhandene Control-Rollen (Legacy wb_set_*)

Aus `mapping_config.ts` / `WALLBOX_LEGACY_MAPPING_COMMANDS`:

| Rolle | Bedeutung | Typ |
|-------|-----------|-----|
| `set_enabled` | Ladefreigabe | boolean |
| `set_current_a` | Zielstrom (A) | number |
| `set_charge_power_w` | Zielleistung (W) | number |
| `set_phase_switch_enabled` | Phasenumschaltung | — (nicht im Write Contract v0.1.135) |

Kein EVCC-Modus-Write-Mapping im Projekt → `evcc_mode_write_not_configured` als unsupported.

Steuerungsmodell: **`legacy_goe`**

### Bedeutung von `legacy_goe`

Der Name stammt aus der Admin-Vorlage `goeWallboxTemplateFlat()` und den historischen `wb_set_*`-Keys. Er bedeutet:

* Legacy-Write-Mappings über frei konfigurierbare Ziel-States
* **nicht** automatisch „Steuerung über EVCC“
* **nicht** automatisch „nur go-eCharger“

Die tatsächliche Steuerungsroute ergibt sich aus den konfigurierten Ziel-States.

## 3. Quelle der State-IDs und EVCC-Abgrenzung

Ausschließlich aus Admin-Config (`wb_set_*_target`) via `buildWallboxControlMappingSnapshot()`.

Keine hardcodierten Fremdpfade im Write-Plan-Builder.

### Standard-Vorlage (go-e Direktpfad)

Die Admin-Vorlage mappt typischerweise auf **direkte go-eCharger-States**:

| Config-Key | Default-Ziel |
|------------|--------------|
| `wb_set_enabled_target` | `go-e.0.allow_charging` |
| `wb_set_current_a_target` | `go-e.0.amperePV` |
| `wb_set_charge_power_w_target` | `go-e.0.amperePV` (historisch, siehe Abschnitt 8) |

Das sind **keine EVCC-Control-States**. Ein Write auf diese States **umgeht EVCC** und kann mit EVCC-Regelung kollidieren, wenn EVCC parallel denselben Charger steuert.

### Klassifikation (heuristisch, ohne IO)

| Präfix | `targetKind` | Bedeutung |
|--------|--------------|-----------|
| `evcc.*` | `evcc` | EVCC-State |
| `go-e.*` | `goe_direct` | Direkter go-eCharger-Pfad |
| sonst | `user_configured` | Frei konfiguriert, Kompatibilität unbekannt |

### Zwei getrennte Diagnose-Begriffe

| Begriff | Bedeutung |
|---------|-----------|
| `writeContractReady` | Strukturell vollständiger Write-Plan (Mapping, Werte, Reihenfolge) |
| `evccControlPathConfirmed` | Alle Pflicht-Write-Targets sind `evcc.*` — kein direkter go-e-Umweg |

**`writeContractReady=true` bedeutet nicht EVCC-Kompatibilität.**

Readback-IDs kommen aus EVCC-**Telemetrie**-Config (read-only):

* `set_enabled` → `enabledStateId`
* `set_charge_power_w` → `chargePowerWStateId`
* `set_current_a` → kein dedizierter Readback (null)

Telemetrie-Readback beschreibt EVCC-Sicht, nicht zwingend den geschriebenen Ziel-State.

## 4. Werteabbildung

| Kandidat-Feld | Rolle | Wert |
|---------------|-------|------|
| Ladefreigabe (charge start) | `set_enabled` | `true` |
| `targetCurrentA` | `set_current_a` | Ampere (number) |
| `targetPowerW` | `set_charge_power_w` | Watt (number) |

Bei laufendem Laden (`chargingEnabled=true`): nur Sollwert-Operation, keine erneute Freigabe.

## 5. Typnormalisierung

* boolean / number — keine implizite String-Konvertierung
* Kein NaN, Infinity, negative Strom-/Leistungswerte
* `allowed_values` aus Config für `set_enabled` wird geprüft

## 6. Write-Reihenfolge (Sicherheit)

### Ladebeginn (`writeScenario = charge_start`)

```text
1. set_current_a oder set_charge_power_w  (Sollwert)
2. set_enabled = true                     (Freigabe)
```

**Begründung:** Wenn zuerst die Ladefreigabe gesetzt wird, kann die Wallbox zwischen zwei Writes mit einem alten oder höheren Sollwert laden.

Der historische `dryrun_command` listet `set_enabled` zuerst — das ist Diagnose-Reihenfolge, **kein** sicherer Live-Vertrag. Der Write Contract korrigiert das bewusst.

### Laufende Anpassung (`writeScenario = charge_adjust`)

```text
nur set_current_a oder set_charge_power_w
```

Keine erneute Freigabe, wenn `chargingEnabled=true`.

### Stop / Hold

Nicht implementiert — `hold_mapping_undefined`, keine Stop-Semantik erfunden.

## 7. Widersprüchliche Strom-/Leistungs-Mappings

Wenn `set_current_a` und `set_charge_power_w` auf **denselben** `targetStateId` zeigen:

```text
contractReady = false
operations = []
blockReason = ambiguous_power_control_mapping
```

Gleiche State-ID allein reicht nicht — Ampere und Watt sind nicht unterscheidbar ohne eindeutige Einheit/Rolle.

Die Admin-Vorlage mappt beide Rollen auf `go-e.0.amperePV` — das ist widersprüchlich und wird blockiert, bis nur eine Rolle aktiv ist oder unterschiedliche Ziele konfiguriert sind.

Bei **unterschiedlichen** Ziel-States: Strom (`set_current_a`) wird bevorzugt, weil die Dispatch-Pipeline Strom aus Leistung ableitet und go-e/EVCC typischerweise in Ampere regeln.

## 8. Rücklese-Vertrag

Pro Operation optional:

* `readbackStateId`
* `expectedReadbackValue`

**Write Contract ready** ≠ **Feedback Contract ready**

`feedbackContractReady=true` nur wenn alle **required** Operations einen Readback-State haben.

Bei bevorzugtem Strom-Pfad fehlt oft Readback für `set_current_a` → typisch `writeContractReady=true`, `feedbackContractReady=false`. Das ist bewusst — Feedback-Vollständigkeit wird nicht durch Leistungs-Rolle erzwungen.

Kein Polling, kein Timeout, kein Ack — nur struktureller Vertrag.

## 9. Verhalten nach Aktion

| Aktion | Operationen | contractReady |
|--------|-------------|---------------|
| `none` | `[]` | true (gültiger No-op) |
| `hold` | `[]` | false (`hold_mapping_undefined`) |
| `charge` | Sollwert (+ ggf. Freigabe) | true wenn Mapping + Werte valide |

## 10. Connected-Gate

`connected=false` → `operations=[]`, `contractReady=false`, `vehicle_disconnected`

## 11. Observe / Dryrun / Live

| Phase | Write-Plan |
|-------|------------|
| observe (intern) | nein |
| dryrun | ja, Diagnose |
| live | ja + `executeWallboxWrite()` blockiert am Release-Gate |

## 12. Release-Gate

```ts
WALLBOX_LIVE_WRITE_RELEASED = false;
```

Auch bei vollständigem Write-Plan: keine externen Writes.

## 13. Mögliche EMS/EVCC-Konflikte

Bei direktem go-e-Pfad:

* EVCC kann parallel Charger-Parameter setzen
* EMS-Writes können EVCC-Logik übersteuern oder umgekehrt
* Readback über EVCC-Telemetrie spiegelt nicht zwingend den geschriebenen go-e-State

Ein späterer Live-Block sollte EVCC-Control-States oder explizite Ownership klären.

## 14. Nicht enthalten

* keine reale EVCC-Steuerung
* keine Write-Freigabe
* kein Write-Feedback / Ack / Timeout
* kein Ownership / Restore
* keine Phasenumschaltung
* keine Änderung an Heizstab, Klima, Batterie

Nächster Block: Release-Gate öffnen + Write-Ausführung mit Feedback.
