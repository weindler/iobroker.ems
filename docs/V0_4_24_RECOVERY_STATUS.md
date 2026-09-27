# v0.4.24 – Wiederaufbau, 27.09.2026

Basis: GitHub main `5f8d5f91ab08628192fa21bfca7fb9a33f61ee32`.
Entwicklungsbranch: `implementation/v0.4.24-recovery`. Noch kein Release.

## Aktuell nachgewiesen

- Statistik-v1: atomarer Dateiaustausch, letzte gültige Sicherung, kein stilles
  Zurücksetzen auf leere Daten bei Beschädigung oder unbekannter Version.
- Der reguläre Schreibvorgang löscht keine alten Tageswerte mehr.
- Separater Monatsarchiv-Baustein: Prüfsummen, unveränderte Migrationsquelle,
  Index als Commit-Punkt, bedarfsgeladenes Monatscache, explizite Tageslöschung.
- Reproduzierbare Prüfung mit `node tools/verify-statistics-migration.mjs DATEI`
  nach `npm run build`. Die private Eingabedatei gehört nicht ins Repository.
- Bereitgestellte Statistik: 35 Tage vollständig verglichen, Laufzeitdaten und
  Monatsgutschriften erhalten, nach erneutem Öffnen identisch. Original unverändert.
- Vollständige Tests nach Persistenzkorrektur: 3.113 erfolgreich.
- Anschließende gezielte Archiv-/Persistenztests: 6 erfolgreich.

## Noch offen – keine Fertigmeldung

- Monatsarchiv an Tick, Auswertungen, explizite Resets, Backup und Restore anbinden.
- Archivgenerationen begrenzen, ohne letzte gültige Generationen zu gefährden;
  aktuelle Implementierung behält sie sicherheitshalber vollständig.
- Tageswechsel, gemessener SOC-Tiefststand, zeitgleiche Vorperiodenvergleiche,
  Viertelstundenpreise, PV-Restprognose und Teilzeitraumkennzeichnung.
- Einheitliche Ist-/Plan-/Modus-/Fremdsteuerungsanzeigen für alle Add-ons.
- Kompaktere Statistik- und Add-on-Seiten, Umgang mit fehlenden Lernwerten.
- Gesamttests, visuelle Prüfung und reale ioBroker-/Backup-Wiederherstellung.
- Versionsnummer und Changelog erst zum fertigen Release aktualisieren.

Frühere, inzwischen verlorene Entwicklungsstände und deren Testergebnisse sind
kein Nachweis für diesen Wiederaufbau. Ausschließlich neu ausgeführte Prüfungen zählen.
