# Changelog

Alle veröffentlichten Änderungen am ioBroker-Adapter **EMS-Light** (`iobroker.ems`).

Format basiert auf [Keep a Changelog](https://keepachangelog.com/). Versionierung folgt [SemVer](https://semver.org/).

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
