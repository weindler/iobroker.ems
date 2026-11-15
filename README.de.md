![Logo](admin/ems.png)

# ioBroker.ems — EMS-Light

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Energiemanagement für ioBroker, das PV-Überschuss, dynamische Strompreise und flexible Verbraucher gemeinsam plant — und dabei sicher bleibt: **Jedes Gerät startet im Dryrun**, es wird nichts an Hardware geschrieben, bis du es ausdrücklich auf Live stellst.

> **Status: Beta.** Entwickelt und betrieben an einer realen Anlage (Sonnen-Batterie, evcc-Wallbox, Tibber, Heizstab, Klimageräte). Auf anderen Anlagen sind Ecken und Kanten zu erwarten. Die Admin-Oberfläche ist derzeit **deutsch**, die englische Übersetzung folgt. [English description → README.md](README.md)

## Was der Adapter macht

EMS-Light erstellt **einen gemeinsamen Tagesplan** (rollierend 72 Stunden) aus PV-Prognose, Strompreisen, gelernter Hauslast und allen freigegebenen Verbrauchern und verteilt die Energie auf die Geräte:

- **PV-Prognose mit Lernen** – Hauptprognose, korrigiert um eine gelernte Abweichung und eine Tagesverlaufs-Korrektur; [Bright Sky](https://brightsky.dev) als zweite Quelle und Gegenprobe.
- **Dynamische Preise** – Stunden-/Viertelstundenpreise aus deiner Tarif-Integration (z. B. Tibber), optional erweitert durch [Energyforecast](https://www.energyforecast.de) (API-Token, längere Vorschau). Optional wöchentlicher Vergleichstarif für die Statistik.
- **Batterie** – Nachtreserve wird aus dem echten Verbrauch gelernt, kein fester Prozentwert. Sonnen-Profil (`sonnen_em`) und generisches Nur-Lesen-Profil. Netzladung läuft über evcc. Optional „Netzausgleich“ (Entladung nur, wenn der Preis es lohnt) mit dynamischer Schwelle aus den Ersatzkosten der Batterie und gelerntem Wirkungsgrad.
- **Wallbox / Auto** – über den [evcc-Adapter](https://github.com/evcc-io/evcc) (evcc bleibt alleiniger Wallbox-Controller).
- **Heizstab und Klima** – Laufzeit, Komfortgrenzen, gemeinsame Außengeräte-Leistung wird nur einmal gezählt, manuelle Bedienung wird respektiert (Geräte-Hoheit).
- **Gemessene Verbraucher** – bis zu 20 rein messende Verbraucher für die Statistik (werden nie geschaltet).
- **Statistik** – Tages-/Monats-/Zeitraumbilanz, Autarkie, Eigenverbrauch, Kosten und EMS-Mehrwert.
- **Betriebsseite** (`/adapter/ems/ems-charts.html?inst=ems.0`, auch im Admin) – Lage, 72-h-Entscheidungen, PV-Prognose gegen Bright Sky gegen Messung, Preisprognose gegen Ist, Batterie, Wärme, Klima, Auto.
- **Backup / Wiederherstellung** von Konfiguration und gelernten Daten im Admin (Download, Liste, alte Backups löschen).
- **Optionaler KI-Tagesanalyst** – nur beratender Text; er ändert nie den Plan und schaltet keine Geräte.

### Sicherheitsmodell

| Stufe | Bedeutung |
|---|---|
| Global **Dryrun** | plant und simuliert, schreibt nichts an Geräte |
| Global **Live** + Add-on **Live** | ein Gerät wird nur geschrieben, wenn beides Live ist, die Sicherheitsprüfungen bestehen und die Fähigkeit erlaubt ist |
| Failsafe | bleibt die Adapter-Schleife stehen, geht die Batterie in einen sicheren Zustand (0 W, Eigenverbrauch) |
| Neuinstallation / Restore | startet immer im Dryrun |

## Voraussetzungen

- ioBroker mit **js-controller ≥ 5.0.19**, **Admin ≥ 6.0.0**, **Node.js ≥ 20**
- PV-, Netz- und Hauslast-Quelle als ioBroker-States (im Admin zugeordnet — jeder Adapter funktioniert)
- Optional je nach Hardware: [evcc](https://github.com/evcc-io/evcc)-Adapter, Sonnen-Adapter, Tibber-Adapter, [Bright-Sky](https://github.com/ioBroker/ioBroker.brightsky)-Adapter, Home-Assistant-Adapter (Tibber Grid Rewards)
- Läuft im Compact-Mode. Bei großen Anlagen mit etwa 400–600 MB RSS rechnen.

## Installation

Solange der Adapter nicht im Repository ist, von GitHub installieren:

```bash
iobroker url https://github.com/weindler/iobroker.ems
```

Danach eine Instanz anlegen, die Einstellungen öffnen und die Tabs durcharbeiten: **Global** (Datenquellen, Geräte, Preisquelle, Strategie) → Gerätetabs (im Dryrun lassen) → **Statistik** / **Learning**. Die Betriebsseite ein bis zwei Tage beobachten, bevor irgendetwas auf Live gestellt wird.

## Daten und Datenschutz

Der Adapter läuft lokal. Ausgehende Verbindungen gibt es **nur** für Funktionen, die du aktivierst: Bright Sky (Wetter/Solar), Energyforecast (Token, verschlüsselt gespeichert), SMARD/Verivox (optional Preisstatistik/Vergleichstarif), OpenAI (optional KI-Analyst, Schlüssel nötig). Gelernte Daten liegen im eigenen Datenordner `ems.<Instanz>`; es werden keine Daten an den Autor gesendet.

## Dokumentation

Entwickler- und Konzeptdokumente liegen in [docs/](docs/README.md).

## Änderungsverlauf

Die vollständige Historie steht in [CHANGELOG.md](CHANGELOG.md).

## Lizenz

MIT License — Copyright (c) 2026 weindler. Der vollständige Text steht in [LICENSE](LICENSE).
