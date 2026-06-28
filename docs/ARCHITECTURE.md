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
│   ├── battery/            Batterie: core/ profiles/ runtime/ (FSM, zentrale Write-Funktion)
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

## 10. Add-on-Governance (implementiert)

**Pfad:** `src/addons/governance/`

- Zentrale Registry für Wallbox, Heizstab, Batterie, Klima (`GOVERNED_ADDON_REGISTRY`)
- Konfigurationsquelle: Admin-Reiter **GLOBAL** (`*_enabled`, `*_ai_optimization_allowed`)
- Runtime-Spiegel (read-only): `addons.<id>.governance.enabled`, `addons.<id>.governance.ai_optimization_allowed`
- Legacy-Sync: `addons.<runtimeId>.enabled` wird aus der Governance-Konfiguration gespiegelt (Pipeline/FSM)

**Steuerungs-Gates:**

1. **Früh** — Intent-Resolver und FSM prüfen Governance/Aktiv-Status (keine ausführbaren Planner-Intents bei deaktiviertem Add-on)
2. **Final** — Pipeline und Heizstab-`applyStageWrites` prüfen unmittelbar vor Live-Write erneut

**Trennung:** Telemetrie, Mirror, Mapping und Learning laufen bei `enabled = false` weiter (z. B. EVCC-Telemetrie, Battery Runtime Learning).

Die KI-Freigabe ist nur gespeicherte Opt-in-Freigabe — weiterhin **keine KI-Aufrufe** (Stand v0.1.65).

---

## 11. Ausführungs-Gates (Dryrun / Live)

**Pfad:** `src/execution_mode.ts`, `src/pipeline.ts`

Live-Writes nur wenn:

```text
global.execution_mode = live
AND addons.<id>.mode = live
AND Add-on governance enabled
AND Mapping vorhanden
AND Add-on nicht read-only (Wallbox blockiert)
AND Safety/Fault erlaubt
```

Dryrun schreibt nur Dryrun-Mirror-States (`addons.<id>.dryrun.*`).

> **Geplant:** Modus `observe` (lesen/lernen/planen, keine Ausführung) ist noch nicht implementiert.

---

## 12. State-Verträge (Auswahl)

| Bereich | Beispiel-Pfad | Beschreibung |
|---------|---------------|--------------|
| Global | `global.execution_mode` | `dryrun` \| `live` |
| Global Modes | `global_modes.requested` | Betreibermodus |
| Policy | `policy.effective_json` | Effektive Policy |
| Intent | `user_intent.resolved_all_json` | Aggregierter Intent |
| Wallbox EVCC | `addons.wallbox.evcc.snapshot_json` | EVCC-Telemetrie |
| Heizstab | `addons.immersion_heater.runtime.snapshot_json` | Runtime-Snapshot |
| Batterie | `addons.battery.status.*`, `addons.battery.telemetry.*` | Profil/Bereitschaft, normalisierte Telemetrie |
| Batterie | `addons.battery.runtime.*`, `addons.battery.dryrun.*` | FSM-Zustand, Ownership, geplante Writes |
| Batterie | `addons.battery.capabilities.*`, `addons.battery.diagnostics.*` | Capability-Matrix, Fault/Lockout, letzter Write |
| Batterie | `addons.battery.control.fault_reset` | Fault/Lockout zurücksetzen (Schreib-State) |
| Governance | `addons.wallbox.governance.enabled` | Add-on aktiv (Spiegel aus Config) |
| Command | `command.inbox` | Legacy-Befehlseingang |
| System | `system.health` | Tick-Gesundheit |

Vollständige Pfad-Konventionen: `src/tree_paths.ts`.

---

## 12a. Batterie-Architektur

**Pfad:** `src/addons/battery/` (`core/`, `profiles/`, `runtime/`)

- **Hardware ↔ Controller getrennt:** Batterie-Hardware (Hersteller/Modell/Kapazität) und Steuerprofil sind entkoppelt (z. B. BYD-Hardware, Fronius-Controller).
- **Datenvertrag (`core/`):** `BatteryIdentity`, `BatteryTelemetry` (normalisierte Vorzeichenkonvention), Kapazitäts-/Energieableitung, `BatteryHardwareLimits`, normalisierte `BatteryOperatingMode`, neutraler `BatteryDeviceIntent`.
- **Capability-Modell:** je Fähigkeit `supported / configured / available` (`core/capabilities.ts`); `set_discharge_power` ist bewusst nicht freigegeben.
- **Profile (`profiles/`):** `generic_readonly` (nur Lesen, nie Live), `sonnen_em` (volle Steuerung). Herstellerspezifische Moduswerte existieren nur im Profil.
- **FSM (`runtime/fsm.ts`):** eine gemeinsame Zustandsmaschine für Dryrun und Live (idle → validate → prepare → pause_grid_balance → set_manual_mode → verify → set_charge_power → verify → active → stop_charge → restore_self_consumption → restore_grid_balance → completed / fault / lockout). Dryrun simuliert Rückmeldungen, Live prüft echte.
- **Zentrale Write-Funktion (`runtime/execute.ts`):** alle realen Batterie-Writes laufen über `executeBatteryWrite`; das finale Gate prüft unmittelbar vor `setForeignState` global Live, Governance, Profilbereitschaft, Intent, Telemetrie, Fault/Lockout, Mapping und Ownership.
- **Ownership & Safe Restore:** EMS führt Safe Restore nur aus, wenn es die Batterie selbst in den manuellen Modus versetzt hat; fremde manuelle Steuerung wird nicht überschrieben.
- **Verhältnis zu Governance/Learning:** `battery_enabled = false` stoppt Steuerung kontrolliert, Telemetrie und Battery Runtime Learning laufen weiter.

---

## 13. Teststruktur

Tests liegen neben dem Quellcode (`*.test.ts`) und werden nach `build/` kompiliert.

```bash
npm test    # build + node --test auf alle *.test.js
```

360+ Tests (Stand v0.1.65), u. a.:

- Global Modes, Policy Engine, Intent Engine
- Wallbox EVCC-Telemetrie und Mirror-States
- Heizstab FSM, Safety, Feedback, Governance-Gates
- Add-on-Governance (Config, Runtime-States, Pipeline)
- Batterie: Core (Telemetrie/Kapazität/Grenzen/Validierung), Profile, FSM, zentrale Write-Gates, Dryrun-Tick (keine realen Writes), Ownership
- Learning-Mathematik (PV, Wetter, Preis, Hauslast, Thermal, Battery)

Keine externen Snapshot-Fixtures im Repository — Tests nutzen Mock-Hosts.

---

## 14. Geplant, nicht implementiert

- Modus `observe`
- Deterministischer Planner / General Operator
- KI-Integration und Kostenkontrolle
- Weitere Batterie-Steuerprofile (Sonnen Performance, Fronius, Victron, …) und bestätigte Entladesteuerung
- Einheitliche Runtime-States (`decision_source`, `planner_status`, …) über Governance hinaus
- EVCC-Writes / Wallbox-Steuerung

Details und verbindliche Zielarchitektur: `docs/EMS_LIGHT_MASTERPLAN.md`.
