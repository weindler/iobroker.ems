# EMS-Light v0.1.140 — State Tree Recovery

## Zweck

Diese Version sichert den **automatischen Wiederaufbau** des eigenen EMS-Light-Objekt- und State-Namespace (`ems.0.*`) nach kontrollierter Löschung ab.

**Enthalten:** Bootstrap-Reihenfolge, sicherer Cold Start, idempotente Neustarts, Integrationstests.

**Nicht enthalten:** Backup-Export, Import, Restore, Backitup-Integration (geplant ab v0.1.141–v0.1.143).

---

## Voraussetzungen

- Die **Adapterkonfiguration** (`system.adapter.ems.0.native`) bleibt erhalten — Mappings, Fahrzeugprofile, Ausführungsmodi in der Admin-UI überleben das Löschen von `ems.0.*`.
- Es wird **ausschließlich der eigene Namespace** `ems.0.*` entfernt — keine fremden Datenpunkte löschen.
- Vor produktivem Einsatz: Test in einer **Testinstanz** oder mit vorherigem **ioBroker-Gesamtbackup**.

---

## Cold Start und Live-Konfiguration

Die Adapterkonfiguration kann eine vollständige Löschung von `ems.0.*` überleben. **Auch wenn dort zuvor `live` konfiguriert war**, startet der wiederaufgebaute Namespace zwingend in **`dryrun`**:

- Erkennung: vor dem ersten Ensure fehlen alle Marker-Objekte (`global`, `global.execution_mode`, `system.version`, `command.inbox`).
- Der effektive Runtime-Zustand wird per Cold-Start-Recovery-Override auf `dryrun` geklemmt (lokal im Bootstrap-Laufkontext, kein dauerhaftes Modul-Global).
- Die Admin-Konfiguration wird dabei **nicht** automatisch geändert.
- Eine automatische Wiederaufnahme von `live` ist ausgeschlossen.
- Live-Betrieb erfordert anschließend eine **bewusste Benutzeraktion** (Objektbaum oder Admin).

Diese Regel gilt auch für spätere Restore-Blöcke (v0.1.142, v0.1.143): ein frisch wiederaufgebauter Namespace startet nie automatisch live.

Beim **normalen Warmstart** (bestehende Runtime-States vorhanden) bleibt die bisherige Semantik unverändert — gültige Laufzeitwerte werden beibehalten.

---

## Kontrollierter Ablauf

1. **Adapter stoppen** (Instanz `ems.0` in der ioBroker-Administration).
2. Sicherstellen, dass **keine Live-Ausführung** aktiv ist (global und Add-ons auf Dryrun bzw. deaktiviert).
3. **Nur** den eigenen Namespace `ems.0.*` kontrolliert entfernen:
   - Über die ioBroker-Objektverwaltung: Objektbaum unter `ems.0` selektieren und löschen, **oder**
   - Über Experten-Einstellungen / Objekttab — nicht fremde Adapter-Namespace löschen.
4. **Adapter starten.**
5. **Log prüfen** auf Bootstrap-Fehler (`Bootstrap abgebrochen vor Runtime`, `init step '…' failed`) und ggf. Meldung `Cold-Start-Recovery: Ausführungsmodi auf dryrun geklemmt`.
6. **Globale und Add-on-Ausführungsmodi** prüfen (`global.execution_mode`, `addons.*.mode`) — müssen `dryrun` sein.
7. Sicherstellen, dass alles im **Dryrun** bzw. sicher deaktiviert ist — kein automatischer Live-Modus.
8. **Dynamische Fahrzeugprofile** prüfen (`addons.wallbox.vehicles.<vehicle_id>.*` entsprechend Admin-Konfiguration).
9. **Mappings und externe Eingänge** prüfen (EVCC, Sensoren, Tarife).
10. Erst nach **bewusster Kontrolle** weitere Betriebsfreigaben (z. B. Live-Modus) durchführen.

---

## Erwartetes Verhalten

| Aspekt | Verhalten |
|--------|-----------|
| State Tree | wird beim Start automatisch wieder aufgebaut |
| Admin-Konfiguration | bleibt aus `system.adapter.ems.0` erhalten (kann `live` enthalten) |
| Effektive Runtime-Modi nach Cold Start | zwingend **`dryrun`** (global + alle Add-ons) |
| Runtime-/Historien-States | nach vollständiger Löschung von `ems.0.*` **nicht** wiederherstellbar (ohne späteres Backup) |
| Fehlende Persistenz | führt zu **sicherem Cold Start** (Dryrun, keine Geräteaktion) |
| Live-Betrieb | **keine** automatische Wiederaufnahme |
| Zweiter Start | idempotent — keine doppelten Objekte, keine Überschreibung gültiger Benutzerwerte |

### Startup-Phasen (v0.1.140)

```
A  Config (Admin, bereits geladen)
B  Statischer Objektbaum (Basis-States, Planner/Policy/Intent/Learning-Objekte, Add-on-Basis)
C  Dynamische Strukturen (`wb_vehicle_profiles` → Profilordner)
D  Persistenz-Hydration (siehe Inventar unten)
   Sync Governance, Ausführungsmodi (mit Cold-Start-Override), Mappings
E  Subscriptions (Add-on-Module)
F  Runtime (Failsafe, EMS-Light inkl. Policy/Intent/Learning-Ticks)
   Bootstrap-Barriere öffnet → stateChange aktiv
   Post-Bootstrap-Reconciliation (Wallbox, Batterie, Heizstab, Klima)
```

### Phase D — Persistenz-Inventar

| Quelle | Datei / State | Modul | Zeitpunkt | Fehlend | Ungültig | Erste Entscheidung |
|--------|---------------|-------|-----------|---------|----------|-------------------|
| Learning-Spiegel | `learning.persistence.*_json` → Instanzdaten | `persistence_mirror` | **Phase D** | Cold Start | ignoriert, kein Abbruch | nein (Learning) |
| Intent-Persistenz | `intent/intent_v1.json` | `intent/engine` | **Phase D** | leerer Intent | defensiv | ja (Intent-Auswertung) |
| Heizstab-Runtime | `immersion_heater/runtime.json` | `immersion_heater/runtime` | **Phase D** | leerer Persist | defensiv | ja (FSM-Modus) |
| Klima-Runtime | `air_conditioning/runtime.json` | `air_conditioning/runtime` | **Phase D** | leerer Persist | defensiv | ja (Unit-FSM) |
| VehicleRollforwardAnchor | `addons.wallbox.vehicles.<id>.estimation.baseline_*` | `wallbox/vehicles` | **Phase D** | kein Anker | nur `direct`-Baseline | ja (SOC-Rollforward) |
| VehicleLastTrustedSnapshot | `…estimation.last_trusted_*` | `wallbox/vehicles` | **Phase D** | kein Snapshot | nur trusted sources | ja (SOC-Fallback) |
| Session-Zähler | `…estimation.baseline_session_energy_kwh` | `wallbox/vehicles` | **Phase D** | null | ignoriert | ja (Rollforward) |
| Policy-Revision (Datei) | `policy/global.json` | `policy/engine` | Phase F Init | neu berechnet | ignoriert | nein (schreibend) |
| Power-Rollup | `power_rollup/hourly.json` | `learning/power_rollup` | Phase F Init | leer | defensiv | nein |
| Energy-Daily-Rollup | `energy_daily/daily.json` | `learning/energy_daily_rollup` | Phase F Init | leer | defensiv | nein |
| Consumer-Stats | `consumer_stats/*.json` | `learning/consumer_stats` | Phase F Modul-Init | leer | defensiv | nein |
| Battery-FSM | — (In-Memory, kein Disk-Persist) | `battery/runtime/fsm` | Phase E Start | frischer FSM | — | ja (Live-Tick) |
| Battery-Ownership | Fremd-Modus-Lesezugriff | `battery/index` | Phase E Start | none | foreign_manual | ja (Live-Tick) |
| Wallbox-EVCC-Telemetrie | Fremdstates (EVCC) | `wallbox/index` | Phase E Initial-Read | missing fields | ignoriert | nein (Mirror) |
| Planner-/Intent-Spiegel | States (kein separates File) | Planner/Intent | Phase F | Defaults | defensiv | indirekt |

**Fahrzeugpersistenz (v0.1.139):** Rollforward-Anker, Last-Trusted-Snapshot und Session-Zähler werden in Phase D pro Profil (`vehicle_id`) hydriert — vor der ersten SOC-Auflösung in Phase E. Profilisolation bleibt erhalten. Fehlende oder ungültige Baselines erzeugen keinen künstlichen Anker; Fallback-Werte verlängern Last-Trusted nicht.

**Regel:** Entscheidungsrelevante Persistenz wird in Phase D hydriert oder synchron beim Modulstart vor Subscriptions/Ticks (Battery-FSM-Reset, Ownership-Check).

### Post-Bootstrap-Reconciliation

Subscriptions werden in Phase E/F registriert, während `onStateChange` bis `markBootstrapComplete()` blockiert ist. Eingehende Änderungen in dieser Lücke werden nach Barriereöffnung per Reconciliation nachgezogen:

| Modul | Reconciliation | Begründung |
|-------|----------------|------------|
| Wallbox | `refreshWallboxEvccTelemetry()` | EVCC-Fremdstates + Fahrzeug-SOC |
| Batterie | `runBatteryControlTick()` | erneuter Telemetrie-/Mirror-Read |
| Heizstab | `refreshImmersionHeaterRuntime()` | Puffer-Temp, Feedback, Intent |
| Klima | `refreshAirConditioningRuntime()` | Unit-Fremdstates, Feedback |
| Policy/Intent/Execution | kein separater Refresh | Initial-Run in Phase F unmittelbar vor Barriere; keine Geräteaktion |
| Command Inbox | `process pending inbox` in `onReady` nach Barriere | separater Nachlauf in `main.ts` |

Keine doppelten Subscriptions oder Timer — Reconciliation nutzt bestehende Tick-/Refresh-Funktionen.

**Phase D** lädt explizit:

- Learning-Persistenz-Spiegel (`learning.persistence.*_json`)
- Intent-Persistenz (`intent/intent_v1.json`)
- Heizstab-Runtime-Persistenz (`immersion_heater/runtime.json`)
- Klima-Runtime-Persistenz (`air_conditioning/runtime.json`)
- Wallbox-Fahrzeug-SOC-Persistenz (Rollforward-Anker, Last-Trusted, Session-Zähler aus States)

Host-Wrapper (`withLearningDataPath`, `withHistoryBridge`) erweitern Hosts per `Object.create(host)` — ohne das Ursprungsobjekt zu mutieren.

---

## Grenzen

- **Kein Backup-Export** (v0.1.141)
- **Kein Import / Restore** (v0.1.142)
- **Keine Backitup-Integration** (v0.1.143)
- Gelöschte historische Runtime-Werte unter `ems.0.*` sind ohne vorheriges Backup **nicht rekonstruierbar**
- JSON-Persistenz im Instanz-Datenordner kann `ems.0.*`-Löschung überleben — Verhalten ist dokumentiert, kein automatischer Voll-Restore

---

## Referenz

- Implementierung: `src/bootstrap/startup.ts`, `src/bootstrap/cold_start.ts`, `src/bootstrap/context.ts`, `src/bootstrap/persist_hydrate.ts`, `src/bootstrap/reconcile.ts`
- Integrationstests: `src/bootstrap/startup.test.ts` (Szenarien A–I), `src/learning/host_wrapper.test.ts`
- Architektur: `docs/ARCHITECTURE.md` (Abschnitt Recovery v0.1.140)
