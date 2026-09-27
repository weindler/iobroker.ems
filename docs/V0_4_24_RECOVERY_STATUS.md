# v0.4.24 – Implementierungs- und Prüfstand, 27.09.2026

Ausgangspunkt: GitHub main `5f8d5f91ab08628192fa21bfca7fb9a33f61ee32`.
Wiederaufbau auf `implementation/v0.4.24-recovery`. Änderungen siehe Changelog 0.4.24.

## Implementiert

| Bereich | Verhalten |
| --- | --- |
| Statistikarchiv | Prüfsummengesicherte Monatsdateien, atomare Indexaktivierung, aktuelle und vorherige Generation, bedarfsweises Laden; keine automatische Löschung historischer Tage |
| Migration | Original und v1-Migrationssicherung erhalten; Aktivierung nach Prüfung der geschriebenen Monatsinhalte |
| Recovery | Geprüfte vorherige Generation mit passenden Zählerbaselines; kein stiller Neustart mit leerer Historie bei Beschädigung |
| Backup/Restore | Aktives Archiv exportieren; Restore in getrenntem Verzeichnis, bestehende Transaktion und Dryrun-Sperre nutzen |
| Datenobjektbaum | 32 zusätzliche feste Spiegelwerte; keine Tagesobjekte und keine InfluxDB |
| Tageswechsel | Kumulative Zählerbaselines erhalten; nicht exakt beobachtete Tagesgrenze vorläufig kennzeichnen |
| Batterie-Tiefststand | Frische SOC-Messungen mit Zeitpunkt, erster Zeitpunkt bei gleichem Tiefststand erhalten |
| Smart Meter | Gespeicherte erste/letzte Ablesung, Vorperiodenvergleich in kWh/Prozent; fehlende Werte offen |
| Batterie | Plan und gemessene Ladung getrennt, PV-End-Prognose aus bestehendem Plan, Nachtbedarf und Eigenverbrauch verständlicher |
| Wallbox | Externe Steuerung ohne konkurrierende EMS-Planbehauptung; Bedarf aus SOC/Ziel/Kapazität, Ladeverluste nur mit bekanntem Wirkungsgrad; veraltete Daten markieren |
| Heizstab/Klima | Aus/Winter vor Bedarfsbeschreibungen, kompakte Messwerte, Lernen pausiert; saisonalen Fremd-Datenpunkt korrekt lesen |
| Rollierende Planung | Anteilig verbleibende Slotenergie, Teilzeitraumkennzeichnung, Ganztages-PV separat sofern vollständig, Viertelstundenpreise der nächsten Stunde |
| Oberfläche | Kompaktere zweispaltige Statistik, Kennzahl in Titelzeile, gespeicherte Meterwerte, aufklappbare Eingaben; historische Lademengen und Monatsübersicht erhalten |
| Kosten | Negative Preise/Kosten und abgerechnete Rewards nicht auf null begrenzen; geschätzte Rewards nicht vorzeitig verrechnen |

## Prüfungen

- TypeScript-Prüfung und Build.
- Vollständige automatisierte Suite: 3.127 Tests erfolgreich.
- Winter/Aus, Plan gegenüber frischer/veralteter Ladeleistung, externe Wallboxsteuerung, angefangene Viertelstunden und Teilzeiträume.
- Statistik-Tick über Berliner Mitternacht und Neustart mit erhaltenen Zählerbaselines.
- Archivmigration, Änderungen, explizite Resets, Export, Restore und vollständige Verzeichnissicherung.
- Beschädigte/fehlende Monatsdaten, beschädigter Index und unbekannte Versionen.
- Bereitgestellte v1-Datei: alle 35 Tage inhaltlich identisch nach Migration und erneutem Öffnen; Laufzeitbaselines und Monatsgutschriften erhalten, Original unverändert. Reproduzierbar mit `node tools/verify-statistics-migration.mjs DATEI` nach dem Build.
- Tatsächliche Anzeigefunktionen in DOM-Testumgebung ausgeführt, einschließlich fehlender Werte, Winter und externer Steuerung.
- `npm pack --dry-run`: Version 0.4.24 und erforderliche Build-/Admin-Dateien vorhanden.

## Aussagegrenzen

Eine echte Adapterinstallation, ein realer Backitup-Wiederherstellungslauf und eine visuelle Browserabnahme auf der Anlage wurden hier nicht durchgeführt. DOM-Tests ersetzen keine visuelle Prüfung.

Laufende Zeiträume werden mit abgeschlossenen Tagen des Vorzeitraums verglichen und ausdrücklich als **nicht uhrzeitgleich** bezeichnet. Rückwirkend fehlende Ablesungen, Einzel-Ladesitzungen oder Lernwerte werden nicht erfunden. Der gemessene Tages-SOC-Tiefststand beginnt mit verfügbaren frischen Messungen nach Installation.

Für vollständige Dateisicherungen gehört das gesamte Instanz-Unterverzeichnis `statistics` zum Backup. Der integrierte JSON-Export behält seine Größenbegrenzung und bricht bei Überschreitung mit einem Fehler ab, statt Historie abzuschneiden.
