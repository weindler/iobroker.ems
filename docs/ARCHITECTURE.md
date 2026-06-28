# EMS-Light – Architektur (Ist-Stand)

**Gültig ab:** 28.06.2026  
**Adapter-Version:** v0.1.63

Dieses Dokument beschreibt die **tatsächlich implementierte** Architektur des ioBroker-Adapters `iobroker.ems`. Geplante, aber noch nicht umgesetzte Bestandteile sind als *geplant* gekennzeichnet.

---

## 1. Überblick

EMS-Light ist ein ioBroker-Adapter (`ems.0`), der als eigenständiges Energiemanagement arbeitet:

- **Lesen** von Messwerten und Fremd-States (EVCC, Sensoren, Tarife)
- **Learning** (PV-Bias, Wetter, Preise, Hauslast, Thermal/Battery Runtime)
- **Global Modes** und **Policy Engine** (Betreibervorgaben, keine Geräteaktionen)
- **User Intent** (read-only Erfassung von Benutzeraufträgen)
- **Geräte-Runtime** (Heizstab: FSM, Safety, Live-Writes; Wallbox: read-only)
- **Command Pipeline** (Dryrun/Live-Gates für Legacy-Befehle)

Es gibt **keine** Abhängigkeit von einem externen EMS-V2-Server.

---

## 2. Verzeichnisstruktur

```text
src/
├── main.ts                 Adapter-Einstieg, State-Subscriptions
├── pipeline.ts             Command-Inbox → Mapping → Dryrun/Live
├── execution_mode.ts       global.execution_mode, addons.<id>.mode
├── mapping*.ts             Mapping-Konfiguration und Sync
├── ems_light/              Phase-1-Tick, Live-Cache, State-Ensure
├── global_modes/           off/eco/balanced/comfort/forced
├── policy/                 Policy Engine (core + global)
├── intent/                 User Intent (wallbox, thermal, battery)
├── learning/               Learning-Module (siehe Abschnitt 4)
├── addons/
│   ├── wallbox/            EVCC-Telemetrie (read-only)
│   ├── immersion_heater/   Heizstab-Runtime, FSM, Safety
│   ├── battery/            Batterie-Modul (Stub/Binding)
│   └── dynamic_tariff/     Tarif-Modul
└── tree_paths.ts           Zentrale State-Pfad-Konventionen
```

Build-Ausgabe: `build/` (TypeScript → JavaScript, wird mitgeliefert).

Admin: `admin/jsonConfig.json`, `admin/i18n/de.json`.

---

## 3. Adapter-Laufzeit

### 3.1 Startsequenz (`main.ts`)

1. Kanalbaum und Basis-States anlegen
2. Global Execution States (`global.execution_mode`)
3. Add-on-Mapping-States synchronisieren
4. Module initialisieren: Wallbox (EVCC), Batterie, Heizstab, Dynamic Tariff
5. Failsafe-Runner starten
6. EMS-Light Phase 1: Learning, Policy Engine, Intent Engine, Tick-Timer

### 3.2 EMS-Light Phase-1-Tick (`ems_light/tick.ts`)

Periodischer Tick (Standard 60 s, konfigurierbar 15–600 s):

- Spiegelt `global.execution_mode` nach `execution.safety.global_execution_mode`
- Aktualisiert Live-Cache (`live.*`)
- Schreibt `system.last_tick_at`, `system.health`, `system.summary_de`

Phase 1 ist **read-only** — keine Planner- oder Geräteentscheidungen im Tick.

---

## 4. Learning

| Modul | Pfad | Status |
|-------|------|--------|
| PV-Bias | `learning/pv_bias/` | aktiv (init beim Start) |
| Wetter | `learning/weather/` | aktiv (init beim Start) |
| PV-Horizon | `learning/pv_horizon/` | Code + Tests vorhanden |
| Preis-Learning | `learning/price_learning/` | Code + Tests vorhanden |
| Preis-Forecast | `learning/price_forecast/` | Code + Tests vorhanden |
| Hauslast | `learning/house_load/` | Code + Tests vorhanden |
| Thermal Runtime | `learning/thermal_runtime/` | Code + Tests vorhanden |
| Battery Runtime | `learning/battery_runtime/` | Code + Tests vorhanden |

Learning-Daten werden unter dem konfigurierten Datenpfad (`learning/data_dir.ts`) persistiert. Fehlende Werte bleiben `missing` — niemals still als `0` erfunden.

---

## 5. Global Modes

**Pfad:** `src/global_modes/`

| Mode | Bedeutung |
|------|-----------|
| `off` | Flexible Optimierung deaktiviert; Schutz bleibt |
| `eco` | Wirtschaftlichkeit stark gewichtet |
| `balanced` | Standard |
| `comfort` | Komfort stärker gewichtet |
| `forced` | Benutzeranforderungen höchste Preference |

**States:** `global_modes.requested` (beschreibbar), `active`, `available_json`, `effective_profile_json`, `status`, `valid`, `issues_json`, `revision`, `updated_at`

Änderung von `global_modes.requested` löst Policy-Engine-Neulauf aus.

---

## 6. Policy Engine

**Pfad:** `src/policy/`

- **core/** — Typen, Merge, Validierung, Hash, Registry, Provenance
- **global/** — Globale Policy (configured + effective)
- **engine.ts** — Laufzeit-Orchestrierung

Die Engine beschreibt Capabilities, Limits, Preferences, Protection, Economics — **keine Geräteaktionen**.

Policy-States unter `policy.*`.

---

## 7. User Intent

**Pfad:** `src/intent/`

Read-only Erfassung und Normalisierung von Benutzeraufträgen:

| Domain | Quellen | Ausgabe |
|--------|---------|---------|
| Wallbox | EVCC, ioBroker JSON, Admin-Defaults | `user_intent.wallbox.*` |
| Thermal | ioBroker JSON, Control-States | `user_intent.thermal.*` |
| Battery | ioBroker JSON | `user_intent.battery.*` |

Gesamtvertrag: `user_intent.resolved_all_json`

Revision basiert auf semantischem Hash (volatile Felder wie `observed_at` ausgeschlossen).

**Kein Planner, keine Geräte-Writes** in der Intent-Schicht.

---

## 8. Wallbox (EVCC, read-only)

**Pfad:** `src/addons/wallbox/`

```text
beliebige Wallbox → EVCC → EMS-Light (read-only)
```

- Liest konfigurierte EVCC-Fremd-States
- Normalisiert Telemetrie (`normalize.ts`, `evcc_telemetry.ts`)
- Spiegelt in `addons.wallbox.evcc.*` (Snapshot JSON + Einzelstates)
- `plan_time` / `effective_plan_time`: bei null/invalid wird der Spiegelstate auf `""` gesetzt (kein stale Deadline)
- EVCC-Sitzungsenergie: Wh → kWh (`/ 1000`)
- Go-Null-Zeit (`0001-01-01T00:00:00Z`) wird als „kein Plan" behandelt

Legacy go-e-Write-Mappings (`wb_set_*`) bleiben in der Config, werden von der Runtime nicht mehr genutzt. Wallbox ist `supports_read_only` in der Registry.

---

## 9. Heizstab (Immersion Heater)

**Pfad:** `src/addons/immersion_heater/`

Vier Ebenen:

1. **Gerätekonfiguration** — Admin `immersionHeaterTab`
2. **User Intent** — `user_intent.thermal.*`, Control-States
3. **Planung** — *geplant* (Planner; `auto` startet nicht selbstständig)
4. **Execution & Safety** — Runtime FSM, Live-Writes

**Runtime-States:** `addons.immersion_heater.runtime.*` (Snapshot JSON + Skalarspiegel)

**Safety:** Leistungsprüfung, Relaisüberwachung, Fault Lockout, Mindestlaufzeit/-pause

**Ausführung:**

- **Dryrun:** keine Gerätewrites, simuliert geplanten Zustand
- **Live:** Schreiben auf konfigurierte Stage-`set_state` (nur wenn `global.live ∧ addon.live`)

---

## 10. Ausführungs-Gates (Dryrun / Live)

**Pfad:** `src/execution_mode.ts`, `src/pipeline.ts`

Live-Writes nur wenn:

```text
global.execution_mode = live
AND addons.<id>.mode = live
AND Add-on enabled
AND Mapping vorhanden
AND Add-on nicht read-only (Wallbox blockiert)
AND Safety/Fault erlaubt
```

Dryrun schreibt nur Dryrun-Mirror-States (`addons.<id>.dryrun.*`).

> **Geplant:** Modus `observe` (lesen/lernen/planen, keine Ausführung) ist noch nicht implementiert.

---

## 11. State-Verträge (Auswahl)

| Bereich | Beispiel-Pfad | Beschreibung |
|---------|---------------|--------------|
| Global | `global.execution_mode` | `dryrun` \| `live` |
| Global Modes | `global_modes.requested` | Betreibermodus |
| Policy | `policy.effective_json` | Effektive Policy |
| Intent | `user_intent.resolved_all_json` | Aggregierter Intent |
| Wallbox EVCC | `addons.wallbox.evcc.snapshot_json` | EVCC-Telemetrie |
| Heizstab | `addons.immersion_heater.runtime.snapshot_json` | Runtime-Snapshot |
| Command | `command.inbox` | Legacy-Befehlseingang |
| System | `system.health` | Tick-Gesundheit |

Vollständige Pfad-Konventionen: `src/tree_paths.ts`.

---

## 12. Teststruktur

Tests liegen neben dem Quellcode (`*.test.ts`) und werden nach `build/` kompiliert.

```bash
npm test    # build + node --test auf alle *.test.js
```

290 Tests (Stand v0.1.63), u. a.:

- Global Modes, Policy Engine, Intent Engine
- Wallbox EVCC-Telemetrie und Mirror-States
- Heizstab FSM, Safety, Feedback
- Learning-Mathematik (PV, Wetter, Preis, Hauslast, Thermal, Battery)

Keine externen Snapshot-Fixtures im Repository — Tests nutzen Mock-Hosts.

---

## 13. Geplant, nicht implementiert

- Zentrale Add-on-Governance (`GLOBAL`: aktiv + KI-Freigabe)
- Modus `observe`
- Deterministischer Planner / General Operator
- KI-Integration und Kostenkontrolle
- Batterie-Geräteprofile (Generic Read-only, Sonnen EM, …)
- Einheitliche Runtime-States (`decision_source`, `ai_optimization_allowed`, …)
- EVCC-Writes / Wallbox-Steuerung

Details und verbindliche Zielarchitektur: `docs/EMS_LIGHT_MASTERPLAN.md`.
