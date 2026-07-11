# EMS-Light — Wallbox EVCC Control Mapping Foundation (v0.1.136)

## 1. Zwei Steuerpfade

| Pfad | Config | Bedeutung |
|------|--------|-----------|
| **EVCC Control Path** | `wb_evcc_set_*` + `wb_control_model=evcc` | Steuerung über EVCC-Loadpoint-States (empfohlen) |
| **Legacy Direct Charger Path** | `wb_set_*` + `wb_control_model=legacy_direct` | Direkte go-e/Wallbox-States (historisch) |

Telemetrie (`wb_evcc_*` read-only) bleibt getrennt von Steuer-Mappings.

## 2. Control Model Selection

Admin-Feld: `wb_control_model`

| Wert | Verhalten |
|------|-----------|
| `evcc` | Standard für neue Installationen |
| `legacy_direct` | Legacy `wb_set_*`-Mappings |
| `none` | Kein Steuerpfad — Write Contract blockiert |

### Migration

Bestehende Installationen mit Legacy-`wb_set_*`-Mappings **ohne** explizite Auswahl → automatisch `none` (`control_model_not_selected`).

Keine automatische Umstellung von `go-e.*` auf `evcc.*`. Keine Auto-Live-Aktivierung.

## 3. EVCC-Control-Rollen

| Rolle | Admin-Key | Bedeutung | Pflicht |
|-------|-----------|-----------|---------|
| `set_mode` | `wb_evcc_set_mode_target` | EVCC-Lademodus / Aktivierung | ja (Ladebeginn) |
| `set_max_current_a` | `wb_evcc_set_max_current_a_target` | maximale Stromstärke pro Phase | ja |
| `set_phase` | `wb_evcc_set_phase_target` | erlaubte Phasen | optional |

### Mode-Werte (explizit konfiguriert)

| Config-Key | Bedeutung |
|------------|-----------|
| `wb_evcc_mode_charge_value` | Moduswert für Laden (z. B. `pv`) |
| `wb_evcc_mode_hold_value` | Moduswert für Hold/Off (optional) |

Keine hardcodierten Modusnamen im Runtime-Code. Werte werden gegen `common.states` des Mode-Write-Objekts validiert.

### Nicht als EVCC-Control-Rolle

| State / Rolle | Grund |
|---------------|-------|
| `enabled` / `wb_evcc_set_enabled_target` | Status, keine bestätigte Steuerrolle |
| `minCurrent` | Mindeststrom, kein dynamischer Zielstrom |
| `set_charge_power_w` | nicht im EVCC-Pfad |

Legacy-Felder `wb_set_*` bleiben unverändert.

## 4. Stromsemantik: maxCurrent

EMS übersetzt den geplanten Zielstrom aus dem Command Builder als **maximale erlaubte Stromstärke** an EVCC (`maxCurrent`).

EVCC bleibt die ausführende Regelinstanz und kann abhängig von Modus, PV-Überschuss, Fahrzeug oder Netzgrenzen darunter regeln.

`minCurrent` ist **nicht** der dynamische Zielstrom und gehört nicht in die laufende Dispatch-Umsetzung.

## 5. EVCC-Kompatibilitätsprüfung

`evccControlPathConfirmed=true` nur wenn:

* `controlModel=evcc`
* Pflichtrollen `set_mode` + `set_max_current_a` konfiguriert
* `set_max_current_a` semantisch auf `maxCurrent` zeigt (nicht `minCurrent`, nicht `enabled`)
* `set_mode` semantisch auf Mode-State zeigt (nicht `enabled`)
* Charge-Mode-Wert (`wb_evcc_mode_charge_value`) bestätigt
* Zielobjekt vorhanden, schreibbar, Datentyp passt
* Kein direkter `go-e.*`-State

Nicht ausreichend allein:

* State-ID beginnt mit `evcc.`
* `common.write=true`

Der Mapping-Snapshot dokumentiert `semanticRole`: `evcc_mode`, `evcc_max_current`, `evcc_phases`, …

## 6. Write-Reihenfolge (EVCC)

| Szenario | Reihenfolge |
|----------|-------------|
| `charge_start` | 1. `set_max_current_a` → 2. `set_mode` |
| `charge_adjust` | nur `set_max_current_a` (wenn Charge-Modus bereits aktiv) |

## 7. Legacy-Direktpfad

* `contractReady=true` möglich bei eindeutigem Mapping + validen Objekt-Metadaten
* `evccControlPathConfirmed=false`
* **`liveEligible=false`** (immer)
* Write-Reihenfolge unverändert: Sollwert vor Ladefreigabe (`set_current_a` → `set_enabled`)

## 8. liveEligible

Strukturelle Eignung für einen späteren Live-Pfad — **keine Write-Freigabe**.

| Modell | liveEligible |
|--------|--------------|
| `evcc` + Pfad bestätigt + Contract vollständig + Charge-Mode bestätigt | `true` |
| `legacy_direct` | `false` |
| `none` / unvollständig / falsche Semantik | `false` |

Release-Gate bleibt geschlossen:

```ts
WALLBOX_LIVE_WRITE_RELEASED = false;
```

## 9. Feedback / Readback

| Write-Rolle | Readback |
|-------------|----------|
| `set_max_current_a` | `wb_evcc_max_current_a_state` (Telemetrie) |
| `set_mode` | `intent_evcc_mode_state` (Telemetrie) |

`enabled` ist **kein** Mode-Write-Readback. Fehlende Readback-States → `feedbackContractReady=false`.

## 10. Diagnose-States

Unter `addons.wallbox.runtime.*`:

* `write_control_model`
* `legacy_mappings_present`
* `evcc_control_mappings_present`
* `write_evcc_path_confirmed`
* `write_live_eligible`
* `write_control_path_reason`
* `control_mapping_diagnostics_json`

## 11. Nicht enthalten

* keine realen EVCC-Writes
* keine Release-Gate-Öffnung
* kein Feedback / Ownership / Restore
* keine Änderung an Heizstab, Klima, Batterie

Siehe auch: `docs/EMS_LIGHT_WALLBOX_EVCC_WRITE_CONTRACT.md`
