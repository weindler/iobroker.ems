# EMS-Light – Verbindlicher Masterplan

**Status:** Gültig ab 28.06.2026

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

> **Stand 28.06.2026:** Die zentralen GLOBAL-Schalter sind noch nicht implementiert. Add-on-Aktivierung und Ausführungsmodus laufen derzeit über die bestehende Konfiguration (`addons.<id>.enabled`, `global.execution_mode`, `addons.<id>.mode`).

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

> **Stand 28.06.2026:** Einheitliche Runtime-States sind noch nicht für alle Add-ons umgesetzt. Heizstab und Wallbox haben add-on-spezifische Status-States (siehe `docs/ARCHITECTURE.md`).

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

**Aktuell (v0.1.63):** Wallbox ist vollständig read-only. EVCC-Telemetrie wird gelesen und in `addons.wallbox.evcc.*` gespiegelt. Keine EVCC- oder Wallbox-Writes.

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

> **Stand 28.06.2026:** Batterie-Intent-Binding (read-only) ist implementiert. Geräteprofile und Live-Steuerung sind noch nicht umgesetzt.

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

---

## 14. Verbindliche Schlussregel

```text
EMS-Light muss jederzeit ohne KI sicher und vollständig arbeiten.

Policies, Safety, deterministischer Planner, Intents,
Geräteprofile und Failsafes bilden das eigentliche EMS.

Die KI ist optional und darf nur innerhalb dieses Systems optimieren.
```
