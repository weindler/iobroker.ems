# Statistik: Quellen und Bilanzgrenzen

| Kennzahl | Bevorzugte Quelle | Zeitraum und Berechnung | Bei Datenlücken |
| --- | --- | --- | --- |
| Netzbezug und Einspeisung | Smart Meter 1.8.0/2.8.0, sonst Tages-Telemetrie | Differenzen pro lokalem Tag, aufsummiert für den gewählten Zeitraum | Erfassungsbeginn anzeigen; erster Tag kann unvollständig sein |
| PV-Erzeugung | Wechselrichter über Tages-Telemetrie | Summe der gemessenen Viertelstunden | Fehlende Messung bleibt unbekannt |
| Hausverbrauch | Hauslast über Tages-Telemetrie | Summe der gemessenen Viertelstunden; Batterieladung nicht zusätzlich aufaddieren | Autarkie ohne gleiche Haus-/Netz-Bilanzgrenze unterdrücken |
| Autarkie | Hausverbrauch und Netzbezug derselben Messintervalle | `(Hausverbrauch − Netzbezug) / Hausverbrauch` | Nur aus den auf derselben Karte gezeigten Mengen berechnen; sonst unbekannt |
| PV-Eigenverbrauch | PV-Erzeugung und Einspeisung | `(PV − Einspeisung) / PV` | Nur bei passender PV-/Export-Messung ausweisen |
| Geräteenergie und Auto zu Hause | Zeitgleiche Leistung, beim Auto Wallboxmessung der Tages-Telemetrie | Viertelstunden bzw. dieselben lokalen Tage wie die Energiekarte | Keine Hochrechnung einer fehlenden Ladung aus dem Fahrzeug-SOC |
| Herkunft der Autoladung | Zeitgleiche PV-, Netz-, Batterie- und Hausmessung | Nur den gemessenen Anteil sicher zuordnen | Unbekannte Quellen unbekannt lassen; Sitzungs-Preis ist keine Energiequelle |
| Kostenvergleich | Tibber-Kosten und Festtarif auf derselben Bezugsmenge | Je Zeitraum mit anteiligen Grundgebühren | Bei abweichendem Import-/Abrechnungsstand kein scheinbar genauer Tarifvorteil |
| Grid Rewards | Tibber-Schätzung oder endgültige Abrechnung | Gutschrift von Autokosten abziehen, Kennzeichnung der Quelle | Keine Gutschrift ohne Beleg erfinden |
| Externes Laden | Bestätigte Rechnung | Energie und Kosten des Rechnungsdatums | Offene Ladung bleibt unbeziffert |

Die Mobilitäts-Sitzungszählung in alten Statistikdateien kann von der gemessenen Wallboxenergie abweichen. Diese Altwerte werden nicht rückwirkend als Netzladung ausgegeben. Die Kosten-/Ersparniskarte bleibt bei unterschiedlicher Menge oder fehlender Quellenaufteilung offen; eine nachträgliche Migration erzeugt keine historischen Messwerte. Live-Netzleistung trägt in der Anzeige ausdrücklich „Jetzt“ und wird nicht als Periodenenergie interpretiert.
