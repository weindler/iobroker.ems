# EMS-Light – Entwicklung

Kurzanleitung für Entwickler am ioBroker-Adapter `iobroker.ems`.

---

## Voraussetzungen

- Node.js ≥ 18
- npm
- ioBroker js-controller ≥ 5.0.19 (für Installation auf einem ioBroker-Host)

---

## Installation

```bash
git clone git@github.com:weindler/iobroker.ems.git
cd iobroker.ems
npm ci
```

---

## Build, Check, Tests

```bash
npm run check    # TypeScript-Typprüfung (tsc --noEmit)
npm run build    # Kompiliert src/ → build/
npm test         # build + alle Unit-Tests (node --test)
```

`npm run lint` ist Alias für `npm run check`.

Tests liegen als `*.test.ts` neben dem Quellcode und werden nach `build/` kompiliert. Die Testliste steht in `package.json` unter `scripts.test` — **neue Testdateien dort ergänzen**, sonst werden sie nicht ausgeführt.

Batterie-Hinweis: Reale Geräte-Writes laufen ausschließlich über `executeBatteryWrite` (`src/addons/battery/runtime/execute.ts`). Tests dürfen keine echten Geräte-Datenpunkte beschreiben; sie nutzen Mock-Hosts und prüfen im Dryrun, dass kein `setForeignState` auf Zielgeräte erfolgt.

---

## Entwicklung auf ioBroker

```bash
npm run build
iobroker dev install .
```

Adapter-Instanz: **Adapters → EMS-Light → Instanz hinzufügen** (Standard: `ems.0`).

Watch-Modus:

```bash
npm run watch
```

---

## Versionsänderung

Version identisch pflegen in:

- `package.json`
- `io-package.json` (`common.version`)
- News-Eintrag in `io-package.json` (`common.news.<version>`)
- `CHANGELOG.md` (nur veröffentlichte Änderungen)

Keine Patch-Version allein wegen reiner Dokumentationsänderungen erhöhen.

`package-lock.json` hat eine eigene Root-Version und wird nicht zwingend synchron gehalten.

---

## Release-Ablauf

1. Code fertigstellen, `npm run check && npm test && npm run build`
2. Version in `package.json` und `io-package.json` erhöhen
3. News-Eintrag (en/de) in `io-package.json` ergänzen
4. `CHANGELOG.md` aktualisieren
5. Commit und Tag (`v0.x.y`)
6. Push nach `origin/main`
7. Installation: `iobroker url install github:weindler/iobroker.ems#v0.x.y`

---

## Git-Regeln

- Commits auf `main` (oder Feature-Branch → PR)
- Klare Commit-Messages (`fix:`, `feat:`, `chore:`)
- Vor größeren Bereinigungen: annotierten Tag anlegen (`pre-*`)
- Keine Secrets einchecken (`.env`, Credentials)
- Keine produktiven Snapshots oder Laufzeitdaten einchecken
- Nicht automatisch pushen, sofern nicht ausdrücklich gewünscht

---

## Dokumentationsregeln

**Erlaubte dauerhafte Dokumente:**

```text
README.md
CHANGELOG.md
LICENSE
docs/EMS_LIGHT_MASTERPLAN.md
docs/ARCHITECTURE.md
docs/DEVELOPMENT.md
```

**Nicht anlegen:**

```text
PHASE_*.md
*_BRIEFING_CHATGPT.md
*_CURSOR_PROMPT.md
*_IMPLEMENTATION_REPORT.md
*_FINAL_REPORT.md
*_ZWISCHENSTAND.md
*_ROADMAP_OLD.md
docs/archive/
```

- Architekturänderungen nur in den drei zentralen `docs/`-Dateien dokumentieren
- Temporäre Arbeitsberichte gehören in Chat oder Commit-Messages, nicht ins Repository
- Keine manuellen Änderungen an generierten `build/`-Dateien — immer über `npm run build` erzeugen

---

## Maven für ioBroker-Adapter-Konfiguration

Der Adapter liest Instanz-Konfiguration aus `admin/jsonConfig.json`. EVCC-Mappings, Heizstab-Parameter und Intent-Defaults werden dort definiert und in `native`-Config-Keys gemappt.

Fremd-States (EVCC, Sensoren) werden über `getForeignStateAsync` / `subscribeForeignStatesAsync` gelesen — nie hardcodieren.

---

## Sicherheitsdefaults

- `global.execution_mode` = `dryrun`
- `addons.<id>.mode` = `dryrun`
- Live-Writes nur wenn beide `live` sind und Safety/Fault erlauben
- Wallbox ist read-only (keine EVCC-Writes)
