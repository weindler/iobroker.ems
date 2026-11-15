# Veröffentlichung im ioBroker-Forum / Repository — Prüfstand

Stand: 2026-11-15, Adapter v0.4.90. Grundlage: statische Prüfung des Repos gegen die offiziellen Anforderungen (Publish-Anleitung, Repository-Regeln, Repochecker). Der Repochecker selbst konnte nicht ausgeführt werden (Netzwerk) — bitte zusätzlich <https://adapter-check.iobroker.in/> mit der GitHub-URL laufen lassen.

## Ablauf bis zur Aufnahme

1. Blocker unten beheben, Adapter-Checker ohne Fehler.
2. Auf npm veröffentlichen (Release-Skript + GitHub-Workflow `test-and-release`).
3. Forum-Thread „Adapter-Vorstellung / Tester gesucht" (Vorlage unten) — Rückmeldungen einsammeln.
4. Pull Request „latest" an `ioBroker.repositories` (`npm run addToLatest -- --name ems --type energy`), Voraussetzung: Version wurde von Nutzern getestet.
5. Später „stable" (nur wenn bereits in latest, Forum-Feedback vorhanden).

## A. Blocker (ohne das wird der Check rot)

| # | Punkt | Stand |
|---|---|---|
| A1 | `native` in `io-package.json` ist leer, die Admin-Oberfläche hat aber ~880 Konfigurationsfelder. Alle bearbeitbaren Felder müssen mit Defaults in `native` stehen. | offen — per Generator aus `jsonConfig.json` + `src/config` ableiten |
| A2 | Icon fehlt (`common.icon`, `admin/ems.png`/`.svg`). README verweist bereits auf `admin/ems.png`. | offen — Icon erstellen |
| A3 | Fest eingebaute Geräte-IDs des eigenen Hauses (SmartThings-UUIDs) als Klima-Standardwerte in `src/tools/admin_config/climate_unit_defaults.ts` und `admin/jsonConfig.json`. | offen — durch leere Defaults ersetzen |
| A4 | Admin-Texte: 1129 von 1371 Text-Feldern sind Klartext statt Übersetzungsschlüssel, davon ~420 erkennbar deutsch. Basis muss Englisch sein (`admin/i18n/*`, mind. en + de). | offen — größter Posten |
| A5 | Keine Standard-Tests (`test/package.js`, `test/integration.js` mit `@iobroker/testing`) und kein `test-and-release`-Workflow. Aktuell nur `ems-check.yml` (eigene Unit-Tests). | offen |
| A6 | GitHub-Repo heißt `iobroker.ems`, gefordert ist `ioBroker.ems` (Umbenennen, GitHub leitet um). Topics setzen. | offen |
| A7 | Adaptername entscheiden **vor** dem ersten npm-Publish: `ems` ist generisch und liegt neben `ems-esp` (Bosch-EMS-Bus). Alternative z. B. `ems-light`. Späteres Umbenennen ist aufwendig. | Entscheidung nötig |
| A8 | npm-Paket veröffentlichen, danach ioBroker-Organisation als Owner eintragen (Checker nennt den Befehl). | offen |

## B. Wichtig (Warnungen / Reviewer fragen nach)

- `io-package.json`: `news` enthält 423 Einträge (211 KB). Auf die letzten ~20 kürzen, Rest steht in `CHANGELOG.md`.
- `info.connection` fehlt. Empfohlen: `true`, wenn die Haupt-Datenquellen frisch sind, sonst `false` (Statuspunkt in der Instanzliste).
- `onUnload`: `callback()` steht nicht in `try/finally` — wirft ein Stop-Schritt, wird nie beendet.
- Eigene `setTimeout`/`setInterval` (20 bzw. 6 Stellen) statt `this.setTimeout`/`this.setInterval`; kein Fehler, wird aber gern bemängelt.
- Speicher: 400–600 MB RSS (Heap 120–200 MB). Seit 0.4.90 deutlich weniger Allokationen; Reviewer fragen bei „Daemon, compact" danach. Bis zur Veröffentlichung messen und in der README nennen.
- Externe Dienste: Bright Sky, Energyforecast (Token verschlüsselt ✔), SMARD, **Verivox** (liest eine Webseite aus — Nutzungsbedingungen prüfen, ggf. nur optional und klar benannt), OpenAI (Schlüssel `ai_openai_api_key` wird aus der Konfiguration gelesen, hat aber weder Admin-Feld noch Eintrag in `encryptedNative`/`protectedNative`).
- Hilfetext im Admin widerspricht sich: „Batterieentladung im Live-Betrieb ist in der Beta nicht unterstützt" vs. Netzausgleich entlädt über `control.discharge`.
- Admin-Konfiguration ist 309 KB groß (334 Datenpunkt-Auswahlfelder) — Ladezeit des Admin-Dialogs auf schwacher Hardware prüfen.
- `.cursor/` (Agent-Regeln) und interne deutsche Entwurfsdokumente in `docs/` gehören nicht ins öffentliche Repo bzw. sollten aufgeräumt werden (`docs/README.md` verweist auf v0.2.26).
- `build/` ist committet (1187 Dateien). Für `iobroker url …` nötig, für npm nicht — nach dem ersten Release kann es aus Git.

## C. Bereits erfüllt

- `@iobroker/adapter-core` als einzige Laufzeit-Abhängigkeit; `js-controller >=5.0.19`, `admin >=6.0.0` (global), Node ≥ 20.
- Lizenz MIT (`LICENSE`, `license`, jetzt `licenseInformation`), `type`/`category`/`mode`/`compact`/`connectionType`/`dataSource`/`adminUI: json`, `encryptedNative` für den Energyforecast-Token.
- Jetzt ergänzt: `titleLang`, `keywords`, `licenseInformation`; `README.md` (Englisch, mit Changelog-Abschnitt) und `README.de.md`.
- Alle States haben gültige Rollen, keine Elternstates mit Kindern, kein `process.exit` im Adapterbetrieb, `setObject` wird nicht verwendet.
- Dryrun-Standard bei Neuinstallation/Restore, Failsafe, Backup/Restore — gute Verkaufsargumente.

## D. Empfohlene Test-/Release-Ausstattung

`devDependencies`: `@iobroker/testing`, `@iobroker/adapter-dev`, `@alcalzone/release-script` (+ `release-script-plugin-iobroker`, `-license`), ESLint mit `@iobroker/eslint-config`, Prettier; Dateien: `test/package.js`, `test/integration.js`, `.releaseconfig.json`, `.github/workflows/test-and-release.yml` (Node 20/22/24, Linux/Windows/macOS), `dependabot.yml`; GitHub-Secret `NPM_TOKEN`.

## E. Vorlage Forum-Beitrag (Kategorie Entwicklung / Adapter-Vorstellung)

**Titel:** Test: EMS-Light — Energiemanagement mit gemeinsamem 72-h-Plan (PV, Preise, Batterie, Wallbox, Heizstab, Klima)

Inhalt: Kurzbeschreibung (ein Plan für alle Verbraucher, lernende PV-Prognose, dynamische Preise), **Sicherheitsmodell (alles startet im Dryrun)**, Screenshots der Betriebsseite (PV- und Preisgrafik), unterstützte Hardware (Sonnen, evcc, Tibber, Bright Sky, Energyforecast, Klima via SmartThings/Mapping), Voraussetzungen, Installationsbefehl, bekannte Grenzen (Beta, Admin derzeit deutsch, Speicherbedarf), welche Rückmeldungen gewünscht sind (andere Batterien/Wechselrichter, Hardware-Mappings), Link auf GitHub und Issues.
