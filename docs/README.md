# EMS-Light — Dokumentation

**Adapter:** `iobroker.ems` · **Stand:** v0.1.186 (Juli 2026)

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

## KI-Optimierung (optional, `src/ai/`)

Seit v0.1.185: Gerüst, standardmäßig aus. Global-Tab: An/Aus, OpenAI-Modell-Whitelist (Default `gpt-4.1-mini`), verschlüsseltes Token (`encryptedNative`), Tageslimit (Soft-Warnung ab 80%), manueller „Jetzt optimieren“-Button. Aufruf nur bei neuer Daily-Plan-Revision oder manuell — nicht bei jedem Tick. Die KI liefert kurze Text-Hinweise UND (seit v0.1.186) optionale Zeitpunkt-Präferenzen (`slot_preferences`, Gewichtung 0..3 je 15-Min-Slot) zu Add-ons, die aktiv UND einzeln „KI-Optimierung erlaubt“ sind; sie schreibt nichts in die Allocation zurück (noch keine echte Optimierungslogik, siehe Masterplan §4/§13). Fail-closed bei fehlendem Token, Limit, Timeout oder ungültiger Antwort. Token nie im Backup/Support-Export (automatisch über `isSecretKey`/`ALLOWED_PREFIXES` in `src/backup/collect_config.ts`).

Seit v0.1.186: **Plan-Vergleich** (`src/ai/compare/`, Admin-Tab „Plan-Vergleich“). Plan A = deterministischer Plan, den EMS tatsächlich ausführt (unverändert). Plan B = reine Beobachtungs-Simulation: verteilt dieselbe von Plan A für Heizstab/Klima flexibel eingeplante Energiemenge anhand der KI-`slot_preferences` neu über den Tag (Wasserfüllungs-Algorithmus, kapazitätsbegrenzt durch das, was in jedem Slot nach Plan A an PV/Netz-Freiraum ohnehin verfügbar war). Pflicht-Zyklen (mandatory, z. B. Anti-Legionellen) werden nie angefasst. Ohne KI oder ohne Add-on-Freigabe ist Plan B identisch mit Plan A. States: `compare.plan_a.chart_json` / `compare.plan_b.chart_json` (VIS-taugliche `[{t,pv_w,grid_w,ih_w,ac_w,price_ct}, …]`-Zeitreihen), `compare.active_plan` (nur Anzeige, schaltet nichts um), `compare.delta_summary_json` (Kosten/PV/Netz/unallokiert je Plan). Läuft automatisch bei jeder neuen Daily-Plan-Revision.

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
