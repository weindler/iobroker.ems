# EMS-Light Planner Lastenheft (DE)

Dieses Lastenheft definiert das Zielbild für den zentralen EMS-Planner.
Es ist die fachliche Referenz für den Umbau von Add-on-Einzelregeln hin zu einem gemeinsamen Plan.

## 1) Ziel

Ein **zentraler Planner** plant alle flexiblen Verbraucher gemeinsam:

- Batterie
- Heizstab
- Klimaanlagen
- Wallbox

Der Plan beantwortet pro Tag und laufend im Replan:

- was wann laufen soll,
- aus welcher Quelle (PV, Batterie, Netz),
- mit welchem Ziel (Kosten, Komfort, Versorgung),
- und warum.

## 2) Rollenmodell

- **Add-ons** liefern Fakten, keine Strategie:
  - Verfügbarkeit, Grenzen, Leistungsdaten, Bedarf, Sensorik, Hard-Limits.
- **Planner** entscheidet Strategie:
  - Priorität, Zeitfenster, Energiequelle, Mengen, Zielkonflikte.
- **Runtime** setzt sicher aus:
  - Safety, Min-Runtime, Hysterese, Lockout, Fault, Dryrun/Live-Gates.
- **KI** ist optionaler Optimierer:
  - verbessert bestehenden Plan innerhalb Grenzen, ersetzt ihn nicht.

## 3) Verbindliche Inputs

- PV-Prognose (Tag + Horizon)
- Preisprognose (gesamter Tag)
- Hauslastprognose
- Live-Telemetrie (PV, Hauslast, Batterie, Temperaturen, Gerätezustände)
- Add-on-Fakten:
  - Heizstab: Min/Max-Temperatur, Leistung, verfügbare Stufen, Sensorqualität
  - Batterie: SOC, Kapazität, Reserve, Wirkungsgrade, Lade-/Entladeleistung
  - Klima: Komfortgrenzen, Leistungsbedarf, Betriebsmodus
  - Wallbox: Verbindung, Energieziel, Deadline, Ladegrenzen

## 4) Verbindliche Outputs

- Tagesplan + Replan-Slots pro Add-on
- Geplante Energiequelle je Slot (PV/Batterie/Netz)
- Erwartete Energiebilanz:
  - PV-Nutzung
  - Netzbezug/Einspeisung
  - SOC-Verlauf
- Erklärtexte / Reason-Codes je Entscheidung

## 5) Harte Produktregeln

1. **Ein Plan** für alle Verbraucher; keine konkurrierenden Add-on-Strategien.
2. **Heizstab nie aus Netzbezug**.
3. **Heizstab darf Batterie nutzen**, wenn global wirtschaftlich sinnvoll.
4. **Boiler-Minimum ist Pflichtbedarf** und darf nicht durch opportunistische Ladung verdrängt werden.
5. Batterie wird auf Tages-/Nachtbedarf geplant, nicht auf „dauerhaft 100 %“.
6. Netzladung nur, wenn Bilanz/Preis/Wirkungsgrad sie rechtfertigen.
7. Global Modes beeinflussen Gewichtung, aber verletzen keine Hard-Regeln.

## 6) Optimierungsziel (deterministisch)

Primär:

- Versorgungssicherheit + Hard-Constraints einhalten

Sekundär:

- Kosten minimieren (unter Berücksichtigung von Preisen und Wirkungsgrad)
- Eigenverbrauch/PV-Nutzung erhöhen
- unnötige Einspeisung vermeiden, wenn thermische/speichernde Nutzung sinnvoll ist

## 7) Batterie-Planungslogik (fachlich)

Der Planner berechnet täglich:

1. Bedarf bis Sonnenuntergang
2. erwartete PV-Energie bis Sonnenuntergang
3. erwarteten SOC bei Sonnenuntergang
4. Nachtbedarf bis erster Sonnenstrahl
5. resultierendes Defizit/Überschuss
6. wirtschaftliche Ladefenster (Preis + Wirkungsgrad)

Ergebnis:

- gezielte Netzladung nur in sinnvollen Fenstern und nur in nötiger Menge,
- kein blindes Dauer-Vollladen ohne Nutzen.

## 8) Klima-Planungslogik (fachlich)

- Klima nimmt am gemeinsamen Plan teil, wenn Add-on aktiviert.
- Winterbetrieb kann durch Betreiber deaktiviert sein; dann keine Planung.
- Sommerbetrieb (Kühlen/Entfeuchten) gemäß Komfort-/Betriebsbedarf im Gesamtplan.

## 9) Wallbox-Planungslogik (fachlich)

- Wallbox bleibt Teil des gemeinsamen Plans (Deadline, Energieziel, Verfügbarkeit).
- Bei fehlender Realwelt-Last (z. B. Fahrzeug voll/nicht angeschlossen) bleibt Logik aktiv, aber Testszenarien sind zu kennzeichnen.

## 10) Transparenzpflicht

Für jede zentrale Entscheidung muss sichtbar sein:

- welche Datenbasis verwendet wurde,
- welche Restriktion gegriffen hat,
- warum eine Alternative verworfen wurde.

## 11) Qualitäts- und Stabilitätsregeln

- Keine neue Planungsregel ohne Regressionstest für bestehende Kernfälle.
- Kernfälle müssen dauerhaft grün bleiben:
  - Boiler unter Min wird priorisiert.
  - Heizstab nutzt PV/Batterie gemäß Regeln, nie Netz.
  - Batterieplanung folgt Tages-/Nachtbilanz statt starrer Einzelheuristik.

