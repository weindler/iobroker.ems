# EMS-Light – Architektur (Ist-Stand)

**Gültig ab:** 23.07.2026  
**Adapter-Version:** v0.1.181

Dieses Dokument beschreibt die **tatsächlich implementierte** Architektur des ioBroker-Adapters `iobroker.ems`. Geplante, aber noch nicht umgesetzte Bestandteile sind als *geplant* gekennzeichnet.

Index und Prioritäten: `docs/README.md`.

---

## 1. Überblick

EMS-Light ist ein ioBroker-Adapter (`ems.0`), der als eigenständiges Energiemanagement arbeitet:

- **Lesen** von Messwerten und Fremd-States (EVCC, Sensoren, Tarife)
- **Learning** (PV-Bias, PV-Horizont, Wetter, Preise, Hauslast, Thermal/Battery Runtime)
- **Global Modes** und **Policy Engine** (Betreibervorgaben)
- **General Operator:** Forecast Plan → Daily Plan → Allocation (gemeinsam für alle freigegebenen Add-ons)
- **Geräte-Runtime** (Heizstab, Klima, Batterie, Wallbox) über Intent/Profil — Dryrun vor Live
- **Safety / Fault / Lockout / Ownership** — keine Fremd-Writes außer Runtime-Gates

Es gibt **keine** Abhängigkeit von einem externen EMS-V2-Server.

**Schwerer Planner (Shadow/Takeover):** seit v0.1.181 vollständig aus dem Code entfernt (~20.500 LOC).  
**Legacy Realtime-Planner (`runPlannerTick`):** seit v0.1.204 (Roadmap Block 4) aus dem Produktions-Tick entfernt. Planung läuft ausschließlich über den Operator-Pfad (Forecast Plan → Daily Plan → Allocation); Regeln unter `operator/planning/`.

---

## 2. Verzeichnisstruktur

```text
src/
├── main.ts                 Adapter-Einstieg, State-Subscriptions, Admin sendTo
├── pipeline.ts             Command-Inbox → Mapping → Dryrun/Live
├── execution_mode.ts       global.execution_mode, addons.<id>.mode
├── mapping*.ts             Mapping-Konfiguration und Sync
├── ems_light/              Tick, Live-Cache, State-Ensure (Produktion)
├── operator/               Forecast Plan, Daily Plan, Contributions, Allocation
│   └── planning/           Planungsregeln (ehem. planner/rules/, Block 4)
├── global_modes/           off/eco/balanced/comfort/forced
├── policy/                 Policy Engine (core + global)
├── intent/                 User Intent / Geräte-Intents
├── learning/               PV-Bias, Horizon, Preise, Hauslast, …
├── addons/
│   ├── wallbox/            EVCC Telemetrie + Dryrun/Live-Pfad
│   ├── immersion_heater/   Heizstab-Runtime, FSM, Safety
│   ├── air_conditioning/   Klima-Runtime
│   ├── battery/            Batterie: core/ profiles/ runtime/
│   └── governance/         enabled + ai_optimization_allowed
├── backup/ / restore/      Export, Support-Paket, Restore
├── support/                Diagnosemodus (zeitlich begrenzt)
└── planner/                Legacy State-Hülle + reine Tests (kein Produktions-Tick)
```

Build-Ausgabe: `build/` (TypeScript → JavaScript, wird mitgeliefert).

Admin: `admin/jsonConfig.json`, `admin/i18n/`.

---

## 3. Adapter-Laufzeit

### 3.1 Startsequenz (`main.ts`)

1. Kanalbaum und Basis-States anlegen
2. Global Execution States (`global.execution_mode`)
3. Add-on-Mapping-States synchronisieren
4. Module initialisieren: Wallbox (EVCC), Batterie, Heizstab, Klima, Dynamic Tariff
5. Failsafe-Runner starten
6. EMS-Light: Learning, Policy, Operator-Ticks (Forecast/Daily Plan), Geräte-Runtimes

### 3.2 Produktions-Tick

Periodischer Tick (typisch 60 s):

- Spiegelt Execution Mode / Safety
- Aktualisiert Live-Cache
- Baut Forecast Plan und Daily Plan (Allocation, rollierender Horizont 48 h seit v0.1.205)
- Geräte-Runtimes lesen Allocation/Intents in eigenen Intervallen

Geräte-Runtimes (Heizstab, Batterie, Klima, Wallbox) laufen in eigenen Intervallen und lesen Operator-Intents.

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

## 8. Wallbox (EVCC)

**Pfad:** `src/addons/wallbox/`

```text
beliebige Wallbox → EVCC → EMS-Light (Telemetrie + gesteuerte Writes)
```

- Liest konfigurierte EVCC-Fremd-States, normalisiert und spiegelt nach `addons.wallbox.evcc.*`
- Daily-Plan-Allocation → Dryrun-Dispatch → `executeWallboxWrite()` (seit v0.1.177 **echte Writes** für den EVCC-Control-Pfad, kontrolliert freigegeben über `WALLBOX_LIVE_WRITE_RELEASED = true`)
- Feedback-Loop: nach jedem Write wird der Soll-/Ist-Vertrag (`runtime/feedback.ts`) per periodischem Safety-Tick (`runtime/feedback_tick.ts`, 10s) gegen die Readback-States geprüft
- Safety-Schicht analog Heizstab/Batterie: Ownership (`runtime/ownership.ts`), Fault/Lockout (`runtime/fault.ts`, State `fault_reset` zum manuellen Rücksetzen), Safe-Restore auf den konfigurierten EVCC-Hold-Modus beim Verlassen von Live (`runtime/restore.ts`)
- Fahrzeugprofile + SOC/Energie-Fallback unter `wb_vehicle_profiles` / Runtime-States
- Legacy-Direktpfad (`legacy_direct`, ehem. go-e) bleibt strukturell nie `liveEligible` — nur der EVCC-Control-Pfad kann live schreiben
- Backup/Restore/State-Tree: siehe `docs/EMS_LIGHT_V0_1_140*.md` … `143*.md` und Admin-Tab Backup

Legacy go-e-Write-Mappings (`wb_set_*`) bleiben in der Config, werden von der Runtime nicht mehr genutzt.

Details: `docs/EMS_LIGHT_WALLBOX_*.md` (Index in `docs/README.md`).

---

## 9. Heizstab (Immersion Heater)

**Pfad:** `src/addons/immersion_heater/`

Vier Ebenen:

1. **Gerätekonfiguration** — Admin `immersionHeaterTab`
2. **User Intent** — `user_intent.thermal.*`, Control-States
3. **Planung** — Daily-Plan-Allocation (Auto); bei fehlendem Plan lokaler Sicherheits-Default (Pflicht-Untergrenze), kein Legacy-Realtime-Planner (Block 3/4)
4. **Execution & Safety** — Runtime FSM, Live-Writes

**Entscheidungskette (Auto):** Safety/Fault → Off → Force → Daily Plan → Sicherheits-Default → AUS

**Runtime-States:** `addons.immersion_heater.runtime.*` inkl. detailliertem `decision_source`, `allocated_power_w`, Daily-Plan-Status; einheitliche Surface unter `runtime.surface.*` (Block 7)

Details: `docs/EMS_LIGHT_IMMERSION_DAILY_PLAN_RUNTIME.md`

**Safety:** Leistungsprüfung, Relaisüberwachung, Fault Lockout, Mindestlaufzeit/-pause

**Ausführung:**

- **Dryrun:** keine Gerätewrites, simuliert geplanten Zustand
- **Live:** Schreiben auf konfigurierte Stage-`set_state` (nur wenn `global.live ∧ addon.live`)

---

## 9a. Klima (Air Conditioning)

**Pfad:** `src/addons/air_conditioning/`

- Thermostat-FSM, SmartThings-Profile, Cleaning, Rate Limits
- **Daily Plan (v0.1.130):** pro Unit `air_conditioning.unit_1..5` als Leistungsfreigabe
- **Governance-Gate:** `isAddonGovernanceEnabledFromState(..., "climate")` in Runtime

Details: `docs/EMS_LIGHT_AC_DAILY_PLAN_RUNTIME.md`

**Ausführung:**

- **Dryrun:** keine SmartThings-Writes, simuliert Zustand
- **Live:** Profil-Sequenzen nur bei Governance + Live-Gate

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
- **Zentrale Write-Funktion (`runtime/execute.ts`):** alle realen Batterie-Writes laufen über `executeBatteryWrite`; das finale Gate prüft unmittelbar vor `setForeignState` global Live, Governance, Profilbereitschaft, Intent, Telemetrie, Fault/Lockout, Mapping und Ownership — seit v0.1.178 mit den echten FSM-/Ownership-Zuständen verdrahtet (`runtime.faultCode`, `runtime.lockout`, `isForeignManualControl`), nicht mehr mit Platzhaltern.
- **Ownership & Safe Restore:** EMS führt Safe Restore nur aus, wenn es die Batterie selbst in den manuellen Modus versetzt hat; fremde manuelle Steuerung wird nicht überschrieben. Die Restore-Sequenz (`stop_charge → restore_self_consumption → restore_grid_balance`) läuft auch bei aktivem Fault/Lockout weiter (`isBatterySafetyWriteState`), damit der Fehlerzustand kontrolliert verlassen werden kann.
- **`safety_blocked`-Stop:** Hardware-SOC-Obergrenze (`bat_hw_max_soc_pct`) stoppt eine aktive Ladung unabhängig vom Intent-Ziel, sobald sie erreicht ist.
- **Failsafe (`failsafe.ts`, seit v0.1.178):** eigenständiger, FSM-unabhängiger Sicherheitspfad analog Wallbox/Heizstab — läuft über den globalen `failsafe_runner.ts`-Timer und erzwingt bei EMS-Unreachable (Haupt-Tick hängt/Adapter-Crash) Ladeleistung 0 W + Self-Consumption per Direkt-Write. `batteryUnloadRestore` in `index.ts` deckt weiterhin den sauberen Adapter-Unload ab.
- **Verhältnis zu Governance/Learning:** `battery_enabled = false` stoppt Steuerung kontrolliert, Telemetrie und Battery Runtime Learning laufen weiter.
- **Daily Plan (v0.1.132):** Ladepfad liest `planner.intent.allocation.battery.plan_json`, setzt Ladeleistungsobergrenze, blockiert Grid Balance bei autoritativem Plan. Details: `docs/EMS_LIGHT_BATTERY_DAILY_PLAN_RUNTIME.md`

---

## 12a. Einheitliche Runtime-Surface (Block 7)

**Pfad:** `src/addons/runtime_surface/`

Alle Kern-Add-ons (Wallbox, Heizstab, Batterie, Klima/`air_conditioning`) publizieren am Tick-Ende dieselben Felder unter:

`addons.<runtimeId>.runtime.surface.{decision_source,decision_detail,decision_reason,last_decision_at,planner_status,intent_status,execution_status,profile_ready,telemetry_ready,fault,lockout}`

- `decision_source` = Masterplan-Enum (kanonisch)
- `decision_detail` = bisherige Add-on-Detailquelle (bestehende `runtime.decision_source`-Leaves bleiben)
- Ensure: `ensureAddonRuntimeSurfaceStates` in `bootstrap/ensure_static_tree.ts`

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
- (erledigt v0.1.206) Optionale KI-Optimierung mit Write-back nur bei messbarem Plan-B-Vorteil — siehe Masterplan §13
- (erledigt v0.1.215) Einheitliche Runtime-States (`addons.<id>.runtime.surface.*`, Masterplan §10 / Roadmap Block 7)
- Weitere Batterie-Steuerprofile (Sonnen Performance, Fronius, Victron, …) und bestätigte Entladesteuerung (Roadmap Block 8)

**Bereits produktiv (nicht mehr „geplant“):** General Operator (Forecast + Daily Plan + Allocation), Heizstab/Klima/Batterie-Laden über Daily Plan, Wallbox EVCC-Control-Pfad mit echten Live-Writes, Feedback-Verifikation und Safety-Schicht (Ownership/Fault/Restore).

Details und Zielbild: `docs/EMS_LIGHT_MASTERPLAN.md`. Priorität bis 10.08.2026: `docs/README.md`.
