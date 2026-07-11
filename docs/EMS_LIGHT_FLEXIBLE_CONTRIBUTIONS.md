# EMS-Light — Flexible Plan Contributions

**Stand:** v0.1.127

## 1. Zweck

Flexible Contributions beschreiben für steuerbare Add-ons **Bedarf, technische Möglichkeiten, Flexibilität, Zeitfenster, Deadlines, Leistungsgrenzen, Safety-Status und Ausschlussgründe** — ohne eine endgültige Verteilungsentscheidung (Allocation) zu treffen.

Sie ergänzen die bestehenden Basis-Contributions (PV, Hauslast, Wetter, Grid, Constraints) im gemeinsamen Forecast Plan.

## 2. Unterschied zwischen Bedarf und Allocation

| Aspekt | Flexible Contribution (v0.1.127) | Allocation / Daily Plan (später) |
|--------|----------------------------------|----------------------------------|
| Entscheidung | dokumentiert Möglichkeiten | wählt konkrete Fenster und Leistungen |
| Energiebilanz | PV − feste Hauslast **unverändert** | zieht flexible Lasten ab |
| Geräte-Writes | keine | Dispatch über Runtime |
| Slots | technische Verfügbarkeit | bevorzugte Leistung / Zeit |

## 3. Contribution-IDs

Stabile IDs in `src/operator/contribution_ids.ts`:

| ID | Add-on | Flow | Rollen |
|----|--------|------|--------|
| `battery.charge` | battery | consume | storage, demand_flex, dispatch |
| `battery.discharge` | battery | provide | storage, supply, dispatch |
| `battery.reserve` | battery | constraint | storage, constraint |
| `wallbox.ev_session` | wallbox | consume | demand_flex, dispatch |
| `immersion_heater.mandatory` | immersion_heater | consume | demand_flex, dispatch |
| `immersion_heater.flexible` | immersion_heater | consume | demand_flex, dispatch |
| `air_conditioning.unit_1` … `unit_5` | air_conditioning | consume | demand_flex, dispatch |

Keine dynamischen IDs, keine Zeitstempel in IDs. Flussrichtung über `flow`, nicht über Vorzeichen.

## 4. Batterie

### Charge (`battery.charge`)

- Beschreibt möglichen/erforderlichen Ladebedarf aus SOC, Kapazität, Ziel-SOC (Mode-Policy, Top-Off)
- `gridEligible` nur bei erlaubtem Netzimport, Global Mode, Profil- und Runtime-Fähigkeit
- PV-Laden unabhängig von `gridEligible` in `details.pvChargeAllowed`
- Slots: technische Maximalleistung, kein „jetzt laden“

### Discharge (`battery.discharge`)

- Profil `sonnen_em`: Status `unsupported`, `enabled: false`, keine Entlade-Slots
- Passives Eigenverbrauchsentladen nur in `details` dokumentiert
- Kein neuer Write-Pfad, keine Entladesteuerung

### Reserve (`battery.reserve`)

- Min-/Max-SOC, Reserve, verfügbare Energie oberhalb Reserve
- Top-Off-Ziel falls aktiv
- Constraint — noch keine Entladeleistungsfreigabe

## 5. Wallbox

### EV-Session (`wallbox.ev_session`)

**Connected-Gate:** `connected = false` → keine aktive Lade-Contribution (`disabled`, „Fahrzeug nicht verbunden“). SOC = 0 bei disconnected ist unkritisch.

**Energiebedarf (Priorität):**

1. belastbare `remainingEnergyKwh` (EVCC/Intent)
2. Fahrzeugkapazität × (Ziel-SOC − Ist-SOC)
3. sonst `null` — keine erfundene Kapazität

**Deadline:** vorhandene Deadline übernehmen, sonst `null`.

**Runtime:** read-only — `details.runtimeControlAvailable: false`, keine EVCC-Writes.

## 6. Heizstab

### Mandatory (`immersion_heater.mandatory`)

- Nur bei eindeutigem Pflichtbedarf: Puffer unter `planningMinTempC`, Frost/Safety, Modus `force`
- `mandatory: true`, `gridEligible: false` (Standard)

### Flexible (`immersion_heater.flexible`)

- Nur bei Governance, Modus `auto`, Zieltemperatur nicht erreicht
- PV-first, Netzbezug standardmäßig nicht freigegeben
- Beschreibt Bedarf — kopiert nicht blind `planner.intent.thermal.action`

## 7. Klima

- Pro Unit (`AC_UNIT_COUNT = 5`) ein Beitrag `air_conditioning.unit_N`
- Deaktivierte Units: `disabled`
- Kühlbedarf aus Raumtemperatur, Ziel, Wetter, Learning/Config (`details.powerSource`)
- **Governance-Lücke:** Contributions beachten `addons.climate.governance.enabled`; AC-Runtime-FSM prüft nur `addons.air_conditioning.enabled` (nicht in v0.1.127 behoben)

## 8. Teilnahme- und Ausschlussregeln

Gemeinsame Prüfung in `src/operator/contributions/flexible/types.ts` (`evaluateParticipation`):

| Status | Beispiel |
|--------|----------|
| `disabled` | Add-on/Governance aus, Global Mode off |
| `missing` | Mapping/Config fehlt |
| `invalid` | Telemetrie ungültig |
| `degraded` | Daten veraltet, eingeschränkter Bedarf |
| `blocked` | Fault, Lockout |
| `unsupported` | Profil ohne Entlade-Sollwert |

Deaktivierte/blockierte Add-ons erscheinen nicht als verfügbare flexible Last.

## 9. Global Modes

Policy über `plannerModePolicyFromGlobalMode` — keine neue versteckte Prioritätsordnung.

- `off`: keine flexiblen Contributions als verfügbar
- `eco`: strengere Netzbezugsregeln (Batterie/Wallbox)
- `balanced` / `comfort` / `forced`: vorhandene Policy-Werte in `details`

`priorityBand = null`, wenn keine numerische Policy vorliegt.

## 10. State-Pfade

Zentral (`planner.intent.contributions.flexible.*`):

- `status`, `generated_at`, `contributions_json`, `active_json`, `excluded_json`, `reason_de`, `revision`

Pro Add-on:

- `planner.intent.contributions.battery.*`
- `planner.intent.contributions.wallbox.*`
- `planner.intent.contributions.immersion_heater.*`
- `planner.intent.contributions.air_conditioning.*`

## 11. Forecast-Plan-Integration

- Flexible Contributions in `contributions` des Forecast Plans
- Feste Bilanz: `renewableBalanceKwh = PV − feste Hauslast` (**unverändert**)
- Disconnected Wallbox, unsupported Battery Discharge, deaktivierte Add-ons: kein Planfehler
- Gründe pro Contribution in `excludedContributors` / Qualität

## 12. Tick-Reihenfolge

```
Grid Supply → Basis-Contributions → Flexible Add-ons → Forecast Plan → Planner → Runtime
```

Modul: `src/operator/contributions/flexible/tick.ts`

## 13. Abgrenzung zum nächsten Block

Noch **nicht** implementiert:

- Allocation Engine
- Ausführbarer Daily Plan
- Dispatch aus Contributions
- Wallbox-Live-Steuerung / EVCC-Writes
- Batterie-Entladesteuerung
- Runtime-Umstellung (Batterie-/Heizstab-/Klima-FSM)
- AC-Governance-Fix in der Runtime
- KI-Optimierung
- Statistikvergleich
