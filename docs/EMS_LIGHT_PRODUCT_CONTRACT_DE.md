# EMS-Light Produktvertrag (DE)

Dieser Vertrag beschreibt das gewünschte Produktverhalten aus Betreiber-Sicht.
Er ergänzt die technische Architektur und ist für die weitere Umsetzung verbindlich.

## 1) Ein Plan statt Add-on-Inseln

- EMS-Light plant als **ein gemeinsamer Tagesplan** für Batterie, Heizstab, Klima und Wallbox.
- Es gibt keine konkurrierenden Einzel-Logiken, die den Gesamtplan nachträglich aushebeln.
- Entscheidungen entstehen aus der gemeinsamen Bilanz:
  - PV-Ertrag
  - Preise (ganzer Tag)
  - Hauslast
  - Gerätezustände, Grenzen und Anforderungen

## 2) Batterie als Energiespeicher, nicht als Selbstzweck

- Ziel ist nicht „möglichst lange 100 % SOC“, sondern wirtschaftlicher und robuster Betrieb.
- EMS bewertet täglich:
  - Energiebedarf bis Sonnenuntergang
  - Nachtreserve (letzter bis erster Sonnenstrahl)
  - erwartete PV-Energie
  - verfügbare günstige Ladefenster
  - Wirkungsgrade/Verluste
- Netzladung ist zulässig, wenn Tages-/Nachtbilanz sonst nicht aufgeht und das Preisfenster sinnvoll ist.

## 3) Heizstab-Vertrag

- Heizstab darf mit **PV und Batterie** betrieben werden.
- Heizstab darf **nie** durch EMS aus Netzbezug laufen.
- Boiler-Minimum ist bindend: Unterschreitung ist Pflichtbedarf und muss priorisiert werden.
- Puffer-/Hardwaregrenzen sind einzuhalten (z. B. Ziel 63 °C, Hardwareabschaltung 65 °C).
- Bei verfügbarem PV-Fenster soll Heizstab aktiv zur thermischen Speicherung beitragen.

## 4) Klimaanlagen-Vertrag

- Klimaanlagen werden **nur im Sommer** genutzt (Kühlen, Entfeuchten).
- Im Winter stellt der Betreiber die Klimaanlagen manuell auf „aus" (Governance-Schalter).
- EMS plant Klimaanlagen nur, wenn sie aktiviert sind — kein automatischer Sommer/Winter-Wechsel im Code.
- Im Sommer: Planung im gemeinsamen Tagesplan wie alle anderen Verbraucher (PV-first, dann Batterie).
- Kein Heizfall vorgesehen.

## 5) Wirtschaftlichkeit nach Global Mode

- Global Modes steuern den Trade-off (Kosten, Komfort, Reserve), aber innerhalb desselben Gesamtplans.
- „Eco“ priorisiert Kosten/Preissignale stärker, „Comfort“ priorisiert Versorgung/Verfügbarkeit stärker.
- Kein Mode darf die zentralen Sicherheits- und Produktregeln verletzen.

## 5) Deterministisch zuerst, KI optional danach

- Der deterministische Plan muss allein korrekt und stabil funktionieren.
- KI ist ein optionaler Optimierer innerhalb der gesetzten Grenzen, kein Ersatz der Grundlogik.

## 6) Transparenzpflicht (Diagnose)

- Für jede zentrale Entscheidung muss erkennbar sein:
  - warum sie getroffen wurde,
  - welche Restriktion wirkte,
  - welche Alternative verworfen wurde.
- Sichtbarkeit in Dashboard/States ist Teil der Produktqualität.

## 7) Stabilitätsziel

- Änderungen an Planungslogik nur mit Regressionstests gegen bekannte Betreiberfälle.
- Keine lokalen Fixes, die einen anderen Kernfall unbeabsichtigt verschlechtern.

## 8) Leitfrage für jede Implementierung

> Führt diese Änderung nachweisbar zu einem besseren gemeinsamen Tagesplan
> für PV × Preise × Hauslast × (Batterie + Heizstab + Klima + Wallbox)?

Wenn nein: nicht umsetzen.

