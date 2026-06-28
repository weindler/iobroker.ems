# EMS-Light (`iobroker.ems`)

Eigenständiger ioBroker-Adapter für sicheres Energiemanagement — ohne Abhängigkeit von einem externen EMS-Server.

**Aktuelle Version:** v0.1.63

---

## Was ist EMS-Light?

EMS-Light liest Messwerte, lernt aus historischen Daten, wendet Betreiber-Policies an und steuert Add-ons (Wallbox, Heizstab, …) über einen sicheren Dryrun/Live-Gate.

Die KI ist **optional** und wird später als Optimierungsschicht ergänzt. EMS-Light muss jederzeit ohne KI vollständig und sicher arbeiten.

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
| KI / General Operator | *geplant* |
| Batterie-Geräteprofile | *geplant* |

---

## Installation

Auf einem ioBroker-Host:

```bash
iobroker url install github:weindler/iobroker.ems#v0.1.63
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

- **Global** — Ausführungsmodus, Global Mode, Tick-Intervall
- **Wallbox** — EVCC-Telemetrie-Mappings (read-only)
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
