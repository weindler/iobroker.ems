# State Surface — Production Gap Analysis (Phase 4B1)

Read-only explanation of the ~437 object gap between the static catalog (~1097) and a typical production instance (~1534).
**No state values or PII.** Optional live dumps: `npm run audit:states -- --dump <export.json> --write-docs` (reports under `tmp/` stay gitignored).

## Summary

| Metric | Approx. |
|--------|--------:|
| Catalog static estimate | ~1097 |
| Production observed | ~1534 |
| Gap | ~437 |
| Primary explainable share | AC placeholders + mappings for unused unit slots |

## Explained families (largest gap drivers)

### 1. Air conditioning — unconfigured unit slots (dominant)

**Root cause:** Pre-4B1 `ensureAcRuntimeStates` / `acMappingCommands()` always expanded units `1..5` and 16 mapping roles × 3 states per unit, regardless of Admin enablement or mapping targets.

Per unused unit (order of magnitude):

| Subtree | ~Leaves |
|---------|--------:|
| Runtime channel + states | ~24 |
| Mapping roles × 3 | ~48 |
| Consumer stats under unit | ~12 |
| **Per unused unit** | **~80–90** |

If production effectively used 1 configured unit and kept placeholders for 4 slots: **~320–360** objects — the bulk of the ~437 gap.

Phase 4B1+: ensure + cleanup only when unit **enabled** (`ac_uN_enabled`). Disabled slots and leftover mappings are not kept as objects.

### 2. Fahrzeugprofile

Empty `wb_vehicle_profiles` already created only the parent channel (no default cars). Remaining vehicle inflation is **real** profile trees (~64 states each). Orphans from removed table rows are now allowlist-cleanable. Not a major share of the historical 437 if profiles were few.

### 3. Other over-ensure (investigated, mostly deferred)

| Area | Finding | 4B1 action |
|------|---------|------------|
| Wallbox static/mappings | Always ensured when addon present | No broad delete |
| Battery profile-specific | Active-profile driven; risk of false cleanup | Untouched |
| Grid / house connection | Operational; not placeholder | Untouched |
| Consumer 1/2, pool pump | Not confirmed as empty stubs | Untouched |
| Learning / dryrun | Dynamic on use | Untouched |
| Add-on default objects | Basis channels needed | Untouched |

Residual gap after AC placeholders (~70–100) may include dryrun mirrors, learning growth, extra channels, or catalog under-count — dump analysis groups unknowns by prefix without values.

## Tooling

```bash
npm run audit:states
npm run audit:states -- --dump /path/to/objects.json --json-out tmp/state-surface-dump-report.json --write-docs
```

## Compatibility (do not remove)

- `planner.intent.allocation.*.plan_json`
- Legacy `planner.intent.*`
- `learning.persistence.*_json`
