# EMS-Light — Forecast Plan

**Stand:** v0.1.188

## 1. Zweck

Der Forecast Plan führt die **realen** Planungsdaten in die gemeinsame Operator-Struktur zusammen. Ab v0.1.127 enthält er auch flexible Add-on-Contributions (Batterie, Wallbox, Heizstab, Klima). Die feste Energiebilanz (`renewableBalanceKwh`, `fixedBalancePowerW`) bleibt PV − feste Hauslast — flexible Lasten werden noch nicht abgezogen.

## 2. Datenquellen

| Contributor | Typ | Quellen |
|-------------|-----|---------|
| `pv_forecast` | Add-on | `learning.pv_bias.*`, `learning.pv_horizon.day3–7.*` |
| `house_load` | System | `learning.house_load.forecast_*_json`, Confidence, Status |
| `weather_forecast` | Add-on | `learning.weather.*`, konfigurierte Forecast-/Ist-States |
| `grid_supply` | System | Grid-Supply-Schicht (v0.1.125), Tibber/Fixed Tariff, Policy |
| `house_main_fuse` | Add-on | konfigurierte Sicherungs- und Importgrenzen |
| `global_constraints` | System | effektive Grenzen nach Global Mode |
| `battery`, `wallbox`, `immersion_heater`, `air_conditioning` | Add-on | flexible Bedarfe (v0.1.127) |

## 3. Horizont

- Mindestens Rest des aktuellen Tages plus Folgetag (bevorzugt 48 h)
- PV-Horizont-Tage 3–7 als **Tagesaggregate** in `days`
- Grid-Preis-Slots nur soweit echte Daten vorhanden sind
- Keine künstlichen leeren Slots bis zum Horizontende

## 4. Slot- und Tagesebene

**Tagesebene (`ForecastPlanDay`):**

- `pvEnergyKwh`, `houseLoadEnergyKwh`
- `renewableBalanceKwh` nur wenn **beide** Werte gültig: `PV − feste Hauslast`
- Wetter Min/Max, Qualität, `reason_de`

**Slot-Ebene (`ForecastPlanSlot`, Ziel 15 min):**

- Nur zeitlich auflösbare Daten (Grid-Preise, Hauslast-Segmente, optional PV-Form)
- PV-Leistung bleibt `null`, wenn keine belastbare Slot-Quelle existiert
- `fixedBalancePowerW` nur bei gültigem PV- **und** Hauslast-Slot

### PV-Kurve pro 15-Min-Slot (optional, v0.1.188)

Standardmäßig bleibt `pvPowerW` weiterhin `null` (nur Tages-kWh aus PV-Bias). Wird in Admin →
Lernen → „PV-Kurve pro 15-Min-Slot“ aktiviert **und** ein BrightSky-artiger Stunden-Prefix
konfiguriert, verteilt EMS die bereits gelernte Tages-kWh als Form über den Tag
(`src/operator/contributions/pv_shape.ts`):

- **Form** aus Sonnenstand (Clear-Sky, Näherung ohne Zeitgleichung) am System-Standort
  (`system.config.common.latitude/longitude`).
- **Dämpfung je Stunde**, wenn vorhanden: `solar_estimate` (bevorzugt, proportional auf die
  15-Min-Slots der Stunde verteilt) oder `cloud_cover` (linear gedämpft, Faktor 0,75).
- **Normierung**: Summe(`pvPowerW` × Slotdauer) über den Kalendertag ≈ die gelernte Tages-kWh —
  die Energiemenge kommt weiterhin ausschließlich aus PV-Bias, hier wird nur verteilt.
- **kWp-Kappung** (optional, `pv_shape_kwp_state_1/2`): `pvPowerW` wird nie über die konfigurierte
  Anlagenleistung hinaus ausgewiesen — trifft die Kappung, liegt die Tagessumme bewusst unter dem
  gelernten Wert (keine erfundene Überschreitung der Hardware-Grenze).
- Ohne Standort oder ohne konfigurierten Stunden-Prefix bleibt `pvPowerW` `null` — kein Fallback
  auf eine erfundene Kurve.

## 5. Umgang mit fehlenden Daten

- Fehlende Werte bleiben `null` — **keine erfundenen Nullen**
- Tages-kWh werden **nicht** gleichmäßig auf 15-Minuten-Slots verteilt
- Keine Glockenkurven oder geschätzte PV-Leistung aus Tagesenergie
- Ausgeschlossene Contributors unter `excludedContributors` mit deutscher Begründung

## 6. Aktive und ausgeschlossene Contributors

Ein Contributor ist **aktiv**, wenn:

- Datenquelle vorhanden und nicht vollständig ungültig
- Status nicht `disabled`
- erforderliche Konfiguration vorhanden

Fehlende Contributors werden nicht mit Null bilanziert, sondern unter `excludedContributors` gelistet.

## 7. State-Pfade

Unter `planner.intent.forecast_plan.*`:

- `status`, `generated_at`, `valid_until`, `revision`
- `horizon_start`, `horizon_end`, `slot_minutes`
- `active_contributors_json`, `excluded_contributors_json`
- `days_json`, `slots_json`, `contributions_json`
- `plan_json` (vollständiger Plan)
- `reason_de`

## 8. Abgrenzung zum Daily Plan

Der Forecast Plan beschreibt **Erwartungen und Grenzen**. Der **Daily Plan** (v0.1.128) entscheidet Allocation für den aktuellen Tag — siehe `docs/EMS_LIGHT_DAILY_PLAN.md`. Die feste Energiebilanz im Forecast Plan bleibt PV − feste Hauslast.

## 9. Abgrenzung zur späteren KI-Optimierung

KI darf später innerhalb gültiger Pläne optimieren. Der Forecast Plan bleibt deterministisch und regelbasiert — keine KI in v0.1.126.

## 10. Noch nicht implementiert

- Runtime liest Daily Plan (Allocation nur als Vorschau)
- Wallbox-Live-Steuerung, Batterie-Entladung
- KI-Optimierung und Statistikvergleich

## Status `ready`, `degraded`, `missing_inputs`

| Status | Bedingung |
|--------|-----------|
| `ready` | PV-Tagesprognose, Hauslast-Tagesprognose, gültige Zeitzone; Wetter und Grid optional vollständig |
| `degraded` | PV + Hauslast vorhanden, aber Wetter/Grid/Qualität eingeschränkt |
| `missing_inputs` | PV oder Hauslast fehlt — keine Energiebilanz erfunden |
| `disabled` | Plan deaktiviert (reserviert) |
| `error` | Build-/Schreibfehler |

Implementierung: `src/operator/forecast/`, Contributions: `src/operator/contributions/`.
