# EMS-Light — Verbindliche Produkt-Roadmap

**Stand:** 26.07.2026  
**Zweck:** Ein durchgängiges EMS (ein Planner, Learning → Planung, optional KI) — sequenziell, blockweise, messbar.  
**Regel:** `.cursor/rules/ems-light-roadmap.mdc` (1:1 abarbeiten, kein Block-Skip)

---

## Fortschritt

| Block | Name | Status | Ziel-Version |
|-------|------|--------|--------------|
| **1** | Learning → Planung | **erledigt** | v0.1.201 |
| **2** | Batterie-Lade-Logik (ex Battery-Winter) | **erledigt** | v0.1.202 |
| **3** | Realtime-Fallbacks abschalten | **erledigt** | v0.1.203 |
| **4** | Ein Planner (`runPlannerTick` weg) | **erledigt** | v0.1.204 |
| **5** | Horizont + State-Cleanup | **erledigt** | v0.1.205 |
| **6** | KI Write-back (nur bei messbarem Nutzen) | **erledigt** | v0.1.206 |

**Produkt-Reife heute:** ~60–65 % (Blöcke 1–6) | Roadmap-Blöcke 1–6 abgeschlossen — KI optional und fail-closed

---

## Leitplanken (alle Blöcke)

- **Ein Planner:** General Operator — kein paralleles Entscheidungssystem.
- **Ohne KI vollständig:** deterministisch innerhalb Policy/Safety.
- **KI optional:** nur Optimierung auf demselben Plan, nie direkt auf Geräte.
- **Kein Kalender-/Blockly-Denken:** Muster aus Learning-Daten, nicht starrer Wochentag.
- **Missing:** `null` / `missing` — nie erfundene `0`, nie `-1` als Sentinel.
- **Block-Abschluss:** Tests grün → Version + news de/en → Doku → erst dann nächster Block.
- **Commit/Push:** nur auf ausdrücklichen Nutzerauftrag.

---

## Block 1 — Learning → Planung (erledigt)

**Ziel:** Operator plant mit echten Lerndaten — nicht mit starren Platzhaltern.

### 1.1 Thermal Runtime → Heizstab-Contribution

- [x] `src/learning/thermal_runtime/` States lesen in `src/operator/contributions/flexible/immersion_heater.ts`
- [x] Bedarf: Aufheizrate, Zyklen, `estimated_empty_at`, gelernte Verbrauchsmuster
- [x] `estimateImmersionRequiredEnergyKwh` nutzt Learning wo verfügbar (Fallback: bestehende Physik-Schätzung)
- [x] Contribution-Details: Quelle + Qualität (`valid`/`degraded`/`missing`)
- [x] Unit-Tests: mit/ohne thermal_runtime-Daten

### 1.2 Battery Runtime → Batterie-Contribution

- [x] `src/learning/battery_runtime/` in `src/operator/contributions/flexible/battery.ts`
- [x] Nachtentladung, Ladecharakteristik für Ladebedarf-Fenster
- [x] Tests: fehlende Runtime → excluded/degraded, nie Fake-Werte

### 1.3 Price Learning → Grid Supply

- [x] `src/learning/price_learning/` als Fallback wenn Tibber fehlt/degraded
- [x] `src/operator/supply/grid.ts` + Contributions: günstige/teure Fenster
- [x] Tests: Tibber vs. Learning vs. missing

### 1.4 Forecast Plan Horizont Tag 0–7

- [x] PV (`learning.pv_horizon.*`) — alle 7 Tage in `forecast_plan.days[]` (operativ nutzbar); `horizonEnd` folgt jetzt dem weitesten Tag statt fix „morgen"
- [x] Hauslast — Segment-Forecast für Tag 0–7 wo Daten existieren (`learning.house_load.forecast_horizon_json`, gleiche Saison/Day-Type-Musterlogik wie „morgen", kein Fake-Wert)
- [x] Wetter — Kontext-Feld (`weatherMinTempC`/`weatherMaxTempC`) strukturell für alle Tage vorhanden; Tag 3–7 bleibt bewusst `null`, da kein Admin-Mapping für mehrtägige Wetter-Rohdaten existiert (kein erfundener Wert — Erweiterung erfordert neue Admin-Config außerhalb Block-1-Scope)
- [x] Tests: Tag 3–7 nicht `null` wenn Horizon-Daten da (PV, Hauslast); Wetter bewusst `null` dokumentiert

### Block-1 Abnahme (alle müssen erfüllt sein)

- [x] `npm test` grün
- [x] Kein neuer Import von Learning-States außerhalb Operator-Pfad für Planungsentscheidungen
- [x] `docs/EMS_LIGHT_OPERATOR_FOUNDATION.md` + `docs/EMS_LIGHT_FORECAST_PLAN.md` aktualisiert
- [x] `package.json` / `io-package.json` Version + news de/en
- [x] Fortschrittstabelle oben: Block 1 → erledigt, Block 2 → AKTUELL

**Spürbar für Nutzer:** Heizstab-/Batterie-Bedarf reflektiert gelerntes Verhalten; Forecast zeigt Woche.

---

## Block 2 — Batterie-Lade-Logik (ex Battery-Winter)

**Ziel:** Mehr-Tages-Netz-Ladeplanung im Operator — nicht in `runPlannerTick`.

**Namensklärung:** Bewusst **nicht** „Winterlogik“ oder „Grid Recovery“ genannt — der Auslöser
ist ein mehrtägiges PV-Defizit (PV-Horizont deckt den Bedarf nicht), das auch im Sommer bei
mehreren schlechten/bewölkten Tagen auftreten kann. Jahreszeit ist höchstens ein Nebensignal
(z. B. Schnee-Verdacht), nie der Namensgeber.

### 2.1 Contribution

- [x] Logik aus `src/planner/rules/battery_winter*.ts` → `src/operator/contributions/flexible/battery_charge_logic.ts` (Defizit/Reserve/Ziel-Mathematik 1:1 portiert, Namen generalisiert)
- [x] Input: pv_horizon 0–7 + Hauslast-Horizont 0–7 (Block 1.4), SOC, Policy, PV-Defizit-Signale (Schnee-Flag als ein Faktor von mehreren)
- [x] Output: Bedarf (`requiredEnergyKwh`) + Deadline (`bridgeUntilIso`) fließen in die bestehende `battery.charge`-Contribution ein — die Preisfenster-/Slot-Auswahl übernimmt die bereits vorhandene deadline-basierte Daily-Plan-Allocation (gleiches Muster wie Heizstab-Learning-Deadline aus Block 1), kein separates Preisfenster-Modul nötig

### 2.2 Allocation + Runtime

- [x] Daily Plan + Allocation weisen Grid-Lade-Fenster zu — automatisch über die bestehende deadline-/preissortierte Allocation, sobald die Contribution den PV-Defizit-Bedarf meldet
- [x] `src/addons/battery/` ist bereits so gebaut, dass `dailyPlanContext.useDailyPlan` vorrangig vor dem Legacy-Fallback greift (`resolveBatteryDailyPlanFromData`); durch 2.1 spiegelt der Daily Plan jetzt auch den PV-Defizit-Bedarf, wodurch der Legacy-Fallback (`planner.intent.battery.winter.*`) faktisch nur noch bei ungültigem/fehlendem Daily Plan greift
- [x] Parallel-Lauf: `battery.charge`-Contribution-Details zeigen `chargeLogicActive` (neu) neben `legacyDeficitChargeActive` (alter Planner) für Vergleich; VIS-Karte umbenannt, liest weiter die Legacy-Diagnosewerte

### 2.3 Rename / Deprecation

- [x] „Battery Winter“ → „Batterie-Lade-Logik“ in Admin-UI-Labels, VIS-Kartentitel und `reason_de` — keine Winter-Begriffe in Nutzertexten, Begründung nennt PV-Defizit statt Jahreszeit (native Admin-Config-Keys `bat_winter_plan_*` bleiben unverändert, sonst Verlust bestehender Nutzer-Einstellungen ohne Migration)
- [x] Alte States (`planner.intent.battery.winter.*`) in `ensure_states.ts`-Beschreibungen als „Legacy“ markiert; Legacy-Regeldateien (`battery_winter.ts`, `battery_winter_windows.ts`, `battery_winter_config.ts`) mit `@deprecated`-Hinweis auf den Operator-Nachfolger — Entfernung erst Block 5

### Block-2 Abnahme

- [x] `npm test` grün (inkl. neuer `battery_charge_logic.test.ts` + erweiterte `flexible.test.ts`-Fälle für Deadline/Ziel-Anhebung)
- [x] Batterie lädt in PV-Defizit-Szenario (Winter **oder** schlechtes Sommerwetter) aus dem Operator-Plan — Test „this can also trigger in summer …“ belegt Jahreszeit-Unabhängigkeit explizit
- [x] Doku (`EMS_LIGHT_OPERATOR_FOUNDATION.md`, `EMS_LIGHT_FLEXIBLE_CONTRIBUTIONS.md`) + Version/News
- [x] Block 2 → erledigt, Block 3 → AKTUELL

**Spürbar für Nutzer:** Netz-Laden folgt Wochen-PV-Prognose, nicht isoliertem Winter-Tick — greift bei jedem mehrtägigen PV-Defizit, unabhängig von der Jahreszeit.

---

## Block 3 — Realtime-Fallbacks abschalten

**Ziel:** Add-ons lesen nur noch Daily Plan + Allocation.

### 3.1 Heizstab

- [x] `thermal_fallback` in `src/addons/immersion_heater/runtime/engine.ts` liest nicht mehr vom alten Planner (`readPlannerThermalStage`/`readPlannerThermalTargetTemp` entfernt, Funktionen in `planner/inputs.ts` `@deprecated`, ohne Consumer)
- [x] Kein `readPlannerThermalStage` / `readPlannerThermalTargetTemp` aus altem Planner
- [x] Degraded-Pfad: lokaler Sicherheits-Default (`safeDefaultAutoTarget()` — Zieltemperatur = `planningMinTempC`/Pflicht-Untergrenze, Stufe = `forceDefaultStage`), nicht alter Planner

### 3.2 Klima

- [x] Geprüft: `src/addons/air_conditioning/runtime/` hat **nie** `planner.intent.cooling.*` gelesen — `climate_fallback` ist bereits die eigenständige Temperatur-/Feuchte-Hysterese-FSM (`fsm.ts`), kein Code-Änderungsbedarf
- [x] Analoger degraded-Pfad bereits vorhanden (unit-eigene FSM)

### 3.3 Briefing + Diagnose

- [x] `operator.briefing_de` aus Daily Plan + Allocation (`src/operator/daily_plan/briefing.ts`, `buildOperatorBriefingDe`) — `formatBriefing()`/Write aus `planner/run.ts` entfernt
- [x] `planner.surplus_w` / Diagnose aus Live-Cache + aktuellem Slot (`src/operator/daily_plan/live_surplus.ts`, neue States `operator.diagnostics.surplus_w`/`deficit_w`/`slot_start_iso`; VIS-Generator zeigt „Üss" jetzt daraus)

### Block-3 Abnahme

- [x] Tests für jeden `daily_plan_status`-Pfad (valid, missing/zero-allocation, degraded, expired) — `immersion_heater/runtime/engine.test.ts`, plus `briefing.test.ts` + `live_surplus.test.ts`
- [x] Kein Add-on liest `planner.intent.thermal.*`/`cooling.*` für Steuerung (verifiziert per Grep über `src/addons/`)
- [x] Doku (`EMS_LIGHT_OPERATOR_FOUNDATION.md`, `EMS_LIGHT_IMMERSION_DAILY_PLAN_RUNTIME.md`) + Version/News
- [x] Block 3 → erledigt, Block 4 → AKTUELL

**Spürbar für Nutzer:** Eine Entscheidungsquelle — kein Hin- und Her zwischen zwei Plänen.

---

## Block 4 — Ein Planner (`runPlannerTick` entfernen) — **erledigt (v0.1.204)**

**Ziel:** Nur noch Operator-Pipeline pro Tick.

### 4.1 Tick

- [x] `runPlannerTick(host)` aus `src/ems_light/tick.ts` entfernen
- [x] Kein Produktions-Import von `src/planner/run.ts`

### 4.2 Code-Umzug

- [x] `src/planner/rules/` → `src/operator/planning/` (Imports anpassen)
- [x] `src/planner/run.ts` auf reine Tests/Diagnose reduziert (`runPlanner` pure, kein Tick/State-Write); `inputs.ts` bleibt für Tests/Legacy-Reads
- [x] `ems_light/off_legacy_lazy.test.ts` erweitert (kein `/build/planner/run.js` auf dem Produktionspfad)

### 4.3 States

- [x] Planner-spezifische Steuer-States nicht mehr beschrieben (Ensure-Hülle Legacy bis Block 5)
- [x] VIS: keine Abhängigkeit von totem `planner.intent.thermal.*` (Heizstab/Klima/Batterie-Intents aus Addon-Runtime)

### Block-4 Abnahme

- [x] `npm test` grün
- [x] Produktion: ein Planungspfad in `tick.ts`
- [x] ARCHITECTURE.md + Masterplan §9 aktualisiert („ein Planner implementiert“)
- [x] Block 4 → erledigt, Block 5 → AKTUELL

**Spürbar für Nutzer:** Architektur = Masterplan. ~50–55 % Produkt-Reife.

---

## Block 5 — Horizont + State-Cleanup — **erledigt (v0.1.205)**

**Ziel:** Mehr-Tages-Allocation; alte State-Bäume weg.

### 5.1 Daily Plan Horizont

- [x] Rolling mindestens 48 h (`DAILY_PLAN_HORIZON_HOURS = 48` in `operator/daily_plan/slots.ts`; 7 Tage später skalierbar)
- [x] Alle flexiblen Add-ons nutzen denselben Horizont (kein addon-spezifischer Horizont)
- [x] PV-Shape-Slots + Hauslast-Segmente für Horizon-Tage mit echten kWh (nicht nur heute/morgen)

### 5.2 Cleanup

- [x] `planner.intent.thermal.*`, `cooling.*`, `battery.winter.*` + `planner.surplus_w`/`deficit_w` nicht mehr ensured; Surface-Cleanup purgt immer
- [x] Batterie-Runtime ohne Winter-/Legacy-Planner-Fallback
- [x] Admin-Hinweis Batterie-Lade-Logik bereinigt; VIS hatte die toten OIDs bereits in Block 4 verlassen

### Block-5 Abnahme

- [x] Tests + Doku + Version/News
- [x] Block 5 → erledigt, Block 6 → AKTUELL

---

## Block 6 — KI Write-back (nur bei messbarem Nutzen)

**Voraussetzung:** Blöcke 1–5 abgeschlossen. KI auto-trigger bleibt aus bis Abnahme.

### 6.1 Kontext

- [x] Voller Learning-Digest + vollständiger Daily Plan an KI (`src/ai/context.ts`)
- [x] Kein slot-only-Minimalkontext

### 6.2 Write-back

- [x] KI-Output → Allocation (Dryrun → Live) über Daily-Plan-States (`src/ai/writeback/`) — nie direkt auf Geräte
- [x] Plan B muss Plan A schlagen (Kosten primär, sonst Netz↓/PV↑) — sonst Auto-Trigger gesperrt (`ai.auto_suspended`)
- [x] `monthly_cost_limit` (`ai_monthly_cost_limit_eur`) + `minimum_replan_interval` (`ai_min_interval_minutes`)

### Block-6 Abnahme

- [x] Messbare Verbesserung in Unit-Tests (Write-back verschiebt Flex-Last in günstigeren/PV-Slot; sonst Suspend)
- [x] Masterplan §13 KI als „optional, nachweisbar“
- [x] Roadmap komplett (Blöcke 1–6)

---

## Explizit NICHT in dieser Roadmap

- Neuer Shadow/Takeover-Stack
- Wärmepumpe / neue Add-ons (nach Block 4)
- Fronius/Victron-Profile (separater Auftrag)
- Observe-Modus (separater Auftrag)
- Scope ohne Nutzerfreigabe

---

## Referenzen

- Masterplan: `docs/EMS_LIGHT_MASTERPLAN.md`
- Operator: `docs/EMS_LIGHT_OPERATOR_FOUNDATION.md`
- Architektur Ist: `docs/ARCHITECTURE.md`
- Cursor-Rule: `.cursor/rules/ems-light-roadmap.mdc`
