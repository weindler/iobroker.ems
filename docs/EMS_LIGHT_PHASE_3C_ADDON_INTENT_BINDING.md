# EMS-Light Phase 3C — Add-on Intent Binding

## Ziel

Phase 3C erweitert die in Phase 3B eingeführte User-Intent-Schicht auf alle im Adapter **tatsächlich vorhandenen** Add-ons mit eigener Intent-Domain. Es wird ausschließlich beantwortet:

> Was möchte der Benutzer oder eine externe UI für dieses Add-on?

Nicht beantwortet werden energetische Entscheidungen, Priorisierung, Planner, Policy-Auswertung oder Gerätesteuerung.

## Unterstützte Domains (v0.1.57)

| Domain | Add-on-ID | Quellen |
|--------|-----------|---------|
| `wallbox` | `wallbox` | EVCC (read-only), ioBroker-Request, Admin-Defaults |
| `thermal` | `immersion_heater` | ioBroker-Request |
| `battery` | `battery` | ioBroker-Request |

**Nicht implementiert** (kein Add-on-Modul im Repository): `heat_pump`, `air_conditioning`/`climate`, `consumer_1`/`deferrable_load`, `heating`.

Telemetrie und Geräte-Istzustände (Relais, SOC, Puffer-Temperatur, `operating_mode`) werden **nicht** als User Intent interpretiert.

## Abgrenzung

| Bereich | Phase 3C |
|---------|----------|
| EMS-Planner | nein |
| Policy Engine Entscheidung | nein |
| Execution / Geräte-Writes | nein |
| EVCC-Schreibzugriffe | nein |
| Priorisierung zwischen Add-ons | nein |

## Gemeinsame Struktur

Wiederverwendung des Phase-3B-Kerns unter `src/intent/core/`:

- `IntentField`, `ManualOverrideState`, feldbezogener Resolver
- Semantische Revisionierung
- Atomare ioBroker-JSON-Requests (`schema_version: 1`)
- Idempotenz über `request_id` pro Domain
- Manual Override mit feldbezogenem `scope`

Neue Quellen/Eigentümer (abwärtskompatibel): `IntentSource.addon`, `IntentOwner.device`.

## Resolver-Reihenfolge (pro Feld)

1. gültiger aktiver Manual Override (nur im Scope)
2. expliziter gültiger ioBroker-/EMS-UI-Auftrag
3. gültige externe Add-on-Quelle (Wallbox: EVCC)
4. gültiger Admin-Default (Wallbox)
5. `missing`

Deaktivierte Add-ons (`addons.<id>.enabled/available`) → Domain `intent_state: disabled`, kein aktiver Auftrag.

## Domain-Contracts

### Wallbox (Phase 3B + Ergänzungen)

Felder unverändert: `charge_strategy`, `target_soc_pct`, `deadline`, `manual_override`, `source_summary`, `revision`, `intent_state`.

Neu: `external_planner_plan` (`ExternalWallboxPlan`) aus gemapptem Ziel-SOC und `effectivePlanTime`:

- `state`: `active` | `none` | `expired` | `invalid`
- Null-Sentinel für Planzeit: `null`, `"null"`, `"undefined"`, `""`, Leerzeichen → `missing`, nicht `invalid`

### Thermal

Felder: `operating_request`, `target_temperature_c`, `ready_at`, `priority`, plus Metadaten.

Override-Scopes: `operating_request`, `target_temperature_c`, `ready_at`, `priority`, `all`.

### Battery

Felder: `operating_request`, `target_soc_pct`, `grid_charge_request`, `ev_discharge_allowed`, `top_off_requested`, plus Metadaten.

Override-Scopes: `operating_request`, `target_soc_pct`, `grid_charge_request`, `ev_discharge_allowed`, `top_off_requested`, `all`.

## ioBroker-Requests

| Domain | Request | Result |
|--------|---------|--------|
| wallbox | `user_intent.inputs.iobroker.wallbox.request_json` | `...result_json` |
| thermal | `user_intent.inputs.iobroker.thermal.request_json` | `...result_json` |
| battery | `user_intent.inputs.iobroker.battery.request_json` | `...result_json` |

Nur `ack = false`. Status: `accepted`, `accepted_partial`, `rejected_invalid`, `rejected_expired`, `duplicate`.

## Gesamtvertrag

`user_intent.resolved_all_json` — enthält alle aktiven Domain-Contracts. Gesamt-Revision steigt nur bei semantischer Änderung mindestens einer Domain.

## State-Bäume

Pro Domain: `resolved_json`, `revision`, `intent_state`, `last_changed`, `manual_override_active`, `source_summary`, `diagnostics.*`.

Global: `user_intent.resolved_all_json`, `user_intent.resolved_all.revision`, `user_intent.status`.

## Lifecycle

- Init idempotent, keine Doppel-Subscriptions
- Subscriptions für alle drei Request-States + EVCC-Fremdstates
- Ablauf-Timer für Manual-Override-`valid_until` (schlank, kein Hochfrequenz-Polling)
- Stop: Timer + Subscriptions non-blocking aufräumen

## Persistenz

`intent/intent_v1.json` (Migration von `wallbox_intent_v1.json` beim Laden).

## Bekannte Grenzen

- Keine externen Add-on-Request-Mappings für Thermal/Battery (nur ioBroker-JSON-Eingang)
- Klima/Wärmepumpe/verschiebbare Verbraucher erst bei vorhandenem Add-on-Modul
- Keine Zonen-Intent-Logik (kein Klima-Add-on)

## Siehe auch

- [EMS_LIGHT_PHASE_3B_USER_INTENT.md](./EMS_LIGHT_PHASE_3B_USER_INTENT.md)
