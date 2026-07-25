# EMS-Light – Verbindlicher Masterplan

**Status:** Gültig ab 28.06.2026  
**Aktualisierung:** 25.07.2026 — Operator-Pfad (Forecast/Daily Plan) produktiv; schwerer Planner-Shadow/Takeover-Codestack seit v0.1.181 vollständig entfernt (nicht mehr nur abgeschaltet). KI seit v0.1.185 als Gerüst vorhanden (`src/ai/`, standardmäßig aus, siehe Abschnitt 13) — echte Optimierungslogik weiterhin offen. Seit v0.1.186: Plan-Vergleich (`src/ai/compare/`) simuliert einen KI-gewichteten Plan B (nur Zeitpunkt-Verschiebung Heizstab/Klima, gleiche Energiemenge) zur reinen Beobachtung/Statistik — Plan A bleibt der einzige tatsächlich ausgeführte Plan. Seit v0.1.187: Fix im Daily-Plan-Merge (`src/operator/daily_plan/constraints.ts`) — Hauslast-Segment-Baselines (Mehrstunden) wurden bisher nicht auf 15-Min-Slots projiziert (exakter Key-Match traf nur 15-Min-Quellen wie Grid-Preise), wodurch `fixedHouseLoadPowerW`/`fixedBalancePowerW`/`availablePvSurplusPowerW` in jedem Slot `null` blieben und jede flexible Allocation blockiert war. Seit v0.1.188: optionale wetterbasierte PV-Kurve pro 15-Min-Slot (`src/operator/contributions/pv_shape.ts`, standardmäßig aus) — verteilt die gelernte Tages-PV-kWh anhand Sonnenstand + stündlicher Bewölkung/Solar-Schätzung, normiert auf die gelernte Tagesenergie, optionale kWp-Kappung. Damit ist `pvForecastPowerW` erstmals (optional) je Slot verfügbar; ohne Konfiguration bleibt das Verhalten wie zuvor (`null`). Seit v0.1.189: Fix im Standort-Parsing (`readSystemLocation` in `src/operator/contributions/read.ts`) — `system.config.common.latitude/longitude` als Komma-Dezimal-String (je nach Float-Teiler-Zeichen-Einstellung) wurde durch einen strikten `typeof === "number"`-Check fälschlich verworfen, wodurch die PV-Kurve trotz vollständig korrekter Konfiguration (aktiviert, BrightSky-Prefix, kWp-States) bei `daily_only` blieb. Lat/Lon werden nun wie alle übrigen Zahlenwerte im Adapter toleranter geparst. Seit v0.1.190: Heizstab/Klima liefern in ihren flexiblen Plan-Contributions jetzt `requiredEnergyKwh`/`maxPowerW`-Slots (`src/operator/contributions/flexible/flex_demand.ts`), wodurch die Daily-Plan-Allocation PV-Überschuss real an diese Verbraucher zuweisen kann. Seit v0.1.191: Fix im regelbasierten Thermal-Forecast (`src/planner/rules/thermal_forecast.ts`) — das Heizstab-Governance-Häkchen „KI-Optimierung erlaubt“ hat das Tagesziel bislang pauschal auf die Planungsobergrenze gesetzt („wartet auf KI-Anbindung“), obwohl die KI (Stand v0.1.191) ausschließlich den reinen Beobachtungs-Plan-Vergleich füttert und nie eine echte Zieltemperatur liefert — das führte zu unnötigem Nachheizen/Wärmeverlust. Der regelbasierte PV-Forecast läuft jetzt unabhängig von der KI-Governance-Freigabe; Seit v0.1.192: derselbe Fix auch in der Batterie-Winter-Netzplanung (`src/planner/rules/battery_winter.ts`) — das Governance-Häkchen „KI-Optimierung erlaubt“ ließ die regelbasierte Bilanz/Reserve-Berechnung komplett aussetzen; sie läuft jetzt unabhängig von der KI-Freigabe. Seit v0.1.193: der automatische KI-Trigger (`src/ai/index.ts`) reagiert nicht mehr auf jede Daily-Plan-Revision (die bei praktisch jedem Tick wechselt), sondern nur noch auf einen bewusst groben Plan-Fingerabdruck (`src/ai/trigger_digest.ts` — aktive/ausgeschlossene Add-ons, Tag, Global Mode, Status, grob gerasterte Flex-/PV-/Kosten-Summen); das senkt die Zahl automatischer KI-Aufrufe (und damit Tokens/Kosten) drastisch, ohne echte Planänderungen zu verpassen. Der manuelle „Jetzt optimieren“-Button ist unverändert. Index: `docs/README.md`.

---

## 1. Grundziel

EMS-Light ist ein eigenständiger ioBroker-Adapter.

Das frühere EMS-V2-System wird nicht weitergeführt.

EMS-Light muss auch ohne kostenpflichtige KI ein vollständiges, sicheres und funktionsfähiges Energiemanagementsystem sein.

Die spätere KI ist ausschließlich eine optionale Optimierungsschicht.

---

## 2. Zentrale Add-on-Governance

Für jedes steuerbare Add-on gelten künftig unter dem Reiter `GLOBAL` genau zwei zentrale Freigaben:

1. **Add-on aktiv**
2. **KI-Optimierung für dieses Add-on erlaubt**

Dies gilt übergreifend für:

- Wallbox
- Heizstab
- Batterie
- Klimaanlage
- spätere Wärmepumpe
- spätere verschiebbare Verbraucher
- alle zukünftigen Add-ons

Diese Schalter werden nicht auf jeder Add-on-Seite dupliziert.

> **Stand 28.06.2026:** Die zentralen GLOBAL-Schalter sind für Wallbox, Heizstab, Batterie und Klima implementiert (`src/addons/governance/`). Konfigurationsschlüssel: `wallbox_enabled`, `immersion_heater_enabled`, `battery_enabled`, `climate_enabled` sowie `*_ai_optimization_allowed` (Standard `false`). Runtime-Spiegel: `addons.<id>.governance.enabled` und `addons.<id>.governance.ai_optimization_allowed`. Der globale Ausführungsmodus (`global.execution_mode`, `addons.<id>.mode`) bleibt unabhängig davon.

---

## 3. Bedeutung „Add-on aktiv“

Bei `aktiv = false`:

- keine Steuerung durch EMS-Light
- keine Policy-Intents
- keine Planner-Intents
- keine KI-Intents
- keine Geräte-Writes
- keine aktive Teilnahme an der Lastverteilung

Messwerte dürfen weiterhin für die Energiebilanz verwendet werden.

Mappings und Konfigurationen bleiben erhalten.

Bei `aktiv = true`:

- das Add-on nimmt am EMS teil
- Safety, Policies und deterministische Planung gelten
- Steuerung hängt zusätzlich vom globalen Ausführungsmodus ab

---

## 4. Bedeutung „KI-Optimierung erlaubt“

Bei `KI erlaubt = false` arbeitet das Add-on vollständig ohne KI.

Verwendet werden:

- Messwerte
- Forecasts
- Strompreise
- Learning-Ergebnisse
- technische Grenzen
- Betreiber-Policies
- Safety
- deterministischer Planner
- Geräte-Runtime und FSM

Bei `KI erlaubt = true` darf die spätere KI den Fahrplan dieses Add-ons innerhalb der bestehenden Grenzen optimieren.

Die KI darf niemals:

- Safety umgehen
- Hardwaregrenzen überschreiten
- Policies verändern
- ein nicht freigegebenes Add-on steuern
- direkt Geräte-Datenpunkte beschreiben

---

## 5. Globaler Ausführungsmodus

Der Ausführungsmodus gilt zentral für alle Add-ons:

```text
observe
dryrun
live
```

### Observe

- lesen
- lernen
- bewerten
- planen
- keine Geräteausführung

### Dryrun

- Entscheidungen und Intents vollständig erzeugen
- Geräteabläufe simulieren
- Dryrun-States schreiben
- niemals reale Geräte-Datenpunkte schreiben

### Live

Echte Geräte-Writes nur, wenn:

- globaler Modus `live`
- Add-on aktiv
- Geräteprofil bereit
- Intent gültig
- Pflicht-Mappings vorhanden
- Telemetrie gültig
- kein Fault
- kein Lockout
- Safety erlaubt die Aktion

Die KI-Freigabe ist keine Voraussetzung für Live-Steuerung.

> **Stand 28.06.2026:** Der Adapter implementiert `dryrun` und `live` über `global.execution_mode` und `addons.<id>.mode`. Der Modus `observe` ist geplant, aber noch nicht als eigener Laufzeitmodus umgesetzt.

---

## 6. Verbindliche Entscheidungspipeline

```text
Messwerte und Forecasts
        ↓
Learning
        ↓
Safety und technische Grenzen
        ↓
Betreiber-Policies
        ↓
deterministischer Planner
        ↓
optionale KI-Optimierung
        ↓
neutraler Geräte-Intent
        ↓
herstellerspezifisches Geräteprofil
        ↓
Observe / Dryrun / Live
```

---

## 7. Priorität

Für alle Add-ons gilt:

```text
1. Safety und Fault-Lockout
2. manueller Betreiberbefehl
3. gültiger KI-Plan, sofern erlaubt
4. deterministischer Planner und Policy
5. sicherer Grundzustand
```

Eine niedrigere Ebene darf eine höhere niemals überschreiben.

---

## 8. Verhalten bei KI-Ausfall

Die KI darf keine technische Voraussetzung sein.

Bei:

- fehlender KI-Konfiguration
- KI-Timeout
- ungültiger KI-Antwort
- nicht erreichbarem Provider
- überschrittenem Kostenlimit
- abgelaufenem KI-Plan
- Policy-Verletzung
- nicht erlaubter KI-Nutzung

muss automatisch der deterministische Planner beziehungsweise die Policy übernehmen.

Beispiel:

```text
decision_source = policy_fallback
```

---

## 9. Zentraler General Operator

Es werden keine voneinander unabhängigen Add-on-KIs gebaut.

Später wird ein zentraler General Operator verwendet.

Dieser betrachtet gemeinsam:

- PV
- Hauslast
- Batterie
- Wallbox
- Heizstab
- Klima
- Strompreise
- Wetter
- Forecasts
- Laufzeitmodelle
- House-Fuse-Grenzen
- Betreiberziele
- Add-on-Freigaben

Die KI-Freigabe gilt trotzdem einzeln pro Add-on.

Ein Add-on ohne KI-Freigabe darf von der KI nicht umgeplant oder gesteuert werden.

Seine Messwerte und sein deterministischer Plan dürfen als Rahmenbedingung berücksichtigt werden.

> **Stand 28.06.2026:** General Operator und KI-Integration sind noch nicht implementiert.

---

## 10. Einheitliche Runtime-States

Jedes Add-on soll künftig mindestens folgende gemeinsamen Statusinformationen bereitstellen:

```text
enabled
ai_optimization_allowed
decision_source
decision_reason
last_decision_at
planner_status
intent_status
execution_status
profile_ready
telemetry_ready
fault
lockout
```

Mögliche Entscheidungsquellen:

```text
off
manual
policy
deterministic_planner
ai
policy_fallback
safety
```

> **Stand 28.06.2026:** Governance-States `enabled` und `ai_optimization_allowed` sind für Wallbox, Heizstab, Batterie und Klima unter `addons.<id>.governance.*` implementiert. Weitere einheitliche Runtime-States (`decision_source`, `planner_status`, …) folgen später.

---

## 11. Verantwortlichkeiten

### GLOBAL

- globaler Ausführungsmodus
- Globalmodus
- Add-on-Aktivierung
- KI-Freigabe je Add-on
- spätere globale KI-Konfiguration
- spätere Kostenlimits

### Add-on-Seiten

- Hersteller
- Modell
- technische Mappings
- Geräteprofile
- Hardwaregrenzen
- Rückmeldungen
- Diagnose
- FSM- und Failsafe-Parameter

### Policy-Seite

- Betreiberziele
- Prioritäten
- Mindestwerte
- Maximalwerte
- Zeitfenster
- Reservewerte
- Top-Off
- Preisstrategien
- Komfortvorgaben

### General Operator

- Tagesfahrplan
- Mehrtagesplanung
- Konfliktauflösung
- Gesamtpriorisierung
- optionale KI-Optimierung
- verständliche Erklärungen

---

## 12. Bestehende Add-ons

### Wallbox

Die bestehende EVCC-/Wallbox-Runtime, FSM, Safety und Intent-Ausführung bleiben erhalten.

Später werden nur zentrale Governance und Entscheidungsquelle vereinheitlicht.

**Aktuell (v0.1.177):** Wallbox schreibt live für den EVCC-Control-Pfad (`liveEligible=true`), abgesichert über Ownership/Fault-Lockout/Safe-Restore und Feedback-Verifikation (siehe `docs/EMS_LIGHT_WALLBOX_LIVE_FOUNDATION.md`). Der Legacy-Direktpfad (go-e) bleibt strukturell read-only. EVCC-Telemetrie wird weiterhin gelesen und in `addons.wallbox.evcc.*` gespiegelt.

### Heizstab

Die bestehende Heizstab-Runtime, Mindestlaufzeit, Mindestpause, Relaisüberwachung, Safety und Fault-Lockout bleiben erhalten.

Später werden nur zentrale Governance und Entscheidungsquelle vereinheitlicht.

**Aktuell (v0.1.63):** Heizstab-Runtime mit FSM, Safety und Live-Writes auf konfigurierte Stage-States. `auto` startet nicht selbstständig (kein Planner).

### Batterie

Die bisherige Batterie-Geräteanbindung wird nicht migriert.

Sie wird später neu aufgebaut mit:

- gemeinsamem Batterie-Grundmodell
- Trennung von Batterie-Hardware und Steuerprofil
- normalisierter Telemetrie
- Netto-Kapazität in kWh
- Hardwaregrenzen
- neutralem Batterie-Intent
- herstellerspezifischen Profilen
- Dryrun vor Live
- sicherem Grundzustand

Erste Profile:

```text
Generic Read-only
Sonnen EM
```

Später:

```text
Sonnen Performance
Fronius
Victron
weitere Profile
```

BYD ist grundsätzlich Batterie-Hardware.

Die Steuerung kann beispielsweise über Fronius oder Victron erfolgen.

> **Stand (v0.1.178):** Batterie-Grundmodell, Trennung von Hardware und Steuerprofil, normalisierte Telemetrie, Netto-Kapazität, Hardwaregrenzen, Capability-Modell, neutraler Batterie-Intent sowie die Profile `generic_readonly` und `sonnen_em` sind implementiert. Read-only, Dryrun und Live nutzen **eine gemeinsame FSM** mit zentraler, gegateter Write-Funktion (`FinalWriteGate` mit echtem Fault-/Lockout-/Ownership-Zustand statt Platzhaltern), Feedbackprüfung, Ownership-Schutz, Safe Restore (verifizierte FSM-Sequenz) und Fault/Lockout mit manuellem Reset; der optionale Sonnen-Netzausgleich läuft über dieselben Gates. Ein eigenständiger, FSM-unabhängiger Failsafe (`addons/battery/failsafe.ts`, EMS-Unreachable-Heartbeat analog Wallbox/Heizstab) erzwingt bei Tick-Ausfall Ladeleistung 0 W + Self-Consumption. Battery Runtime Learning bleibt erhalten. Weitere Profile (Sonnen Performance, Fronius, Victron) sowie eine KI-Optimierung sind weiterhin geplant. Der globale Ausführungsmodus kann pro Add-on live gesetzt werden (`bat_addon_mode=live`); Default bleibt `dryrun`.

---

## 13. KI-Kostenkontrolle

Die KI wird später nicht bei jedem Tick aufgerufen.

Neuplanung nur bei relevanten Ereignissen, beispielsweise:

- neuer Tagesplan
- wesentliche Forecast-Änderung
- wesentliche Preisänderung
- Fahrzeug angesteckt
- EV-Ziel geändert
- deutliche SOC-Änderung
- deutliche Temperaturänderung
- Plan nicht mehr erfüllbar
- Fault oder Lockout
- manuell angeforderte Neuplanung

Spätere Optionen:

```text
ai_enabled_global
ai_provider
ai_model
max_ai_calls_per_day
monthly_cost_limit
minimum_replan_interval
replan_only_on_material_change
```

> **Stand (v0.1.185):** Gerüst implementiert (`src/ai/`) — `ai_enabled`, `ai_model` (Whitelist), `ai_openai_api_key`
> (verschlüsselt), `ai_max_calls_per_day` (Soft-Warnung 80%) im Global-Tab. Aufruf nur bei neuer Daily-Plan-Revision
> oder manuell über „Jetzt optimieren“ — `monthly_cost_limit` und `minimum_replan_interval` sind noch nicht umgesetzt.
> Die KI liefert bislang nur beobachtende Text-Hinweise (`ai.last_reason_de`), schreibt nichts in Allocation/Intent
> zurück — echte Optimierungslogik (Abschnitt 4) ist ein separater, noch offener Schritt.
>
> **Stand (v0.1.186):** KI-Antwort um optionale `slot_preferences` erweitert (Gewichtung 0..3 je 15-Min-Slot,
> nur Heizstab/Klima, nur freigegebene Add-ons). Neues Modul `src/ai/compare/` simuliert daraus einen Plan B
> (Wasserfüllung: dieselbe von Plan A eingeplante Energiemenge, nur zeitlich anders verteilt, kapazitätsbegrenzt
> durch das in Plan A ohnehin verfügbare PV/Netz-Fenster) und vergleicht Kosten/PV/Netz gegen Plan A. Reine
> Beobachtung/Statistik (Tab „Plan-Vergleich“, `compare.*`-States, VIS-taugliche `chart_json`-Zeitreihen) —
> Plan A bleibt der einzige tatsächlich ausgeführte Plan, `compare.active_plan` schaltet nichts um. Eine echte
> Übernahme von Plan B in die Ausführung ist weiterhin ein separater, noch offener Schritt.
>
> **Stand (v0.1.193):** Der automatische Trigger reagierte bis dahin auf jede Daily-Plan-Revision — die wechselt
> praktisch bei jedem EMS-Tick (Horizont-Roll, Allocation-Fortschritt, Zehntelgrad-Zittern), nicht nur bei den
> oben gelisteten relevanten Ereignissen. Neues Modul `src/ai/trigger_digest.ts` baut einen bewusst groben
> Fingerabdruck (Kalendertag, Global Mode, Plan-Status, aktive/ausgeschlossene Add-on-IDs, grob gerasterte
> Summen für Flex-Bedarf/-Allocation/-Rest, PV-Tagesprognose und Netzkosten — Raster 0,3 kWh / 2 kWh / 50 ct).
> Der automatische Trigger (`maybeTriggerAiOptimizationOnDailyPlanChange`) läuft nur noch, wenn sich dieser
> Fingerabdruck seit dem letzten Aufruf tatsächlich ändert — deckt damit die oben gelisteten Ereignisse
> (neuer Tag, Add-on-Bedarf startet/endet, Zieltemperatur-Stufe, deutliche PV-/Kosten-Änderung) ab, ohne bei
> jedem Tick zu feuern. Der manuelle „Jetzt optimieren“-Button ist unverändert und ignoriert den Fingerabdruck.

---

## 14. Verbindliche Schlussregel

```text
EMS-Light muss jederzeit ohne KI sicher und vollständig arbeiten.

Policies, Safety, deterministischer Planner, Intents,
Geräteprofile und Failsafes bilden das eigentliche EMS.

Die KI ist optional und darf nur innerhalb dieses Systems optimieren.
```
