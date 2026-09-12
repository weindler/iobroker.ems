# EMS-Light – Umsetzung des Wochenend-Arbeitsplans

**Arbeitsstand:** 12.09.2026

**Quellbasis:** v0.2.26, Commit `dd4b5d73cde310d6c247a5c986b7e3aa75fbcd21`

**Zielstand:** v0.2.27

**Status:** vollständig implementiert und getestet; für Installation und kontrollierte Live-Erprobung freigegeben

## Ergebnis

Die Quellbasis wurde gegen den hochgeladenen ZIP-Stand verifiziert. Auf dieser Basis wurden
die unmittelbar im Repository umsetzbaren Punkte des Wochenendplans zusammenhängend
implementiert:

- nachvollziehbare Nachtreserve-Samples einschließlich Median und verwendetem Schätzer,
- begrenzte Day-Telemetry-Hydration und konkrete Retention für Detail- und Langzeitdaten,
- über Mitternacht fortgeführte Batterie-Gegenwelt im Shadow-Modell,
- maschinenlesbarer rollender 72-Stunden-Ausblick für VIS und spätere Apps,
- energetische Tages-, Monats- und Zeitraumstatistik ohne erfundene Nullwerte,
- strikte Trennung von KI-Beratung und produktiver Planner-Autorität,
- eng begrenzte, explizit freizugebende Heizstab-Batteriebrücke,
- herstellerübergreifender Katalog der tatsächlich implementierten Geräteprofile,
- eine in sieben Bereiche gegliederte VIS mit eigener Sicht je Geräteklasse,
- ein lokaler read-only App-Core-Snapshot ohne zweiten Steuerpfad,
- eine explizite Safety-Matrix für Batterie-Netzladen, EVCC-`now`, Budget und Ownership,
- eine getestete Tibber-Übergabe, die nach dem Anstecken und der konfigurierten Wartezeit
  ausschließlich EVCC Schnell/`now` freigibt,
- reproduzierbarer Testlauf in der Produkt-Zeitzone.

Die vorhandenen Safety-, Hygiene-, Forced-, Readiness-, Ownership-, Dryrun-, EVCC-,
Shared-Power- und Grid-Balance-Verträge bleiben bestehen. Eine allgemeine aktive
Batterieentladung wurde bewusst nicht erfunden: Sie bleibt außerhalb des bereits vorhandenen
Netzausgleich-Pfads für LIVE nicht vollständig unterstützt.

## 1. Verifizierte Quellbasis

Der Inhalt des ZIP-Uploads und das GitHub-Repository `weindler/iobroker.ems` zeigen denselben
Commit und denselben Tag:

| Prüfung | Ergebnis |
|---|---|
| Git-Commit | `dd4b5d73cde310d6c247a5c986b7e3aa75fbcd21` |
| Tag | `v0.2.26` |
| Branch | `main` |
| Inhaltsvergleich ZIP ↔ Repository | keine Abweichung |

Damit gilt die Bestandsanalyse des ZIP-Ordners auch für die geklonte Arbeitskopie.

## 2. Nachtreserve: Ursache sichtbar statt pauschal überschrieben

Die SOC-basierte Reserve bleibt die führende Größe. Neu ist eine begrenzte Einzelnachweis-
Diagnose je ausgewählter Nacht mit:

- Start-SOC und tiefstem SOC im Beobachtungsfenster,
- Brücken- und Beobachtungszeitraum,
- Bruttoentladung in Prozent und kWh,
- belastbar zugerechnetem Grid-Balance-Abzug,
- Nettoentladung und Recency-Gewicht,
- Annahme/Ausschluss und eindeutigem Ausschlussgrund.

Erkannte Ausschlussgründe sind fehlender SOC, keine Entladung, unplausible Entladung,
Zwischenladung, unzureichende Grid-Balance-Coverage und hoher Ausreißer. Ein konkreter
Vertragstest belegt `100 % → 65 %` bei `10 kWh` mit exakt `3,5 kWh`.

Zusätzlich werden veröffentlicht:

- `learning.battery_runtime.avg_night_discharge_kwh`: verwendeter, zeitlich gewichteter Mittelwert,
- `learning.battery_runtime.median_night_discharge_kwh`: Median derselben akzeptierten Nächte,
- `learning.battery_runtime.night_estimator`: `recency_weighted_average`,
- `learning.battery_runtime.night_samples_json`: begrenzte Einzelbefunde.

So lässt sich künftig konkret erklären, warum eine einzelne Nacht 3,5 kWh zeigt, während der
gelernte Wert über mehrere, unterschiedlich gewichtete Nächte beispielsweise näher bei 2 kWh
liegt. Der Median ist Diagnose; Planner und Reserve nutzen weiterhin genau einen führenden
Schätzer.

## 3. RAM, JSON, SQLite und InfluxDB

### Entscheidung

Für v0.2.x bleibt die lokale Tagesablage bei partitionierten JSON-Dateien. Entscheidend ist
nicht die Dateiendung, sondern die Begrenzung der im Prozess gehaltenen Daten:

- auf SSD bleiben höchstens 90 Day-Telemetry-Tage,
- im Produktionscache liegen nur der aktive Tag und der Vortag,
- ältere Tage werden von Evaluator und Learning bei Bedarf einzeln gelesen,
- kompakte Tages-/Accounting-Werte haben eigene, längere Obergrenzen.

Der vorherige Startpfad rehydrierte alle 90 Tagesdateien einschließlich der rekonstruierten
Forecast-Revisionsketten. Das war der konkrete RAM-Hotspot. Ein Regressionstest legt 90
Tagesdateien an und weist nach, dass im Runtime-Cache nur zwei Tage verbleiben, ohne die 90
Dateien auf Platte zu verlieren.

### Vergleich

| Variante | Vorteil | Nachteil im aktuellen Adapter | Entscheidung |
|---|---|---|---|
| Partitioniertes JSON | vorhanden, atomare Tageswrites, leicht sicherbar und migrierbar | Abfragen über viele Tage benötigen gezieltes Einlesen | jetzt beibehalten und begrenzen |
| SQLite | Indizes, Abfragen und Aggregationen in einer Datei | eingebautes `node:sqlite` gibt es erst ab Node 22.5; EMS-Light unterstützt Node 20, daher wäre eine zusätzliche/native Dependency oder ein Major-Runtime-Schritt nötig | später als versionierte Migration neu bewerten |
| InfluxDB | sehr gute externe Zeitreihenanalyse | zusätzlicher Dienst, Betrieb und Datenmodell; darf kein Produkt-Zwang sein | nur optionaler Export, nicht Primärspeicher |

Referenz zur Runtime-Entscheidung: [Node.js-Dokumentation zu `node:sqlite`](https://nodejs.org/api/sqlite.html).

### Konkrete Retention

| Datenklasse | Retention | Zweck |
|---|---:|---|
| Day Telemetry auf SSD | 90 Tage | detaillierte 15-Minuten-Tagesdaten |
| Day Telemetry im RAM | 2 Tage | aktueller Tag + Vortag |
| Daily Evaluator / Shadow | 90 Tage | detaillierte Bewertung/Gegenwelt |
| Wettertage / PV-Bias-Tage | 120 Tage | Learning-Detail |
| Power Rollup / Consumer Stats / Day Evaluation | 120 Tage | verdichtete operative Historie |
| Nacht-Einzelbefunde | 120 Samples | Reserve-Diagnose |
| Energy Daily Rollup | 730 Tage | längerfristige Energietage |
| Statistik- und Economics-Ledger | 3.660 Tage | 7-Tage-, Monats-, Jahres- und Mehrjahreswerte |

Noch nicht abgerechnete öffentliche Ladevorgänge werden beim Statistik-Pruning nicht gelöscht.
Damit ist die Datenintegrität wichtiger als die normale Frist, ohne ein unbegrenztes allgemeines
Wachstum zuzulassen.

## 4. Wirtschaftlichkeit und Tagesgrenzen

Die bestehende Trennung bleibt verbindlich:

1. Energieflüsse und Quoten,
2. tatsächliche Kosten/Erlöse/Gutschriften,
3. nur belastbar bewertbarer EMS-Mehrwert.

Das Shadow-Modell wurde auf `shadow_v4` angehoben. Die `reference_no_ems`-Gegenwelt übernimmt
bei aufeinanderfolgenden Tagen ihren eigenen End-SOC als Start-SOC des Folgetags. Nur wenn
diese Kette fehlt, wird transparent auf den realen Vortags- beziehungsweise aktuellen SOC
zurückgefallen. Dadurch verschwindet gespeicherte Energie nicht künstlich an Mitternacht.

Bereits endgültig gebuchte Economics-Tage werden bei einer geänderten Shadow-Modellversion
erneut aus dem neuen Modell gebildet. Die Modellversion steht in jeder Tagesbuchung.

Bewusste Grenze: Für thermische Speicherung gibt es noch keine belastbare Gegenwelt für
Pelletverbrauch, vermiedene Kesselstarts oder Verschleiß. Dafür werden keine scheinpräzisen
Eurobeträge erzeugt. Die vorhandenen Energie- und Betriebsinformationen bleiben als
nicht monetarisierbarer Zusatznutzen sichtbar.

Zusätzlich veröffentlichen `statistics.energy.today_json`, `statistics.energy.month_json`
und `statistics.energy.period_json` die energetische Bilanz. Enthalten sind PV-Erzeugung,
Hausverbrauch, Netzbezug und -einspeisung, Eigenverbrauch, Autarkie, Batterie-Ladung/
Entladung und – bei vollständiger zeitgleicher Messung – die PV-Anteile von Heizstab,
Wallbox und Klima. Prozentwerte werden über mehrere Tage energiemengengewichtet statt als
Mittelwert von Prozenten gebildet. Fehlende Messketten bleiben `null`.

Für EVCC Schnell/`now` wird die reale Ladeenergie zusätzlich separat erfasst. Zeitgleicher
Netzbezug und Sonnen-Batterieentladung werden proportional zur gesamten Hausversorgung auf
die Fahrzeugladung verteilt; der geschlossene Rest wird als `PV/lokal` ausgewiesen. Fehlt
während einer Ladung der EVCC-Modus oder eine benötigte Quellenmessung, bleibt der jeweilige
Wert konsequent `null`, statt aus anderen Tagen oder Slots einen Teilwert zu erfinden.

## 5. Rollierender 72-Stunden-Ausblick

`operator.outlook_72h.json` liefert eine read-only Verdichtung des autoritativen Unified Plans
und seines Inputs. Das Schema enthält:

- Plan-ID, Generation, Zeitzone, Abdeckung und Vollständigkeit,
- Tagesblöcke im rollierenden 72-Stunden-Fenster,
- PV- und Hauslastenergie nur bei vollständiger Datenlage, sonst `null`,
- Preis-Minimum, -Maximum, Mittelwert und bekannte Slots,
- geplante Energie je Verbraucher, Geräteklasse und Quelle,
- projizierten Batterie-SOC-Bereich,
- Reason Codes und Confidence.

`operator.outlook_72h_de` enthält die kompakte deutsche Zusammenfassung. Die Betriebs-VIS
verwendet diese strukturierte Sicht für heute, morgen und übermorgen und fällt bei alten oder
fehlenden Daten auf ihre bisherige Horizontanzeige zurück.

Der Ausblick ist keine zweite Planungsinstanz: Er entscheidet nichts, verändert keine
Allokationen und schreibt nicht auf Geräte.

## 6. Planner-Autorität, KI und Heizstab-Batteriebrücke

### Tibber Grid Rewards über Fahrzeug/Wallbox

Die Admin-Haken „Tibber Grid Rewards über Fahrzeug eingerichtet“ beziehungsweise „… über
Wallbox eingerichtet“ sind die ausdrückliche Freigabe für die Übergabe. Nach
`disconnected → connected` wartet EMS die konfigurierte Zeit (Standard 180 Sekunden) und
betätigt dann genau einmal den EVCC-Modusbutton Schnell/`now`. Das aktuelle
Grid-Rewards-Aktivsignal muss zu diesem Zeitpunkt noch nicht aktiv sein; Tibber kann erst nach
dieser Freigabe die Fahrzeugladung übernehmen. Während die Konfiguration aktiv ist, schreibt
der normale EMS-Wallbox-Dispatch kein PV/min+PV zurück.

Der Sonderpfad darf ausschließlich `now` setzen. Er schreibt niemals direkt auf Wallbox,
go-e, Fahrzeug, Tibber oder Sonnen und bleibt an Fault, Restore, Governance, Add-on-Live,
EVCC-Buttonvertrag, Quellenfrische und Modus-Feedback gebunden. Abstecken bricht die Wartezeit
ab; fehlendes Feedback nutzt die vorhandene Retry-/Fail-safe-Maschine.

### KI

Der versteckte Rückkanal von akzeptiertem KI-`defer_tomorrow` in den produktiven Unified Plan
wurde entfernt. KI kann analysieren, erklären und im Compare eine Gegenvariante simulieren,
aber nicht über eine verdeckte Slot-Sperrliste die LIVE-Allokation verändern.

### Heizstab aus Batterie

Die bisher kategorisch gesperrte Soft-Nutzung wurde durch ein enges Gate ersetzt. Eine passive
Batteriebrücke ist nur möglich, wenn gleichzeitig:

- die Betreiber-Policy `mayUseBatteryForImmersion` ausdrücklich aktiv ist,
- passive Batterieenergie verfügbar ist,
- die Wärme vor der nächsten belastbaren PV-Recovery voraussichtlich leer wird,
- PV vor dieser Deadline den Bedarf nicht deckt,
- der Reserve-/Mindest-SOC-Boden eingehalten wird,
- die Energie günstig ersetzbar und gegenüber später knapper Netzenergie wirtschaftlich ist,
- keine Netzenergie für den Soft-Heizstab verwendet wird.

Der Planner erzeugt dabei weiterhin keine allgemeine aktive Batterieentladung. Die Quelle
`battery` beschreibt den zulässigen passiven Energiepfad; `battery_discharge` bleibt für LIVE
strukturell gesperrt.

## 7. Hersteller- und Gerätetemplates

`profiles.catalog_json` exportiert ein stabiles, maschinenlesbares Schema der tatsächlich
kompilierten Profile. Es ordnet Geräteklasse, Hersteller, Template-ID, Integration,
Capabilities, LIVE-Fähigkeit und Ausführungsautorität zu.

Enthalten sind nur wirklich implementierte Templates, derzeit unter anderem Sonnen/
Generic-Batterie, Samsung/Generic-Klima, EVCC-Wallbox und der Mapping-Heizstab. Beispielnamen
wie Victron, Fronius, BYD, Daikin oder KEBA werden erst aufgenommen, wenn ein belastbares
Profil existiert; der Katalog täuscht keine Unterstützung vor.

Die Zielhierarchie Geräteklasse → Hersteller → Template sowie der Setup-Ablauf
Geräteklasse → Hersteller → Template → Bindung werden ebenfalls maschinenlesbar
bereitgestellt. Jedes vorhandene Gerät besitzt einen ehrlichen generischen Fallback; bei der
Batterie ist dieser bewusst read-only.

## 8. VIS und lokale App-Grundlage

Die VIS ist in sieben Bereiche gegliedert:

1. Betrieb als Planner-Leitstelle mit rollierendem 72-h-Ausblick,
2. Statistik,
3. Batterie,
4. Heizstab / Wärme,
5. Klima,
6. Auto / Wallbox,
7. Grid Balance.

Jede Gerätesicht beantwortet dieselben vier Fragen: Was passiert gerade, was wurde gelernt,
was ist als Nächstes geplant und warum? Die Statistik trennt energetische Werte, reale
Geldströme und nur belastbar messbaren EMS-Mehrwert. Nicht monetarisierbare Wärme- oder
Verschleißvorteile werden als solche gekennzeichnet.

Die Auto-/Wallbox-Sicht zeigt zusätzlich Freigabe, Zustand und Fälligkeit der Tibber-Übergabe
sowie Schnell/`now` getrennt nach Sonnen-Batterie, Netzbezug und PV/lokal. Der öffentliche
DC-Schnellader bleibt davon als eigener Abrechnungsposten getrennt.

`app.core_contract_json` beschreibt die lokale read-only Schnittstelle.
`app.core_snapshot_json` fasst Systemstatus, Unified Plan/72-h-Ausblick, Profilkatalog,
Gerätezustände, Learning, Statistik, Safety-Invarianten und Datenqualität zusammen. Der
Snapshot darf keine Gerätewrites auslösen und nennt den `unified_daily_plan` ausdrücklich als
einzigen Steuerpfad. Fehlende Zustände bleiben `null` und werden zusätzlich als fehlend
aufgelistet. Die lokale Steuerung bleibt ohne Cloud voll funktionsfähig.

## 9. Erhaltene Sicherheitslogik

Die vorhandene Ausführungshierarchie bleibt Safety/Fault/Restore → externe EV-Hoheit →
Batterie-Hold → geplante Batterieaktion → Grid Balance. Die Abschlussmatrix belegt:

- aktive beziehungsweise geplante Batterie-Netzladung beendet Grid Balance mit eigenem
  `discharge=0`-Release, bevor die Ladeaktion übernimmt,
- verbundenes und tatsächlich ladendes EVCC-`now`/Schnellladen beendet Grid Balance ebenso,
- ein alter `now`-Status bei abgestecktem Fahrzeug erzeugt keinen falschen Konflikt,
- ein noch so großes Planner-Budget und positive Economics öffnen weder Hold noch Fault,
  Restore, Netzladen oder EV-Schnellladen,
- eine fehlende Batterie-Freigabe für einen Verbraucher bleibt `null` und wird fail-closed
  behandelt; nur ausdrückliches `true` öffnet diese Freigabe,
- Hygiene-Pflicht, Forced-Vertrag, Climate-Hard-Off/Manual-Override/Shared-Power sowie
  Wallbox-Readiness und Ownership bleiben durch bestehende Runtime- und Planner-Tests gedeckt.

## 10. Verifikation

| Prüfung | Ergebnis |
|---|---|
| TypeScript Build | bestanden |
| Admin-Config-Check | bestanden |
| Unit-/Vertragstests | **3.041 / 3.041 bestanden** |
| VIS-Synchronität und Script-Parsing | bestanden |
| State-Surface-Audit | bestanden, 0 obsolete statische States |
| `git diff --check` | bestanden |

Der Teststarter setzt für die Produktverträge standardmäßig `Europe/Berlin`, unabhängig von
der Host-Zeitzone. Mit `EMS_TEST_TZ` kann eine abweichende Testzone ausdrücklich gewählt werden.

## 11. Noch offen nach der Installation

Die folgenden Schritte benötigen eine reale ioBroker-/Geräteumgebung beziehungsweise eine
ausdrückliche Freigabe und wurden deshalb nicht vorgetäuscht:

1. Adapter zunächst global und je Add-on in `dryrun` installieren.
2. Über mindestens einen Tageswechsel RAM/RSS, Anzahl geladener Day-Telemetry-Tage und
   Dateiretention beobachten.
3. Nacht-Samples gegen reale SOC-Kurve, Zwischenladung und Grid-Balance-Episoden prüfen.
4. Den 72-Stunden-Ausblick gegen PV-, Preis-, Wärme- und Fahrzeugdaten plausibilisieren.
5. Shadow-v4 an mehreren Tagesgrenzen nachrechnen; nicht bewertbare Tage müssen `null` bleiben.
6. Erst danach gezielt LIVE freigeben und die bestehenden Safety-/Ownership-Gates beobachten.
7. Beim Tibber-Test `tibber_now_handoff_status`, `tibber_now_handoff_due_at` und das EVCC-
   `status.mode`-Feedback vom Anstecken bis zur bestätigten `now`-Übergabe beobachten.

Der Code ist für die Installation freigegeben. Die erste reale Schaltung bleibt bewusst eine
kontrollierte Anlagenprüfung: zunächst Dryrun/Mappings kontrollieren, anschließend Wallbox und
Globalmodus gezielt auf LIVE stellen.
