"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDynamicSurfaceCleanup = void 0;
/**
 * Phase 4B1 — controlled cleanup of unambiguously empty dynamic placeholders.
 * Deletes only allowlisted relative IDs under the adapter namespace.
 */
const constants_1 = require("../addons/air_conditioning/constants");
const configured_1 = require("../addons/air_conditioning/configured");
const ensure_states_1 = require("../addons/air_conditioning/runtime/ensure_states");
const ensure_states_2 = require("../addons/wallbox/vehicles/ensure_states");
const persistence_mirror_1 = require("../learning/persistence_mirror");
const states_1 = require("../addons/wallbox/runtime/states");
const ensure_states_3 = require("../addons/battery/ensure_states");
const tree_paths_1 = require("../tree_paths");
const allowlist_1 = require("./allowlist");
function bump(stats, reason) {
    stats.skipped += 1;
    stats.skippedReasons[reason] = (stats.skippedReasons[reason] ?? 0) + 1;
}
function isProtectedRelativeId(relativeId) {
    if ((0, allowlist_1.isLeanPlannerPurgeRoot)(relativeId)) {
        return false;
    }
    for (const p of allowlist_1.PROTECTED_PREFIXES) {
        if (relativeId === p || relativeId.startsWith(`${p}.`) || relativeId.startsWith(p)) {
            return true;
        }
    }
    for (const p of allowlist_1.COMPATIBILITY_STATE_PREFIXES) {
        if (relativeId === p || relativeId.startsWith(p)) {
            return true;
        }
    }
    return false;
}
async function safeDeleteRelative(host, relativeId, stats, kind) {
    stats.checked += 1;
    if (!(0, allowlist_1.isAllowlistedCleanupRelativeId)(relativeId)) {
        bump(stats, `not_allowlisted:${kind}`);
        return;
    }
    if (isProtectedRelativeId(relativeId)) {
        bump(stats, `protected:${kind}`);
        return;
    }
    const obj = await host.getObjectAsync(relativeId);
    if (!obj) {
        bump(stats, `missing:${kind}`);
        return;
    }
    try {
        await host.delObjectAsync(relativeId, { recursive: true });
        stats.deleted += 1;
        host.log.debug?.(`surface cleanup deleted ${relativeId}`);
    }
    catch (e) {
        bump(stats, `delete_failed:${kind}`);
        host.log.warn(`surface cleanup skip ${relativeId}: ${e}`);
    }
}
async function cleanupUnconfiguredAcUnits(host, stats) {
    const keepCmds = new Set((0, configured_1.acMappingCommandsForConfiguredUnits)(host.config));
    for (let i = 1; i <= constants_1.AC_UNIT_COUNT; i++) {
        if (!(0, configured_1.isAcUnitConfigured)(host.config, i)) {
            const unitBase = (0, ensure_states_1.acUnitRuntimeBase)(i);
            await safeDeleteRelative(host, unitBase, stats, "ac_unit");
            for (const role of constants_1.AC_MAPPING_ROLES) {
                const cmd = (0, constants_1.acUnitMappingCommand)(i, role);
                const base = (0, tree_paths_1.mappingBase)(constants_1.AC_ADDON_ID, cmd);
                for (const suffix of allowlist_1.AC_MAPPING_LEAF_SUFFIXES) {
                    await safeDeleteRelative(host, `${base}.${suffix}`, stats, "ac_mapping_leaf");
                }
                await safeDeleteRelative(host, base, stats, "ac_mapping");
            }
            continue;
        }
        stats.checked += 1;
        bump(stats, "ac_configured_kept");
        for (const role of constants_1.AC_MAPPING_ROLES) {
            const cmd = (0, constants_1.acUnitMappingCommand)(i, role);
            if (keepCmds.has(cmd)) {
                continue;
            }
            const base = (0, tree_paths_1.mappingBase)(constants_1.AC_ADDON_ID, cmd);
            for (const suffix of allowlist_1.AC_MAPPING_LEAF_SUFFIXES) {
                await safeDeleteRelative(host, `${base}.${suffix}`, stats, "ac_mapping_unused_role");
            }
            await safeDeleteRelative(host, base, stats, "ac_mapping_unused_role");
        }
    }
}
/**
 * v0.1.227+: fat `addons.wallbox.vehicles.<id>` trees are obsolete.
 * Always purge vehicle folders (mini-map `wb_vehicle_map` creates no state trees).
 */
async function cleanupOrphanVehicles(host, stats) {
    void host.config;
    const ids = host.listRelativeObjectIds ? await host.listRelativeObjectIds() : [];
    const vehicleFolderRe = new RegExp(`^${ensure_states_2.WALLBOX_VEHICLES_BASE.replace(/\./g, "\\.")}\\.([^./]+)$`);
    const seen = new Set();
    for (const id of ids) {
        const m = vehicleFolderRe.exec(id);
        if (!m)
            continue;
        const vehicleId = m[1];
        if (seen.has(vehicleId))
            continue;
        seen.add(vehicleId);
        await safeDeleteRelative(host, (0, ensure_states_2.vehicleBasePath)(vehicleId), stats, "vehicle_fat_profile_purge");
    }
}
async function cleanupLeanPlannerSurface(host, stats) {
    for (const root of allowlist_1.LEAN_PLANNER_PURGE_ROOTS) {
        await safeDeleteRelative(host, root, stats, "lean_planner");
    }
    // Roadmap Block 5: Legacy Realtime-Intent-Bäume + surplus/deficit immer entfernen
    // (ersetzt durch Operator Daily Plan / operator.diagnostics.*).
    await safeDeleteRelative(host, "planner.intent.thermal", stats, "planner_thermal_legacy");
    await safeDeleteRelative(host, "planner.intent.cooling", stats, "planner_cooling_legacy");
    await safeDeleteRelative(host, "planner.intent.battery.winter", stats, "planner_winter_legacy");
    await safeDeleteRelative(host, "planner.surplus_w", stats, "planner_surplus_legacy");
    await safeDeleteRelative(host, "planner.deficit_w", stats, "planner_deficit_legacy");
}
const STUB_ADDON_IDS = [
    "sensorics",
    "inverter_1",
    "inverter_2",
    "inverter_3",
    "pv_plant",
    "house_main_fuse",
    "heating",
    "heat_pump",
    "consumer_1",
    "weather_live",
    "weather_forecast",
    "pv_forecast",
    "series_storage",
    "fixed_tariff",
];
const BATTERY_RUNTIME_DIAG_IDS = [
    "learning.battery_runtime.power_history_raw_rows",
    "learning.battery_runtime.power_history_normalized_rows",
    "learning.battery_runtime.power_raw_charge_samples",
    "learning.battery_runtime.power_raw_discharge_samples",
    "learning.battery_runtime.power_hourly_charge_points",
    "learning.battery_runtime.power_hourly_discharge_points",
    "learning.battery_runtime.power_invert_applied",
    "learning.battery_runtime.power_invert_auto",
];
async function cleanupLearningMirrorsAndDiag(host, stats) {
    for (const id of (0, persistence_mirror_1.learningPersistenceMirrorRelativeIds)()) {
        await safeDeleteRelative(host, id, stats, "learning_mirror");
    }
    for (const id of BATTERY_RUNTIME_DIAG_IDS) {
        await safeDeleteRelative(host, id, stats, "battery_runtime_diag");
    }
    /** Basis-States ohne Channel-Root (enabled/available/mode). */
    const stubLeaves = ["enabled", "available", "mode"];
    for (const addonId of STUB_ADDON_IDS) {
        await safeDeleteRelative(host, `addons.${addonId}`, stats, "stub_addon");
        for (const leaf of stubLeaves) {
            await safeDeleteRelative(host, `addons.${addonId}.${leaf}`, stats, "stub_addon_leaf");
        }
    }
}
/** Orphan allowed_values leaves — no longer ensured; only recreated when native has values. */
async function cleanupOrphanAllowedValues(host, stats) {
    const ids = host.listRelativeObjectIds ? await host.listRelativeObjectIds() : [];
    const candidates = ids.length > 0
        ? ids.filter((id) => id.endsWith(".allowed_values") && id.includes(".mapping."))
        : [];
    for (const id of candidates) {
        await safeDeleteRelative(host, id, stats, "allowed_values_orphan");
    }
    // Known AC mapping allowed_values even without full enumeration
    for (let i = 1; i <= constants_1.AC_UNIT_COUNT; i++) {
        for (const role of constants_1.AC_MAPPING_ROLES) {
            const base = (0, tree_paths_1.mappingBase)(constants_1.AC_ADDON_ID, (0, constants_1.acUnitMappingCommand)(i, role));
            await safeDeleteRelative(host, `${base}.allowed_values`, stats, "allowed_values_orphan");
        }
    }
}
/**
 * Idempotent controlled cleanup. Safe to re-run after interrupt.
 * Never deletes outside allowlist / protected prefixes.
 */
async function runDynamicSurfaceCleanup(host) {
    const stats = {
        checked: 0,
        deleted: 0,
        skipped: 0,
        skippedReasons: {},
    };
    await cleanupUnconfiguredAcUnits(host, stats);
    await cleanupOrphanVehicles(host, stats);
    await cleanupLeanPlannerSurface(host, stats);
    await cleanupLearningMirrorsAndDiag(host, stats);
    await cleanupOrphanAllowedValues(host, stats);
    await cleanupLegacyInfoBackup(host, stats);
    await cleanupWallboxRuntimeBallast(host, stats);
    await cleanupUserIntentBallast(host, stats);
    await cleanupAllowlistedFromEnumeration(host, stats);
    host.log.info(`surface cleanup: checked=${stats.checked} deleted=${stats.deleted} skipped=${stats.skipped}`);
    return stats;
}
exports.runDynamicSurfaceCleanup = runDynamicSurfaceCleanup;
const MAPPING_ROOTS = [
    "addons.battery.mapping",
    "addons.wallbox.mapping",
    "addons.immersion_heater.mapping",
    "addons.air_conditioning.mapping",
    "addons.dynamic_tariff.mapping",
];
const SURFACE_CUT_KNOWN_IDS = [
    "planner.intent.last_json",
    "planner.intent.last_reason_de",
    "planner.intent.forecast_plan.plan_json",
    "planner.intent.forecast_plan.days_json",
    "planner.intent.forecast_plan.slots_json",
    "planner.intent.forecast_plan.contributions_json",
    "planner.intent.daily_plan.slots_json",
    "planner.intent.daily_plan.allocations_json",
    "planner.intent.contributions.flexible.contributions_json",
    "planner.intent.contributions.battery",
    "planner.intent.contributions.wallbox",
    "learning.thermal_boiler.history_json",
    "learning.thermal_runtime.history_json",
    "learning.house_load.profile_json",
    "learning.house_load.health_json",
    "addons.wallbox.status.charging_mode",
    "addons.wallbox.status.charging_mode_label",
    "addons.wallbox.status.vehicle_soc_pct",
    "addons.wallbox.status.evcc.snapshot_json",
];
async function cleanupAllowlistedFromEnumeration(host, stats) {
    for (const root of MAPPING_ROOTS) {
        await safeDeleteRelative(host, root, stats, "mapping_tree");
    }
    for (const id of SURFACE_CUT_KNOWN_IDS) {
        await safeDeleteRelative(host, id, stats, "surface_cut_known");
    }
    for (const id of ensure_states_3.BATTERY_BALLAST_STATE_IDS) {
        await safeDeleteRelative(host, id, stats, "battery_ballast");
    }
    const ids = host.listRelativeObjectIds ? await host.listRelativeObjectIds() : [];
    const sorted = [...ids].sort((a, b) => a.split(".").length - b.split(".").length);
    for (const id of sorted) {
        if (/^addons\.air_conditioning\.units\.unit_[1-5](\.|$)/.test(id))
            continue;
        if (!(0, allowlist_1.isAllowlistedCleanupRelativeId)(id))
            continue;
        await safeDeleteRelative(host, id, stats, "enumerated_surface_cut");
    }
}
async function cleanupWallboxRuntimeBallast(host, stats) {
    for (const suffix of states_1.WALLBOX_RUNTIME_BALLAST_SUFFIXES) {
        await safeDeleteRelative(host, `${states_1.WALLBOX_RUNTIME_BASE}.${suffix}`, stats, "wallbox_runtime_ballast");
    }
}
async function cleanupUserIntentBallast(host, stats) {
    const roots = [
        "user_intent.resolved_all_json",
        "user_intent.wallbox.diagnostics",
        "user_intent.wallbox.sources",
        "user_intent.thermal.diagnostics",
        "user_intent.battery.diagnostics",
    ];
    for (const root of roots) {
        await safeDeleteRelative(host, root, stats, "user_intent_ballast");
    }
    const leaves = [
        "user_intent.wallbox.diagnostics.last_resolution_json",
        "user_intent.wallbox.diagnostics.last_error",
        "user_intent.thermal.diagnostics.last_error",
        "user_intent.battery.diagnostics.last_error",
        "user_intent.wallbox.sources.evcc.snapshot_json",
        "user_intent.wallbox.sources.evcc.status",
        "user_intent.wallbox.sources.evcc.last_observed",
        "user_intent.wallbox.sources.admin.snapshot_json",
    ];
    for (const id of leaves) {
        await safeDeleteRelative(host, id, stats, "user_intent_ballast_leaf");
    }
}
async function cleanupLegacyInfoBackup(host, stats) {
    await safeDeleteRelative(host, "info.backup", stats, "info_backup_legacy");
    const knownLeaves = [
        "integration",
        "data_folder",
        "runtime_folder",
        "format_version",
        "persistence_schema_version",
        "persistence_valid",
        "last_validation_at",
        "last_validation_error",
        "restore_detection",
        "checkpoint_generation",
        "journal_status",
        "migration_status",
        "live_rearm_required",
        "confirm_live_rearm",
        "export_register_ready",
        "export_register_hint",
    ];
    for (const leaf of knownLeaves) {
        await safeDeleteRelative(host, `info.backup.${leaf}`, stats, "info_backup_legacy_leaf");
    }
}
