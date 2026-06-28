# EMS-Light (`iobroker.ems`)

Eigenständiger ioBroker-Adapter für sicheres Energiemanagement — ohne Abhängigkeit von einem externen EMS-Server.

**Aktuelle Version:** v0.1.65

---

## Was ist EMS-Light?

EMS-Light liest Messwerte, lernt aus historischen Daten, wendet Betreiber-Policies an und steuert Add-ons (Wallbox, Heizstab, …) über einen sicheren Dryrun/Live-Gate.

EMS-Light muss jederzeit ohne KI vollständig und sicher arbeiten. Die KI-Freigabe je Add-on ist eine gespeicherte Opt-in-Einstellung für eine spätere Optimierungsschicht — **noch ohne KI-Implementierung**.

---

## Aktueller Funktionsumfang

| Bereich | Status |
|---------|--------|
| Global Modes (`off`/`eco`/`balanced`/`comfort`/`forced`) | implementiert |
| Policy Engine (configured/effective) | implementiert |
| User Intent (Wallbox, Thermal, Battery) | read-only |
| Learning (PV-Bias, Wetter, Preis, Hauslast, Thermal/Battery Runtime) | implementiert |
| Wallbox via EVCC | read-only Telemetrie |
| Heizstab (Immersion Heater) | Runtime, FSM, Safety, Live-Writes |
| Command Pipeline (Dryrun/Live) | implementiert |
| Add-on-Governance (GLOBAL: aktiv + KI-Freigabe) | implementiert |
| Batterie: Profile `generic_readonly` + `sonnen_em` (Read-only/Dryrun/Live) | implementiert |
| KI / General Operator | *geplant* |
| Weitere Batterie-Steuerprofile (Fronius, Victron, …) | *geplant* |

---

## Installation

Auf einem ioBroker-Host:

```bash
iobroker url install github:weindler/iobroker.ems#v0.1.67
```

Oder aus Git-Checkout:

```bash
git clone git@github.com:weindler/iobroker.ems.git
cd iobroker.ems
npm ci && npm run build
iobroker dev install .
```

Danach: **Adapters → EMS-Light → Instanz hinzufügen** (Standard-Namespace: `ems.0`).

Update:

```bash
iobroker update ems
```

---

## Konfiguration

Instanz-Einstellungen in der ioBroker-Admin-Oberfläche:

- **Global** — Ausführungsmodus, Global Mode, **Add-on-Steuerung** (Aktiv + optionale KI-Freigabe je Add-on), Tick-Intervall
- **Wallbox** — EVCC-Telemetrie-Mappings (read-only)
- **Batterie** — Hardware (Hersteller/Modell/Kapazität), Steuerprofil (`generic_readonly` / `sonnen_em`), Telemetrie-Mapping, Hardwaregrenzen, Sonnen-Mapping/Sequenz/Netzausgleich, Diagnose
- **Heizstab** — Stufen, Temperatur, Safety-Parameter
- **EMS-Light User Intent** — Defaults und ioBroker-Request-Einstellungen

EVCC-Mappings unter Tab „Wallbox"; Intent-relevante EVCC-Felder dort konfigurieren.

---

## Observe / Dryrun / Live

| Modus | Verhalten |
|-------|-----------|
| **Dryrun** (Standard) | Intents und Dryrun-States werden erzeugt; **keine** Geräte-Writes |
| **Live** | Echte Geräte-Writes nur wenn `global.execution_mode = live` **und** `addons.<id>.mode = live` und Safety/Fault erlauben |
| **Observe** | *geplant* — lesen, lernen, planen, keine Ausführung |

Sicherheitsdefaults: alles auf `dryrun`.

Wallbox ist aktuell **vollständig read-only** (keine EVCC- oder Wallbox-Writes).

### Batterie

- **Generic Read-only** — liest und normalisiert Telemetrie, keinerlei Geräte-Writes.
- **Sonnen EM** — vollständige Steuerung (Modus 1/2, Ladeleistung, Feedback, Safe Restore, optionaler Netzausgleich) über eine gemeinsame FSM; Dryrun simuliert exakt den Live-Ablauf.
- Live nur nach bewusster globaler Freigabe (`global.execution_mode = live`) und allen Safety-/Ownership-Gates. Im aktuellen Betrieb bleibt der globale Modus `dryrun` — es finden **keine** realen Batterie-Writes statt.

---

## Entwicklung

```bash
npm ci
npm run check
npm test
npm run build
```

Details: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)

---

## Dokumentation

| Dokument | Inhalt |
|----------|--------|
| [docs/EMS_LIGHT_MASTERPLAN.md](docs/EMS_LIGHT_MASTERPLAN.md) | Verbindlicher Fahrplan und Architekturentscheidungen |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Implementierte technische Architektur (Ist-Stand) |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Build, Tests, Release, Git- und Dokumentationsregeln |
| [CHANGELOG.md](CHANGELOG.md) | Veröffentlichte Änderungen |

---

## Lizenz

MIT — siehe [LICENSE](LICENSE).
