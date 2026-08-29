# EMS-Light (`iobroker.ems`)

Eigenständiger ioBroker-Adapter für sicheres Energiemanagement — ohne Abhängigkeit von einem externen EMS-Server.

**Aktuelle Version:** v0.2.4

---

## Was ist EMS-Light?

EMS-Light liest Messwerte, lernt aus historischen Daten, wendet Betreiber-Policies an und steuert Add-ons (Wallbox, Heizstab, Batterie, Klima) über Dryrun/Live-Gates.

EMS-Light muss jederzeit ohne KI vollständig und sicher arbeiten. Die KI-Freigabe je Add-on ist Opt-in für eine spätere Optimierungsschicht — **noch ohne KI-Implementierung**.

Planung läuft über den **General Operator** (Forecast Plan → Daily Plan → Allocation). Der schwere Planner-Shadow/Takeover ist abgeschaltet.

---

## Aktueller Funktionsumfang

| Bereich | Status |
|---------|--------|
| Global Modes (`off`/`eco`/`balanced`/`comfort`/`forced`) | implementiert |
| Policy Engine | implementiert |
| Learning (PV-Bias, Horizon, Wetter, Preis, Hauslast, …) | implementiert |
| Forecast Plan + Daily Plan + Allocation | implementiert |
| Wallbox via EVCC (Telemetrie + Write/Feedback-Pfad) | implementiert (Live freigeben nach Dryrun) |
| Heizstab / Klima | Runtime + Daily Plan; Klima-Hard-Off bis in den Unified Planner (restlaufzeit-/komfortabhängig) |
| Batterie (`generic_readonly`, `sonnen_em`) | Laden über Daily Plan; Entladung über zentrale Discharge Authority im Unified Planner geplant — Live-Freigabe für Entladung in der Beta eingeschränkt |
| Batterie-Reserve | dynamisch aus gelerntem Nachtverbrauch + `requiredSocAtPvEndPct` — kein fester 50 %-Policywert mehr |
| AC Shared Outdoor Unit Power | gemeinsame Außengeräte-Leistung wird nur einmal gezählt (keine Doppelzählung bei mehreren Innengeräten) |
| Device Ownership / Manual Override (Klima, Heizstab) | manuelle Bedienung erzeugt zeitlich begrenzte Freigabe für Nutzer-/Fremdsteuerung; EMS schreibt währenddessen nicht zurück (Safety/Fault übersteuert immer) |
| Measured Consumers (bis zu 20 Verbraucher) | rein messend/Statistik — EMS schaltet diese Geräte **nie** und rechnet sie **nie** zum Hausverbrauch hinzu |
| Backup / Support / Restore / Diagnosemodus | implementiert |
| Add-on-Governance (aktiv + KI-Freigabe) | implementiert (KI noch ohne Aufruf) |
| KI-Optimierung | *geplant* |
| Weitere Batterie-Profile | *geplant* |

---

## Installation

Auf einem ioBroker-Host (Beispiel Branch-Commit):

```bash
iobroker url weindler/iobroker.ems#<commit-hash>
```

Oder lokal:

```bash
git clone git@github.com:weindler/iobroker.ems.git
cd iobroker.ems
npm ci
npm run build
iobroker dev install .
```

---

## Entwicklung

```bash
npm run check
npm test
npm run build
```

Details: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)

---

## Dokumentation

Einstieg: **[docs/README.md](docs/README.md)** (Index + Priorität bis 10.08.2026).

| Dokument | Inhalt |
|----------|--------|
| [docs/README.md](docs/README.md) | Index und Roadmap-Priorität |
| [docs/EMS_LIGHT_MASTERPLAN.md](docs/EMS_LIGHT_MASTERPLAN.md) | Verbindliches Zielbild |
| [docs/EMS_LIGHT_OPERATOR_FOUNDATION.md](docs/EMS_LIGHT_OPERATOR_FOUNDATION.md) | Operator-Pipeline |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Ist-Stand Architektur |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Build, Tests, Doc-Regeln |
| [CHANGELOG.md](CHANGELOG.md) | Änderungen |

---

## Lizenz

MIT — siehe [LICENSE](LICENSE).
