# EMS-Light Phase 3B — User Intent Foundation & EVCC Input Contract

## Ziel

Phase 3B implementiert eine **read-only** Schicht zur Erfassung und Normalisierung von Benutzeraufträgen. Erste Domain: **Wallbox**.

Die Schicht beantwortet ausschließlich:

> Was wurde vom Benutzer oder einer externen Quelle angefordert?

Sie beantwortet **nicht**, ob der Auftrag energetisch sinnvoll, policy-konform oder ausführbar ist.

## Architektur und Abgrenzung

```text
EVCC-Datenpunkte (read-only)
ioBroker Intent Request (JSON)
Admin-Defaults
        │
        ▼
Source Adapter
        │
        ▼
Normalisierung / Validierung
        │
        ▼
Resolver (Priorität pro Feld)
        │
        ▼
user_intent.wallbox.resolved_json
```

| Schicht | Phase 3B |
|---------|----------|
| Learning | unverändert (read-only) |
| Global Modes / Policy | unverändert, keine fachliche Erweiterung |
| **User Intent** | **neu — nur erfassen** |
| Planner | nicht implementiert |
| Operator | nicht implementiert |
| Execution | nicht implementiert |

## Wallbox Intent Contract

Kanonsicher Contract (`schema_version: 1`, `domain: "wallbox"`):

- `charge_strategy`: `off` \| `min_pv` \| `pv` \| `immediate` \| `unknown`
- `target_soc_pct`: 0–100 oder `null` (fehlend)
- `deadline`: `{ type, at, timezone }` oder `null`
- `manual_override`: Scope-basierte vorübergehende Eigentümerschaft
- Jedes Feld: `value`, `status`, `origin`, `observed_at`, optional `changed_at`, `raw_value`

## Quellen und Priorität (pro Feld)

1. Gültiger aktiver Manual Override (nur angegebene Scopes)
2. Expliziter gültiger ioBroker-Benutzerauftrag
3. Gültiger EVCC-Zustand (`change_kind = unknown`, nie `manual_explicit`)
4. Gültiger Admin-Default (`source = admin`, `change_kind = configured`)
5. Kein Wert (`missing`)

## EVCC-Normalisierung

| EVCC-Rohwert | Strategie |
|--------------|-----------|
| off | off |
| minpv, min_pv | min_pv |
| pv | pv |
| now | immediate |
| unbekannt | unknown (Rohwert erhalten) |

- Ziel-SOC: `0` ist gültig, nicht „fehlend“
- Deadlines: ISO-8601, Unix s/ms; Vergangenheit → `expired`
- **Keine Schreibzugriffe** auf EVCC oder Wallbox

## ioBroker Request Contract

**Eingabe (beschreibbar):** `user_intent.inputs.iobroker.wallbox.request_json`  
Nur `ack = false` wird verarbeitet.

**Ergebnis (read-only):** `user_intent.inputs.iobroker.wallbox.result_json`  
Status: `accepted`, `accepted_partial`, `rejected_invalid`, `rejected_expired`, `duplicate`

`clear_fields` löscht explizit: `charge_strategy`, `target_soc_pct`, `deadline`, `manual_override`

## State-Baum

```text
user_intent.contract_version
user_intent.status
user_intent.wallbox.resolved_json          ← fachliche Hauptquelle
user_intent.wallbox.revision
user_intent.wallbox.intent_state
user_intent.wallbox.last_changed
user_intent.wallbox.manual_override_active
user_intent.wallbox.source_summary
user_intent.wallbox.sources.evcc.*
user_intent.wallbox.sources.admin.snapshot_json
user_intent.inputs.iobroker.wallbox.request_json   ← einzige beschreibbare Eingabe
user_intent.inputs.iobroker.wallbox.result_json
user_intent.wallbox.diagnostics.*
```

## Revisionierung

- Monoton steigende `revision` nur bei **semantischer** Änderung
- Identisches erneutes Lesen, gleicher `request_id`, reines `observed_at` → keine neue Revision
- Persistenz: `intent/wallbox_intent_v1.json` im Instanz-Datenordner

## Lifecycle

- `initIntentEngine()` / `stopIntentEngine()`
- Idempotente Initialisierung, keine Doppel-Subscriptions
- EVCC-Änderungen: 300 ms Debounce, dann konsistenter Neu-Lesezyklus
- Unsubscribe non-blocking (fire-and-forget)
- Timer-Cleanup beim Stop

## Admin-Konfiguration (Tab „EMS-Light User Intent“)

- `intent_evcc_*_state` — optionale EVCC-Datenpunkt-Mappings
- `intent_default_charge_strategy`, `intent_default_target_soc_pct` — nur Lückenfüller
- `intent_timezone` (Default: `Europe/Berlin`)
- `intent_manual_override_max_minutes` — optionale Begrenzung

## Bekannte Grenzen (v1)

- Nur eine Wallbox-Instanz (`main`)
- Keine Batterie-, Thermal- oder Klima-Intent-Domains
- Keine EMS-UI
- Keine EVCC-Schreibzugriffe
- Keine Policy-Auswertung des Intents

## Vorbereitung Phase 3C+

Der Contract ist so strukturiert, dass der Planner `user_intent.wallbox.resolved_json` lesen kann, ohne EVCC-Pfade zu kennen.
