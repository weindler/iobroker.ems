# EMS-Light — Dokumentation

**Adapter:** `iobroker.ems` · **Stand:** v0.1.179 (Juli 2026)

## Zentrale Dokumente

| Dokument | Rolle |
|----------|--------|
| [EMS_LIGHT_MASTERPLAN.md](./EMS_LIGHT_MASTERPLAN.md) | Zielbild und verbindliche Regeln |
| [EMS_LIGHT_OPERATOR_FOUNDATION.md](./EMS_LIGHT_OPERATOR_FOUNDATION.md) | General Operator (Pipeline, Rollen) |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Implementierter Ist-Stand |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | Build, Tests, Doc-Regeln |
| [EMS_LIGHT_FRESH_INSTALL_CHECKLIST.md](./EMS_LIGHT_FRESH_INSTALL_CHECKLIST.md) | Neuinstallation / Namespace-Wipe |

## Operator & Planung (Produktion)

Schwerer Planner-Shadow/Takeover ist **abgeschaltet**. Produktion läuft über Forecast Plan → Daily Plan → Allocation → Intent → Profil.

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
3. **Admin-UI: Generator für Klima-Tab-Duplikate** — 5× identische AC-Unit-Blöcke (48,5 % von `admin/jsonConfig.json`) aus einem Template erzeugen, kein Laufzeit-/Schema-Risiko.
4. Shadow-Stack-Löschung — **explizit nach dem 10.08.**, `src/planner/` (aktiver Realtime-Fallback) bleibt in jedem Fall erhalten.

Nicht priorisiert bis dahin: Heavy Planner wieder einschalten, weitere Batterie-Profile (Fronius/Victron), KI-Optimierungsschicht (erst nach Block 1–3).

**Zwischenfix (v0.1.179, außerhalb der Blockreihe):** Heizstab lud im Auto-Modus nie bis zum vollen Tagesziel durch — ein früher Stopp unterhalb des Ziels (PV-Überschuss-Dip, 0 W Daily-Plan-Allocation) wurde von der Wiedereinschalt-Hysterese fälschlich wie „Ziel erreicht“ behandelt. Hysterese greift jetzt erst nach echter Zielerreichung. Siehe `docs/EMS_LIGHT_IMMERSION_DAILY_PLAN_RUNTIME.md`.

## Nicht mehr im Repo

Entfernt (Juli 2026): `planner_phase_3*`, Shadow-Gate-Verification, State-Surface-/Admin-Audit-Arbeitsberichte. Code für Shadow/Takeover kann noch liegen (abgeschaltet) — Aufräumen ist ein eigener Block, kein Doc-Thema.
