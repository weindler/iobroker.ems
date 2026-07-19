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
const config_1 = require("../addons/wallbox/vehicles/config");
const normalize_1 = require("../addons/wallbox/vehicles/normalize");
const ensure_states_2 = require("../addons/wallbox/vehicles/ensure_states");
const config_2 = require("../addons/governance/config");
const battery_winter_config_1 = require("../planner/battery_winter_config");
const persistence_mirror_1 = require("../learning/persistence_mirror");
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
function configuredVehicleIds(config) {
    const vehicleCfg = (0, config_1.wallboxVehicleProfilesConfigFromAdapter)(config);
    const { profiles } = (0, normalize_1.normalizeWallboxVehicleProfiles)(vehicleCfg.profiles, new Date().toISOString());
    return new Set(profiles.map((p) => p.vehicleId));
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
async function cleanupOrphanVehicles(host, stats) {
    const keep = configuredVehicleIds(host.config);
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
        stats.checked += 1;
        if (keep.has(vehicleId)) {
            bump(stats, "vehicle_configured_kept");
            continue;
        }
        await safeDeleteRelative(host, (0, ensure_states_2.vehicleBasePath)(vehicleId), stats, "vehicle_orphan");
    }
}
async function cleanupLeanPlannerSurface(host, stats) {
    for (const root of allowlist_1.LEAN_PLANNER_PURGE_ROOTS) {
        await safeDeleteRelative(host, root, stats, "lean_planner");
    }
    if (!(0, config_2.isAddonEnabled)(host.config, "immersion_heater")) {
        await safeDeleteRelative(host, "planner.intent.thermal", stats, "planner_thermal_off");
    }
    if (!(0, config_2.isAddonEnabled)(host.config, "climate")) {
        await safeDeleteRelative(host, "planner.intent.cooling", stats, "planner_cooling_off");
    }
    if (!(0, battery_winter_config_1.batteryWinterPlanConfigFromAdapter)(host.config).enabled) {
        await safeDeleteRelative(host, "planner.intent.battery.winter", stats, "planner_winter_off");
    }
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
    for (const addonId of STUB_ADDON_IDS) {
        await safeDeleteRelative(host, `addons.${addonId}`, stats, "stub_addon");
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
    host.log.info(`surface cleanup: checked=${stats.checked} deleted=${stats.deleted} skipped=${stats.skipped}`);
    return stats;
}
exports.runDynamicSurfaceCleanup = runDynamicSurfaceCleanup;
