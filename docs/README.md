# EMS-Light — Dokumentation

**Adapter:** `iobroker.ems` · **Stand:** v0.1.189 (Juli 2026)

## Zentrale Dokumente

| Dokument | Rolle |
|----------|--------|
| [EMS_LIGHT_MASTERPLAN.md](./EMS_LIGHT_MASTERPLAN.md) | Zielbild und verbindliche Regeln |
| [EMS_LIGHT_OPERATOR_FOUNDATION.md](./EMS_LIGHT_OPERATOR_FOUNDATION.md) | General Operator (Pipeline, Rollen) |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Implementierter Ist-Stand |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | Build, Tests, Doc-Regeln |
| [EMS_LIGHT_FRESH_INSTALL_CHECKLIST.md](./EMS_LIGHT_FRESH_INSTALL_CHECKLIST.md) | Neuinstallation / Namespace-Wipe |

## Operator & Planung (Produktion)

Schwerer Planner-Shadow/Takeover ist seit v0.1.181 **vollständig aus dem Code entfernt**. Produktion läuft über Forecast Plan → Daily Plan → Allocation → Intent → Profil.

| Dokument | Inhalt |
|----------|--------|
| [EMS_LIGHT_FORECAST_PLAN.md](./EMS_LIGHT_FORECAST_PLAN.md) | Erwartungen/Grenzen, PV-Horizont, Bias |
| [EMS_LIGHT_DAILY_PLAN.md](./EMS_LIGHT_DAILY_PLAN.md) | Tages-Allocation |
| [EMS_LIGHT_FLEXIBLE_CONTRIBUTIONS.md](./EMS_LIGHT_FLEXIBLE_CONTRIBUTIONS.md) | Flexible Add-on-Bedarfe |

## Add-ons

| Dokument | Add-on |
|----------|--------|
| [EMS_LIGHT_WALLBOX_LIVE_FOUNDATION.md](./EMS_LIGHT_WALLBOX_LIVE_FOUNDATION.md) | Wallbox Live-Grundlage |
| [EMS_LIGHT_WALLBOX_DRYRUN_DISPATCH.md](./EMS_LIGHT_WALLBOX_DRYRUN_DISPATCH.md) | Dryrun-Dispatch |
| [EMS_LIGHT_WALLBOX_DAILY_PLAN_READONLY.md](./EMS_LIGHT_WALLBOX_DAILY_PLAN_READONLY.md) | Daily-Plan-Diagnose |
| [EMS_LIGHT_WALLBOX_EVCC_WRITE_CONTRACT.md](./EMS_LIGHT_WALLBOX_EVCC_WRITE_CONTRACT.md) | EVCC-Write-Vertrag |
| [EMS_LIGHT_WALLBOX_EVCC_CONTROL_MAPPING.md](./EMS_LIGHT_WALLBOX_EVCC_CONTROL_MAPPING.md) | EVCC-Control-Mapping |
| [EMS_LIGHT_WALLBOX_FEEDBACK_CONTRACT.md](./EMS_LIGHT_WALLBOX_FEEDBACK_CONTRACT.md) | Feedback-Vertrag |
| [EMS_LIGHT_WALLBOX_VEHICLE_PROFILES.md](./EMS_LIGHT_WALLBOX_VEHICLE_PROFILES.md) | Fahrzeugprofile |
| [EMS_LIGHT_WALLBOX_VEHICLE_SOC_ENERGY.md](./EMS_LIGHT_WALLBOX_VEHICLE_SOC_ENERGY.md) | SOC / Energie |
| [EMS_LIGHT_BATTERY_LIVE_FOUNDATION.md](./EMS_LIGHT_BATTERY_LIVE_FOUNDATION.md) | Batterie Live-Absicherung (Gate/Failsafe) |
| [EMS_LIGHT_BATTERY_DAILY_PLAN_RUNTIME.md](./EMS_LIGHT_BATTERY_DAILY_PLAN_RUNTIME.md) | Batterie + Daily Plan |
| [EMS_LIGHT_IMMERSION_DAILY_PLAN_RUNTIME.md](./EMS_LIGHT_IMMERSION_DAILY_PLAN_RUNTIME.md) | Heizstab |
| [EMS_LIGHT_AC_DAILY_PLAN_RUNTIME.md](./EMS_LIGHT_AC_DAILY_PLAN_RUNTIME.md) | Klima |

Seit v0.1.189: **Fix Standort-Parsing** für die PV-Kurve (`src/operator/contributions/read.ts`,
`readSystemLocation`). `system.config.common.latitude/longitude` wurde bisher nur akzeptiert, wenn
es als reine JS-Zahl vorlag — bei manchen System-Einstellungen (Float-Teiler-Zeichen = Komma) wird
der Wert als Komma-String gespeichert und die PV-Kurve blieb trotz vollständig korrekter Konfiguration
inaktiv (`daily_only`, „Lat/Lon oder Wetterdaten fehlen“). Lat/Lon werden jetzt wie alle anderen
Zahlenwerte im Adapter toleranter geparst (Komma oder Punkt).

## KI-Optimierung (optional, `src/ai/`)

Seit v0.1.185: Gerüst, standardmäßig aus. Global-Tab: An/Aus, OpenAI-Modell-Whitelist (Default `gpt-4.1-mini`), verschlüsseltes Token (`encryptedNative`), Tageslimit (Soft-Warnung ab 80%), manueller „Jetzt optimieren“-Button. Automatischer Aufruf nur bei relevanter Daily-Plan-Änderung (siehe v0.1.193-Fix unten) oder manuell — nicht bei jedem Tick. Die KI liefert kurze Text-Hinweise UND (seit v0.1.186) optionale Zeitpunkt-Präferenzen (`slot_preferences`, Gewichtung 0..3 je 15-Min-Slot) zu Add-ons, die aktiv UND einzeln „KI-Optimierung erlaubt“ sind; sie schreibt nichts in die Allocation zurück (noch keine echte Optimierungslogik, siehe Masterplan §4/§13). Fail-closed bei fehlendem Token, Limit, Timeout oder ungültiger Antwort. Token nie im Backup/Support-Export (automatisch über `isSecretKey`/`ALLOWED_PREFIXES` in `src/backup/collect_config.ts`).

Seit v0.1.193: **Fix automatischer KI-Trigger** (`src/ai/index.ts`, `src/ai/trigger_digest.ts`) — der automatische Trigger reagierte bis dahin auf jede Daily-Plan-Revision, die praktisch bei jedem EMS-Tick wechselt (Horizont-Roll, Allocation-Fortschritt, Zehntelgrad-Zittern), nicht nur bei tatsächlich relevanten Änderungen. Das hat das Tageslimit (und Tokens/Kosten) unnötig schnell verbraucht. Neu: ein bewusst grober Plan-Fingerabdruck (Kalendertag, Global Mode, Plan-Status, aktive/ausgeschlossene Add-on-IDs, grob gerasterte Summen für Flex-Bedarf/-Allocation/-Rest, PV-Tagesprognose und Netzkosten — Raster 0,3 kWh / 2 kWh / 50 ct) wird bei jedem Tick berechnet; der automatische KI-Aufruf läuft nur noch, wenn sich dieser Fingerabdruck seit dem letzten Aufruf tatsächlich ändert (z. B. Add-on startet/stoppt, Zieltemperatur-Stufe wechselt, PV-Prognose springt, Tages-/Modus-Wechsel). Der manuelle „Jetzt optimieren“-Button ist davon unberührt.

Seit v0.1.188: **PV-Kurve pro 15-Min-Slot** (optional, `src/operator/contributions/pv_shape.ts`,
Admin → Lernen → „PV-Kurve pro 15-Min-Slot“). Standardmäßig aus. Aktiviert (BrightSky-Stunden-Prefix
+ System-Standort) verteilt EMS die gelernte Tages-PV-kWh (PV-Bias, unverändert) als Form über den
Tag: Sonnenstand (Clear-Sky-Näherung) je 15-Min-Slot, gedämpft/gewichtet je Stunde durch
`solar_estimate` (bevorzugt) oder `cloud_cover` (linear, Faktor 0,75) — wenn für die Stunde
vorhanden. Summe(Leistung×Dauer) bleibt auf die gelernte Tages-kWh normiert; optionale
kWp-Kappung (`pv_shape_kwp_state_1/2`) klippt Spitzen statt die Hardware-Grenze zu überschreiten.
Ohne Standort/Stundenquelle bleibt `pvForecastPowerW` weiterhin `null` wie bisher. Damit steht dem
Daily Plan erstmals ein echter `pvForecastPowerW` je Slot zur Verfügung — Voraussetzung für
sinnvolle flexible Allocation (Heizstab/Klima/Batterie), siehe v0.1.187-Fix unten.

Seit v0.1.187: **Fix Daily-Plan-Merge** (`src/operator/daily_plan/constraints.ts`) — Hauslast-Prognosen liefern Mehrstunden-Segment-Baselines (z. B. „Nacht 00–06 Uhr“), der Merge in die 15-Minuten-Daily-Plan-Slots suchte aber nur exakte 15-Min-Key-Treffer. Dadurch blieb `fixedHouseLoadPowerW` (und damit `fixedBalancePowerW`/`availablePvSurplusPowerW`) in jedem Slot `null`, obwohl ein Segmentwert existierte — das blockierte flexible Allocation für **alle** Add-ons, nicht nur Heizstab/Klima. Neu: pro Feld (`pv`, `houseLoad`, `gridPrice`, `gridImportAllowed`) wird der präziseste Forecast-Slot gesucht, der den 15-Min-Horizont-Slot vollständig umschließt (`buildForecastFieldIndex`/`lookupContaining`), statt exaktem Key-Match. Exakt aufgelöste Quellen (Tibber-Preise) funktionieren unverändert weiter. PV-Leistung pro Slot bleibt weiterhin `null` — es existiert noch keine 15-Min-PV-Pipeline (in Arbeit, siehe Aufräum-Fahrplan).

Seit v0.1.186: **Plan-Vergleich** (`src/ai/compare/`, Admin-Tab „Plan-Vergleich“). Plan A = deterministischer Plan, den EMS tatsächlich ausführt (unverändert). Plan B = reine Beobachtungs-Simulation: verteilt dieselbe von Plan A für Heizstab/Klima flexibel eingeplante Energiemenge anhand der KI-`slot_preferences` neu über den Tag (Wasserfüllungs-Algorithmus, kapazitätsbegrenzt durch das, was in jedem Slot nach Plan A an PV/Netz-Freiraum ohnehin verfügbar war). Pflicht-Zyklen (mandatory, z. B. Anti-Legionellen) werden nie angefasst. Ohne KI oder ohne Add-on-Freigabe ist Plan B identisch mit Plan A. States: `compare.plan_a.chart_json` / `compare.plan_b.chart_json` (VIS-taugliche `[{t,pv_w,grid_w,ih_w,ac_w,price_ct}, …]`-Zeitreihen), `compare.active_plan` (nur Anzeige, schaltet nichts um), `compare.delta_summary_json` (Kosten/PV/Netz/unallokiert je Plan). Läuft automatisch, wenn die KI-Optimierung ausgelöst wird (siehe v0.1.193-Fix oben — nicht mehr bei jeder Daily-Plan-Revision).

## Backup / Restore

| Dokument | Inhalt |
|----------|--------|
| [EMS_LIGHT_V0_1_140_STATE_TREE_RECOVERY.md](./EMS_LIGHT_V0_1_140_STATE_TREE_RECOVERY.md) | State-Tree Recovery |
| [EMS_LIGHT_V0_1_141_BACKUP_EXPORT.md](./EMS_LIGHT_V0_1_141_BACKUP_EXPORT.md) | Export |
| [EMS_LIGHT_V0_1_142_MANUAL_RESTORE.md](./EMS_LIGHT_V0_1_142_MANUAL_RESTORE.md) | Restore |
| [EMS_LIGHT_V0_1_143_IOBACKUP_INTEGRATION.md](./EMS_LIGHT_V0_1_143_IOBACKUP_INTEGRATION.md) | dataFolder / Runtime |

## Aufräum-Fahrplan bis 10.08.2026 (Ford Explorer EV, 79 kWh)

Kein Architektur-Umbau — sequenzielle Blöcke, jeder vollständig abgeschlossen (Tests grün, Version/News, Doku) bevor der nächste beginnt:

0. ✅ **DST-/Bootstrap-Testfehler fixen** (v0.1.176) — `operator/time.test.ts` Mitternachts-Erwartung korrigiert, Bootstrap-Manifest an aktuelle Learning-Persistenz-States angepasst.
1. ✅ **Wallbox-Live-Gate kontrolliert öffnen** (v0.1.177) — echte Writes für den EVCC-Control-Pfad, aktive Feedback-Verifikation per Safety-Tick, Ownership/Fault-Lockout/Safe-Restore analog Heizstab/Batterie. Legacy-Direktpfad (go-e) bleibt strukturell ausgeschlossen.
2. ✅ **Batterie-Laden vollständig live absichern** (v0.1.178) — `FinalWriteGate` echt verdrahtet (Fault/Lockout/Ownership statt Platzhalter), `safety_blocked` (HW-SOC-Obergrenze) aktiviert, eigenständiger FSM-unabhängiger Battery-Failsafe (EMS-Unreachable-Heartbeat) analog Wallbox/Heizstab, neue Safety-/Restore-/Failsafe-Tests.
3. ✅ **Admin-UI: Generator für Klima-Tab-Duplikate** (v0.1.180) — 5× identische AC-Unit-Blöcke werden jetzt aus `src/tools/admin_config/climate_unit_shape.ts` (Struktur) + `climate_unit_defaults.ts` (5 individuelle Default-Sets) generiert statt von Hand gepflegt. `npm run admin-config:generate` schreibt `admin/jsonConfig.json` neu (nur der Klima-Block wird textuell ersetzt, alles andere bleibt Byte-identisch). `npm test` prüft per Drift-Check (`admin-config:check`), dass die Datei dem Template entspricht — jede zukünftige Handbearbeitung der `ac_u<N>_*`-Felder lässt CI fehlschlagen.
4. ✅ **Shadow-Stack-Löschung** (v0.1.181) — vorgezogen (vorher „nach dem 10.08.“ geplant). 16 Verzeichnisse (`planner_shadow`, `planner_takeover`, `planner_authority`, `planner_authorization`, `planner_coordinator`, `planner_snapshot`, `planner_config`, `planner_trigger`, `planner_repository`, `planner_job`, `planner_worker`, `planner_preparation`, `planner_paths`, `planner_candidate`, `planner_contracts`, `planner_publish`), ~20.500 LOC, komplett entfernt — sie waren in Produktion bereits unerreichbar (`initPlannerShadowRuntime` wurde nur aus Tests aufgerufen, nie aus `main.ts`/`ems_light`). `src/planner/` (aktiver Realtime-Fallback für Thermal/Cooling/Battery-Winter) bleibt vollständig erhalten und unverändert im Verhalten. Kompilierte Build-Ausgabe (`build/`) dadurch ~23 % kleiner (5,6 MB → 4,3 MB); RAM-Fußabdruck unverändert, da die Module bereits vorher nie in den Produktionspfad geladen wurden (per Test abgesichert, siehe `ems_light/off_legacy_lazy.test.ts`). `npm test`: 1172/1172 grün.

Nicht priorisiert: Heavy Planner wieder einführen, weitere Batterie-Profile (Fronius/Victron), KI-Optimierungsschicht (erst nach stabilem Wallbox-/Batterie-Live-Betrieb).

**Zwischenfix (v0.1.179, außerhalb der Blockreihe):** Heizstab lud im Auto-Modus nie bis zum vollen Tagesziel durch — ein früher Stopp unterhalb des Ziels (PV-Überschuss-Dip, 0 W Daily-Plan-Allocation) wurde von der Wiedereinschalt-Hysterese fälschlich wie „Ziel erreicht“ behandelt. Hysterese greift jetzt erst nach echter Zielerreichung. Siehe `docs/EMS_LIGHT_IMMERSION_DAILY_PLAN_RUNTIME.md`.

## Nicht mehr im Repo

Entfernt (Juli 2026): `planner_phase_3*`, Shadow-Gate-Verification, State-Surface-/Admin-Audit-Arbeitsberichte. Seit v0.1.181 zusätzlich entfernt: der komplette Shadow/Takeover/Authority/Authorization/Coordinator-Codestack (Block 4, siehe oben) — nur noch als String-Präfixe in `src/surface_cleanup/allowlist.ts` (Migration/Purge alter Objektbäume aus Vor-Installationen) und `src/audit/state_surface_catalog.ts` (Katalog-Metadaten) referenziert, kein Code-Import mehr.
