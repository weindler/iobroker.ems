# EMS-Light Phase 3C.1 — Immersion Heater Complete Binding

## Ziel und Scope

Phase 3C.1 schließt den **Heizstab** (`immersion_heater`) als erstes Gerät praktisch ab:

- vollständige thermische und elektrische Konfiguration auf der bestehenden Admin-Seite
- Benutzersteuerung `off | auto | force` über Control-States und bestehenden `request_json`
- Runtime-Zustandsmaschine mit Mindestlaufzeit, Mindestpause und Force-Logik
- Leistungs- und Relaisüberwachung mit Fault Lockout und Reset
- Ausführung nur im bestehenden **Live**-Modus (Dryrun simuliert, keine physischen Writes)

**Nicht** enthalten: EMS-Energieplanner, PV-/Preis-/Batterieentscheidung, Globalmodus-Matrix, automatisches Heizen in `auto`.

## Architektur (vier Ebenen)

1. **Gerätekonfiguration** — Admin `immersionHeaterTab`, Migration `set_enabled` → Stufe 1
2. **User Intent** — `user_intent.thermal.*`, Control-States → `operating_request`
3. **Planung** — späterer Planner (in `auto` nur `auto_ready`, kein Eigenstart)
4. **Execution & Safety** — `addons.immersion_heater.runtime.*`, Live-Writes auf Stage-`set_state`

## Konfiguration (neue Felder)

| Bereich | Felder | Defaults |
|---------|--------|----------|
| Planungsfenster | `ih_planning_min_temp_c`, `ih_planning_max_temp_c`, `ih_temperature_hysteresis_k`, `ih_temperature_max_age_sec`, `ih_temperature_plausible_*` | 48, 60, 2, 300, 0–110 |
| Elektrik | `ih_phase_count`, `ih_stage_count`, `ih_force_default_stage`, `ih_actual_power_state` | 1, 1, 1, optional |
| Stufe 1 | `ih_stage_1_*` (Migration von `ih_set_enabled_target`) | set_state ← set_enabled |
| Laufzeit | `ih_minimum_runtime_sec`, `ih_minimum_pause_sec` | 60, 60 |
| Leistungsprüfung | `ih_power_*_threshold_w`, Toleranz, Verzögerungen, Mismatch-Dauer | 50/20, 20%, 30s, 60s |
| Relais | `ih_relay_chatter_window_sec`, `ih_relay_chatter_max_changes` | 300, 6 |

## Intent-Anbindung

Control-States (nur `ack=false`):

- `user_intent.thermal.control.requested_mode` — `off | auto | force`
- `user_intent.thermal.control.force_target_temp_c` — optional, max = Planungsobergrenze
- `user_intent.thermal.control.force_until` — optional ISO-8601
- `user_intent.thermal.control.last_result_json`

Mapping zu `operating_request`: `off` → `off`, `auto` → `auto`, `force` → `force_on`.

Atomarer Eingang `user_intent.inputs.iobroker.thermal.request_json` bleibt voll nutzbar.

Automatische Rückkehr Force → Auto bei Zielerreichung über Intent-Request (revisioniert).

## Runtime-States

Hauptquelle: `addons.immersion_heater.runtime.snapshot_json`

Skalare Spiegel: `available`, `state`, `requested_mode`, `resolved_mode`, Temperatur, Stufen, Leistung, Fault, Mindestzeiten, `reason`.

Fault Reset: `addons.immersion_heater.runtime.fault_reset` (`ack=false`).

## Fault Codes

`no_power_when_on`, `power_when_off`, `power_mismatch`, `relay_chatter`, `write_failed`, `invalid_configuration`, Temperaturfehler.

## Execution

- **Dryrun**: keine Gerätewrites, Runtime zeigt geplanten Zustand
- **Live**: Schreiben auf konfigurierte Stage-`set_state`; `off` und Fault schalten alle Stufen aus
- Bestehender **Failsafe** (EMS weg) bleibt unverändert aktiv

## Bekannte Grenzen

- Stufen 2/3 in Admin vorbereitet; Standard-Migration nur Stufe 1
- Kein Planner-Input-Export in dieser Phase
- `auto` startet nicht selbstständig

## Siehe auch

- [EMS_LIGHT_PHASE_3C_ADDON_INTENT_BINDING.md](./EMS_LIGHT_PHASE_3C_ADDON_INTENT_BINDING.md)
