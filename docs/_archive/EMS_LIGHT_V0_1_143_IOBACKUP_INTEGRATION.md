# EMS-Light v0.1.143 — ioBroker / Backitup Integration

## Scope

v0.1.143 integrates EMS-Light into the **official ioBroker backup mechanism** via `common.dataFolder`. There is **no direct Backitup dependency**, no `sendTo("backitup.0", ...)`, and no backup scheduling from EMS.

## Directory layout

| Path | Backed up by ioBroker |
|------|------------------------|
| `<iobroker-data>/ems.<instance>/` | yes (`dataFolder`) |
| `<iobroker-data>/ems-runtime.<instance>/` | no |

### Durable (`ems.<instance>/`)

- `learning/**`
- `policy/policy_global_v1.json`
- `manifest.json`
- `migration/status.json`

### Runtime (`ems-runtime.<instance>/`)

- `runtime/intent/`, `runtime/global_modes/`, `runtime/addons/**`
- `exports/backup/`, `exports/support/`
- `restore/inbox/`, `restore/transactions/`
- `recovery/boot-guard.json`
- `quarantine/`, `temp/`

## Startup safety

Every process start:

1. Bootstrap/restore barrier active
2. Effective execution modes **dryrun**
3. `forceDryrunReason = startup_rearm_required` (unless restore recovery applies)
4. Manifest, migration, boot-guard, and journal validation
5. Full bootstrap and reconciliation
6. Barrier opens — **still dryrun**
7. Live requires a **fresh user request** after bootstrap (unacked state change with `ts >= bootstrapComplete`)

Manual restore (v0.1.142) remains stricter: native and effective modes forced to dryrun.

## Upgrade note

After upgrading to v0.1.143:

1. Allow one successful adapter start and runtime migration to complete.
2. Verify `info.backup.migration_status = completed` and no legacy runtime files remain under `ems.<instance>/`.
3. Only then create a new reference ioBroker backup.

Restored ioBroker backups bring back durable EMS data only; EMS always starts in dryrun until live rearm.

## Diagnostics

Read-only states under `info.backup.*` — see `src/backup_integration/ensure_states.ts`.

## Explicitly not included

- Backitup communication or configuration
- Automatic live resume
- Persistent operation lock file
- Changes to `vis/`
