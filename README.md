# EMS-Light (`iobroker.ems`)

Eigenständiger ioBroker-Adapter für sicheres Energiemanagement — ohne Abhängigkeit von einem externen EMS-Server.

**Aktuelle Version:** v0.2.26

---

## Was ist EMS-Light?

EMS-Light liest Messwerte, lernt aus historischen Daten, wendet Betreiber-Policies an und steuert Add-ons (Wallbox, Heizstab, Batterie, Klima) über Dryrun/Live-Gates.

EMS-Light muss jederzeit ohne KI vollständig und sicher arbeiten. Der KI Daily Analyst und Planvergleich sind beratend; die produktive Allokation bleibt beim deterministischen Unified Planner.

Planung läuft über den **General Operator** (Forecast → Unified Daily Plan → gemeinsame Allocation). Shadow Engine und KI-Compare bewerten Gegenwelten, besitzen aber keine Geräte- oder LIVE-Plan-Autorität.

---

## Aktueller Funktionsumfang

| Bereich | Status |
|---------|--------|
| Global Modes (`off`/`eco`/`balanced`/`comfort`/`forced`) | implementiert |
| Policy Engine | implementiert |
| Learning (PV-Bias, Horizon, Wetter, Preis, Hauslast, …) | implementiert |
| Unified Plan + rollierender 72-h-Ausblick + Allocation | implementiert |
| Energie- und Wirtschaftsstatistik | Tages-/Monats-/Zeitraumbilanz, Autarkie, Eigenverbrauch, Geräte-PV-Anteile sowie Schnell/`now` getrennt nach Sonnen-Batterie, Netz und PV/lokal |
| Wallbox via EVCC (Telemetrie + Write/Feedback-Pfad) | implementiert; bei konfigurierten Tibber Grid Rewards einmalige Plug-in-Übergabe auf Schnell/`now` nach Wartezeit |
| Heizstab / Klima | Runtime + Daily Plan; Klima-Hard-Off bis in den Unified Planner (restlaufzeit-/komfortabhängig) |
| Batterie (`generic_readonly`, `sonnen_em`) | Laden über Daily Plan; Entladung über zentrale Discharge Authority im Unified Planner geplant — Live-Freigabe für Entladung in der Beta eingeschränkt |
| Batterie-Reserve | dynamisch aus gelerntem Nachtverbrauch + `requiredSocAtPvEndPct` — kein fester 50 %-Policywert mehr |
| AC Shared Outdoor Unit Power | gemeinsame Außengeräte-Leistung wird nur einmal gezählt (keine Doppelzählung bei mehreren Innengeräten) |
| Device Ownership / Manual Override (Klima, Heizstab) | manuelle Bedienung erzeugt zeitlich begrenzte Freigabe für Nutzer-/Fremdsteuerung; EMS schreibt währenddessen nicht zurück (Safety/Fault übersteuert immer) |
| Measured Consumers (bis zu 20 Verbraucher) | rein messend/Statistik — EMS schaltet diese Geräte **nie** und rechnet sie **nie** zum Hausverbrauch hinzu |
| Backup / Support / Restore / Diagnosemodus | implementiert |
| Add-on-Governance (aktiv + KI-Freigabe) | implementiert |
| KI Daily Analyst + Plan-A/Plan-B-Compare | implementiert, advisory only |
| VIS | sieben Bereiche: Betrieb, Statistik, Batterie, Heizstab/Wärme, Klima, Auto/Wallbox, Grid Balance |
| Geräte-/Herstellerkatalog | nur tatsächlich implementierte Templates, mit generischem Fallback |
| Lokale App-Grundlage | read-only Core-Vertrag und Snapshot; kein zweiter Steuerpfad |
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

Einstieg: **[docs/README.md](docs/README.md)**.

| Dokument | Inhalt |
|----------|--------|
| [docs/README.md](docs/README.md) | Index und Roadmap-Priorität |
| [docs/EMS_LIGHT_ONE_PLAN.md](docs/EMS_LIGHT_ONE_PLAN.md) | Verbindlicher One-Plan-Vertrag |
| [docs/EMS_LIGHT_WEEKEND_IMPLEMENTATION.md](docs/EMS_LIGHT_WEEKEND_IMPLEMENTATION.md) | Nachtreserve, Datenhaltung, 72 h, Shadow v4 und Teststatus |
| [CHANGELOG.md](CHANGELOG.md) | Änderungen |

---

## Lizenz

MIT — siehe [LICENSE](LICENSE).
