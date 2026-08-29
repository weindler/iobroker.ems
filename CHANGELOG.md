# Changelog

Alle veröffentlichten Änderungen am ioBroker-Adapter **EMS-Light** (`iobroker.ems`).

Format basiert auf [Keep a Changelog](https://keepachangelog.com/). Versionierung folgt [SemVer](https://semver.org/).

---

## [0.2.1] – 2026-08-29

### Fixed

- **Grid-Balance Diagnose-States:** `policy_excluded_load_w` / `policy_excluded_reason_de` werden nach `ensure` nicht mehr vom Surface-Cleanup als Ballast gelöscht (ioBroker-Warnung „has no existing object“).

---

## [0.2.0] – 2026-08-29

Konsolidiert die Unified-Energy-Planning-Arbeit seit 0.1.119 (Batterie, Klima, Ownership, gemessene Verbraucher). Details je Zwischenversion siehe Git-Historie/`io-package.json` News.

### Added

- **Battery Discharge Authority (zentral):** Der Unified Planner entscheidet, ob/wie viel Batterieentladung wirtschaftlich zulässig ist (`allowed`, `maxDischargeW`, Reason/Diagnostics); `grid_balance.ts` führt nur noch aus und begrenzt nie mehr, als der Planner erlaubt.
- **Dynamische Batterie-Reserve:** `predictedNightConsumptionKwh` (gelernt aus Nachtlänge + realem Verbrauch/SOC-Verlauf) und daraus abgeleitetes `requiredSocAtPvEndPct` ersetzen die feste 50 %-Policy-Grenze; konservativer Fallback bei fehlenden Lerndaten.
- **Batterie-Diagnostik:** `estimatedBatteryEmptyAtIso`, `energyToTargetKwh`/`estimatedChargeTimeToTarget` für Restlaufzeit- und Ladezeit-Transparenz.
- **Thermal-/Immersion-PV-Precharge:** reale Reichweiten-/PV-Betrachtung (`nextPvHeatOpportunityIso`, Reserve-Diagnostik) statt starrer Zeitfenster.
- **AC Hard-Off im Unified Planner:** `hardStopMs` je Klima-Unit fließt in die Slot-Allokation ein; `hard_off_worth_it` bewertet Start-Sinnhaftigkeit anhand Restlaufzeit und Komfort-Dringlichkeit (`demandUrgency01`) statt starrer Minutengrenze.
- **Shared AC Outdoor Unit Power:** gemeinsames Außengerät (Wohnzimmer + Josef Zimmer) wird als eine Systemleistung modelliert — keine Doppelzählung, wenn beide Innengeräte laufen.
- **Device Ownership / Manual Override:** generisches Modell (`ems`/`user`/`external`) für Klima und Heizstab; manuelle Bedienung erzeugt einen zeitlich begrenzten Override, EMS schreibt währenddessen nicht zurück; Safety/Fault übersteuert den Override immer.
- **Measured Consumers (neu, rein messend):** bis zu 20 konfigurierbare Verbraucher (Admin-Tabelle `ems_measured_consumers_map`) für Anzeige/Statistik/Learning-Vorbereitung — werden von EMS **nie** geschaltet und **nie** zum Hausverbrauch addiert. Leistungs-/Energie-Datenpunkt-Mapping, Start-/Übernahmewert, zählerreset-sicherer Gesamtstand, Tages-/Monats-/Jahres-/Gesamt-Statistik, `unknown_house_load_w` (bekannte vs. unbekannte Restlast), generische `consumers_json` als Vorbereitung für künftige ems-charts-Visualisierung.

### Changed

- Battery-Consumer-Policies (`mayUseBattery`, `onlyWhenCritical`) wirken jetzt auch gegen indirekte Batterienutzung über Netzausgleich.

### Known limitations

- Vorbestehend, nicht Teil dieses Releases: Backup-Export-Testfall `selected_state_data`/`v0.1.141`, Objekt-Oberflächen-Budget-Test (leere Config über 550 States), Boiler-Learning-Testfall (`runThermalBoilerLearning`).

---

## [0.1.119] – 2026-07-05

### Added

- **Planner Klima (Phase B-light):** `planCooling()` — erwartete kWh/Peak-W aus Admin-Config + Consumer-Stats-Learning (Median-W); Batterie reserviert Verbraucher-Last (`consumerAllocatedW`); States unter `planner.intent.cooling.*`.
- **Consumer-Stats-Learning:** generische `resolveConsumerEffectivePowerW()` für alle EMS-Verbraucher (Config-Fallback, gelernt ab 3 Tagen).

---

## [0.1.118] – 2026-07-05

### Changed

- **Klima-Reinigung:** Ende primär über SmartThings `progress = 100 %` (Josef-Mapping); `operatingState`/`autoCleaningMode` nur noch Fallback.

---

## [0.1.117] – 2026-07-05

### Fixed

- **Klima-Reinigung:** Feedback-Ende nach wenigen Sekunden — `operatingState=ready` ist auch der Idle-Zustand vor Start; Ende erst nach bestätigtem `autoClean` (≥ 60 s) und Mindestlaufzeit 5 min (oder `autoCleaningMode=off`).

---

## [0.1.116] – 2026-07-05

### Changed

- **Klima-Reinigung:** Ende über SmartThings-Feedback (`operatingState = ready` oder `autoCleaningMode = off` nach `autoClean`); `cleaning_duration_min` nur noch Timeout-Fallback; Refresh alle 30 s während Reinigung.
- **Admin/Mapping:** Odor-Controller (`cmd_cleaning_mode`) entfernt; neue Rückmeldungen `feedback_cleaning_state`, `feedback_cleaning_mode`, `feedback_cleaning_progress` (Josef/Wohnzimmer vorbefüllt).

---

## [0.1.115] – 2026-07-05

### Fixed

- **Consumer-Statistik (Klima/Heizstab):** `session_runtime_sec` blieb bei 0, obwohl `device_active`/`tracking` stimmten — Runtime-Host hatte kein `getAbsolutePath`, Persistenz wurde jeden Tick neu angelegt (`wasActive` nie fortgeschrieben).

---

## [0.1.114] – 2026-07-05

### Fixed

- **Klima-Statistik:** `session_runtime_sec` zählt auch im Dryrun und wenn `feedback_switch` noch aus ist — solange EMS die Session nach Start-Sequenz offen hat (nicht erst bei Feedback `on`).

---

## [0.1.113] – 2026-07-04

### Fixed

- **Klima-Statistik:** Laufzeit/kWh zählen live ab Start-Sequenz (nicht erst wenn `feedback_switch` nachzieht); Nennleistung 0 im Admin → Fallback 700 W für Verbrauchsberechnung.

---

## [0.1.112] – 2026-07-04

### Fixed

- **Klima Reinigung:** Timer in Persistenz (überlebt Neustart), nur einmal planen (nicht bei jedem Stop-Retry), Info-Logs (`cleaning scheduled/started/finished`); Samsung `setAutoCleaningMode` → `on` (wie Blockly autoClean).

---

## [0.1.111] – 2026-07-04

### Fixed

- **Klima Stopp:** Stop-Sequenz maximal einmal pro 60 s, solange `feedback_switch` noch `on` (SmartThings braucht Zeit wie beim Start).

---

## [0.1.110] – 2026-07-04

### Fixed

- **Klima-Start:** Nach SmartThings-Sequenz `feedback_switch` bis zu 18 s pollen (refresh → Status kommt oft verzögert); Warnung erst danach inkl. letztem Feedback-Wert.

---

## [0.1.109] – 2026-07-04

### Fixed

- **Klima / SmartThings 422:** Startsequenz schickt kein `cmd_cleaning_mode` mehr an Odor-Controller; Reinigung über `setAutoCleaningMode` mit gültigen Werten (`off`, `speedClean`) statt `autoClean`.
- **Statistik:** Laufzeit/kWh für Klima und Heizstab zählen bei aktivem Gerät auch im Dryrun (nicht nur live + Feedback).

---

## [0.1.108] – 2026-07-04

### Fixed

- **Klima / SmartThings:** Toggle-Impuls — vor `switch-on`/`refresh` ioBroker-Spiegel per `ack:true` auf `false` (kein Gerätebefehl), damit hängende `ON`-States den Impuls nicht schlucken; 3 s Wartezeit vor Feedback-Prüfung nach Startsequenz.

---

## [0.1.107] – 2026-07-04

### Fixed

- **Admin:** `jsonConfig` — Heizstab-Felder `ih_stage_count` / `ih_stage_1_nominal_power_w`: `helpText` → `help` (Schema-Validierung).

---

## [0.1.106] – 2026-07-04

### Fixed

- **Klima / SmartThings:** 429 Too Many Requests — keine State-Change-Abos mehr auf Schreib-/Impuls-States (`switch-on`, `refresh`, …); Toggle-Spiegel-Reset entfernt (nur noch `force`-Impuls); parallele Runtime-Ticks abgefangen.

---

## [0.1.105] – 2026-07-04

### Changed

- **Logging:** ioBroker-konforme Level — `info` nur noch für relevante Betriebsereignisse; Init-Schritte, Learning, History, Intent, Dryrun und Skip-Meldungen auf `debug`.

---

## [0.1.104] – 2026-07-04

### Fixed

- **Klima live (SmartThings):** `switch-on`/`switch-off`/`refresh` immer senden (`force`), hängende Toggle-States im Objektbaum nach Sequenz zurücksetzen, Start-Retry wenn Feedback noch `off`.
- **Klima Admin:** Josef Zimmer OG (Unit 2) Mapping vorbefüllt; Wohnzimmer Unit 1 für Live-Test standardmäßig deaktiviert.

---

## [0.1.72] – 2026-07-01

### Fixed

- **Battery-Runtime:** `secondsSinceFullCharge` nicht mehr hardcodiert — neue Mapping-Rolle `addons.battery.mapping.seconds_since_full_charge` (`bat_seconds_since_full_*` in Admin). Learning nutzt Mapping; optionaler Override im Learning-Tab.

---

## [0.1.71] – 2026-07-01

### Fixed

- **Battery-Runtime:** Vollladung/Top-Off nutzt primär **Sonnen `secondsSinceFullCharge`** (Geräte-Counter, echte Zelloptimierung bei 100 %). SOC-History nur Fallback. `days_since_full` zählt Kalendertage; neue States `seconds_since_full_charge`, `full_charge_source`.

---

## [0.1.70] – 2026-07-01

### Fixed

- `history.0`-Absturz bei parallelen EMS-`getHistory`-Anfragen: History-Queries laufen jetzt **serialisiert** (eine nach der other), Aggregate-Reihenfolge `none` vor `onchange`, kleineres Bulk-`count`-Limit, Exceptions werden abgefangen statt den history-Adapter zu reißen.

---

## [0.1.69] – 2026-07-01

### Fixed

- **PV-Bias:** `DAY_ENERGY` wurde fälschlich als Tages-**Maximum** aus der Historie gelesen. Nach dem Morgen-Reset des Zählers blieben alte Werte im Fenster und verfälschten Ist/Forecast-Paare (z. B. +141 % Bias bei ~7 kWh statt ~32 kWh).
- Vergangene Tage werden beim Start aus der Historie nachgezogen (**letzter Tageswert**, kein MAX).
- **`corrected_today_kwh`** nutzt jetzt den **7-Tage-Bias** (Fallback 30d), nicht den intraday `bias_today`.
- Unvollständiger heutiger Tag fließt nicht mehr in 7d/30d-Mittelwerte ein.

### Added

- Täglicher **Ist-Snapshot** um **23:58** (konfigurierbar): speichert `DAY_ENERGY` in `pv_bias_daily_v1.json`.
- Forecast wird beim **Freeze** (~06:00) zusätzlich in derselben Tagesdatei persistiert.
- Admin: Ist-Snapshot aktiv + Zeit; Backup-Spiegel unter `learning.persistence.pv_bias_daily_json`.

---

## [0.1.68] – 2026-06-28

### Fixed

- Adapter-Start blockierte ~30s, weil `subscribeForeignStatesAsync` mit einem Callback-Argument aufgerufen wurde — ioBroker interpretierte die Funktion als internen Completion-Callback, sodass das Promise nie auflöste. Betraf Wallbox-EVCC- und User-Intent-EVCC-Subscriptions. Foreign-Änderungen laufen weiterhin über `onStateChange`.

---

## [0.1.67] – 2026-06-28

### Fixed

- Adapter-Startdiagnose erweitert: Jeder Init-Schritt loggt Start/OK und bekommt einen Timeout. Hängende ioBroker-Aufrufe blockieren den restlichen Start nicht mehr; im Log ist der betroffene Schritt sichtbar.

---

## [0.1.66] – 2026-06-28

### Fixed

- Adapter-Start ist robust: Jeder Modul-Init (Wallbox, Batterie, Heizstab, Tarif, Learning) läuft isoliert — ein Fehler in einem Add-on blockiert nicht mehr das Anlegen des Learning-Objektbaums oder anderer Module.

### Added

- Backup-Spiegel der Learning-Zusammenfassungen als JSON-States unter `learning.persistence.*` (in ioBroker-Backups enthalten). Fehlt die Persist-Datei im Instanzordner (z. B. nach Adapter-Neuanlage), wird sie beim Start aus dem Spiegel-State wiederhergestellt.

---

## [0.1.65] – 2026-06-28

### Changed

- Batterieintegration vollständig neu aufgebaut: profilbasierte Architektur (`generic_readonly`, `sonnen_em`) mit Read-only, Dryrun und Live über **eine gemeinsame FSM**
- Neuer Batterie-Core: normalisierte Telemetrie (Vorzeichenkonvention), Kapazitäts-/Energieableitung, technische Hardwaregrenzen, Capability-Modell, neutraler Batterie-Intent
- Genau **eine** zentrale, gegatete Write-Funktion für alle realen Batterie-Writes; Feedbackprüfung, Ownership-Schutz, Safe Restore, Fault/Lockout
- Optionaler Sonnen-Netzausgleich läuft über dieselben Ausführungs- und Safety-Gates (Dryrun simuliert, Live nur nach allen Gates)
- Neue Admin-Seite Batterie (Hardware, Steuerprofil, Telemetrie-Mapping, Hardwaregrenzen, Sonnen-Mapping/Sequenz/Netzausgleich, Diagnose); Aktivierung/KI-Freigabe weiterhin nur unter GLOBAL

### Removed

- Alte herstellerspezifische Batterie-Geräteanbindung (Modus-Orchestrator, direkte Modus-/Charge-Writes, verstreute Gates, alte Failsafe-/Status-Module)

### Preserved

- Battery Runtime Learning und zentrale Add-on-Governance bleiben unverändert; globaler Ausführungsmodus bleibt `dryrun` (keine realen Geräte-Writes)

---

## [0.1.64] – 2026-06-28

### Added

- Zentrale Add-on-Governance unter Admin-Reiter **GLOBAL** (Aktiv + KI-Optimierung erlaubt) für Wallbox, Heizstab, Batterie und Klima
- Governance-Modul (`src/addons/governance/`) mit Registry, Konfigurationslesern und Runtime-States `addons.<id>.governance.*`
- Frühe Steuerungs-Gates (Intent/FSM) und finales Live-Write-Gate in Pipeline und Heizstab-Runtime
- KI-Freigabe standardmäßig aus (opt-in, noch ohne KI-Wirkung)

---

## [0.1.63] – 2026-06-28

### Fixed

- EVCC `plan_time` und `effective_plan_time` Spiegelstates werden bei null/ungültigem Wert auf `""` gesetzt (kein stale Deadline mehr)
- Go-Null-Zeit-Sentinel (`0001-01-01T00:00:00Z`) wird als „kein Plan" behandelt

---

## [0.1.62] – 2026-06-28

### Changed

- Wallbox vollständig auf EVCC read-only Mappings umgestellt
- Neue `addons.wallbox.evcc.*` States und Live-Cache aus EVCC
- Legacy go-e Write-Mappings in Config erhalten, von Runtime nicht mehr genutzt

---

## [0.1.61] – 2026-06-27

### Fixed

- Heizstab liest echtes Stage-Feedback statt Befehl zu spiegeln
- Dryrun zeigt Fremdbetrieb ohne Fault; `power_when_off` nur im Live nach EMS-AUS-Schreibung
- Intent-Requests werden nicht mehr anhand von `issued_at` als abgelaufen abgewiesen

---

## [0.1.60] – 2026-06-27

### Fixed

- Wallbox-Intent-Revision zählt nicht mehr bei jedem Poll hoch (volatile `observed_at` aus semantischem Hash ausgeschlossen)

---

## [0.1.58] – 2026-06-26

### Added

- Heizstab vollständige Anbindung: Runtime FSM, Mehrstufen-Ausführung, Safety, Fault Lockout (Live-Writes)

---

## [0.1.57] – 2026-06-26

### Added

- Add-on Intent Binding: Thermal (Heizstab) und Batterie User Intent Domains
- Gesamtvertrag `user_intent.resolved_all_json`

---

## [0.1.51] – 2026-06-25

### Added

- User Intent Foundation: read-only Erfassung Wallbox-Intent aus EVCC, ioBroker JSON, Admin-Defaults

---

## [0.1.46] – 2026-06-24

### Added

- Global Modes (`off`/`eco`/`balanced`/`comfort`/`forced`)
- Policy Engine Foundation (configured/effective, Merge, Validierung, Provenance)

---

## [0.1.0] – 2026-05-24

### Changed

- **Breaking:** Objektbaum unter `addons.<id>.mapping|dryrun|status`, global `execution_mode`
- Live-Writes nur wenn `global.live ∧ addon.live`

---

## [0.0.1] – 2026-05-23

### Added

- Erstversion: `ems.0` States, Command Inbox, Dryrun-only Pipeline

---

Ältere Versionen 'en'/'de' News-Einträge: siehe `io-package.json` → `common.news`.
