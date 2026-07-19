# EMS-Light — Dokumentation

**Adapter:** `iobroker.ems` · **Stand:** v0.1.174 (Juli 2026)

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

## Priorität bis 10.08.2026 (Ford Explorer EV, 79 kWh)

1. **EVCC** zuverlässig (Mapping, Feedback, Live-Writes freigeben wenn dryrun ok)
2. **Hausbatterie live** (Laden über Daily Plan, Safety/Fault/Ownership)
3. **Wallbox** über Operator-Allocation + Fahrzeugprofil (Explorer)
4. Heizstab/Klima beobachten (bereits Daily-Plan-Pfad)
5. **KI erst danach** — optional auf Forecast/Daily Plan, nie direkte Geräte-Writes

Nicht priorisiert bis dahin: Heavy Planner wieder einschalten, Shadow/Takeover, weitere Batterie-Profile (Fronius/Victron).

## Nicht mehr im Repo

Entfernt (Juli 2026): `planner_phase_3*`, Shadow-Gate-Verification, State-Surface-/Admin-Audit-Arbeitsberichte. Code für Shadow/Takeover kann noch liegen (abgeschaltet) — Aufräumen ist ein eigener Block, kein Doc-Thema.
