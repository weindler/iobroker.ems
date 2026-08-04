# EMS-Light — Klima Daily-Plan Runtime (v0.1.130)

## 1. Ziel der Klima-Runtime-Anbindung

Pro Innengerät (Unit 1–5) liest die Klima-Runtime im Automatikbetrieb die Daily-Plan-Allocation als **maximale Leistungsfreigabe**. Temperatur, Hysterese, Mindestlaufzeit, Mindestpause, SmartThings-Sequenzen, Rate Limits, Cleaning und Safety bleiben in der bestehenden FSM.

## 2. Governance-Gate

Vor jeder EMS-Steueraktion prüft die Runtime `isAddonGovernanceEnabledFromState(..., "climate")`.

Bei deaktivierter Governance:

- keine neuen Starts, Stops oder Cleaning-Starts
- keine SmartThings-Commands (Dryrun und Live)
- `decision_source = governance_disabled`
- laufende Units werden nicht blind abgeschaltet (kein Ownership-Modell)

## 3. Entscheidungsreihenfolge

```text
Unit deaktiviert / Mapping fehlt
→ Governance
→ Cleaning / Rate Limit
→ FSM (Temperatur, Zeitfenster, Hard-Off)
→ Daily Plan (Auto)
→ autonome Klimaentscheidung (Fallback)
→ sicherer Grundzustand
```

## 4. Daily Plan pro Unit

Contribution-IDs: `air_conditioning.unit_1` … `air_conditioning.unit_5`

Quelle: `planner.intent.allocation.air_conditioning.plan_json` (+ Full-Plan-Fallback)

Jede Unit wertet nur ihre eigene Contribution aus.

## 5. Allocation als Leistungsfreigabe

Kein direkter Einschaltbefehl. Start nur wenn:

- Allocation ≥ erwarteter Unit-Leistung (learned/config)
- FSM Kühlbedarf meldet (`demandStart`)
- Governance erlaubt
- Rate Limits erlauben

## 6. Temperaturbedarf bleibt Runtime-Aufgabe

Positive Allocation ohne Kühlbedarf → kein Start, `temperature_no_demand`.

## 7. Leistungsmodell

Priorität wie Planner: gelernte Leistung (≥3 Tage) → konfigurierte `estimated_power_w`.

Fehlendes Modell → kein Start trotz Plan (`missing_power_model`).

## 8. Auto, Force und Off

Klima hat kein separates Force/Off-Intent — Steuerung über Thermostat-FSM, Zeitfenster und Daily Plan.

## 9. Legacy-Klima-Fallback

Autonome FSM-Entscheidung bleibt Fallback bei fehlendem/ungültigem Plan — **nicht** bei gültigem Plan mit 0 W.

## 10. Mindestlaufzeit und Mindestpause

Unverändert über FSM und Engine-Rate-Limits (`AC_START_RETRY_MS`, `AC_STOP_RETRY_MS`).

## 11. Rate Limits und SmartThings

Bestehende Sequenzen und Toggle-Pulse unverändert. Governance blockiert neue Writes.

## 12. Cleaning-/Servicezustände

Laufende Cleaning-Sequenzen dürfen abgeschlossen werden. Neue Cleaning-Starts nur bei Governance aktiv.

## 13. Dryrun und Live

Gleiche Entscheidungslogik; Dryrun simuliert ohne Fremd-Writes.

## 14. Runtime-State-Pfade

Pro Unit unter `addons.air_conditioning.units.unit_N.*`:

- `decision_source`, `daily_plan_status`, `daily_plan_revision`
- `daily_plan_slot_start`, `daily_plan_slot_end`
- `allocated_power_w`, `expected_power_w`, `power_model_source`
- `allocation_status`, `allocation_reason_de`, `governance_allowed`

Add-on: `addons.air_conditioning.runtime.governance_allowed`, `daily_plan_active`, `daily_plan_revision`, `reason_de`

## 15. Cache und Planwechsel

Gemeinsamer Plan-Cache an Revision gebunden; Reset bei `stopAcRuntimeEngine()`.

## 16. Bekannte Einschränkungen

- Nur Units 1–5 (`AC_UNIT_COUNT = 5`)
- Kein Ownership/Restore wie Batterie
- Batterie und Wallbox lesen Daily Plan noch nicht
- Gemessene Leistung zur Startentscheidung noch nicht verfügbar

## 17. Abgrenzung

| Add-on | Daily-Plan-Runtime |
|---|---|
| Heizstab | ✅ v0.1.129 |
| Klima | ✅ v0.1.130 |
| Batterie | ❌ |
| Wallbox | ❌ read-only |
