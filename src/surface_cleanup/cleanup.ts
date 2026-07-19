/**
 * Phase 4B1 — controlled cleanup of unambiguously empty dynamic placeholders.
 * Deletes only allowlisted relative IDs under the adapter namespace.
 */
import {
	AC_MAPPING_ROLES,
	AC_UNIT_COUNT,
	AC_ADDON_ID,
	acUnitMappingCommand,
} from "../addons/air_conditioning/constants";
import {
	acMappingCommandsForConfiguredUnits,
	isAcUnitConfigured,
} from "../addons/air_conditioning/configured";
import { acUnitRuntimeBase } from "../addons/air_conditioning/runtime/ensure_states";
import { wallboxVehicleProfilesConfigFromAdapter } from "../addons/wallbox/vehicles/config";
import { normalizeWallboxVehicleProfiles } from "../addons/wallbox/vehicles/normalize";
import { WALLBOX_VEHICLES_BASE, vehicleBasePath } from "../addons/wallbox/vehicles/ensure_states";
import { isAddonEnabled } from "../addons/governance/config";
import { batteryWinterPlanConfigFromAdapter } from "../planner/battery_winter_config";
import { learningPersistenceMirrorRelativeIds } from "../learning/persistence_mirror";
import { WALLBOX_RUNTIME_BASE, WALLBOX_RUNTIME_BALLAST_SUFFIXES } from "../addons/wallbox/runtime/states";
import { mappingBase } from "../tree_paths";
import {
	COMPATIBILITY_STATE_PREFIXES,
	AC_MAPPING_LEAF_SUFFIXES,
	isAllowlistedCleanupRelativeId,
	isLeanPlannerPurgeRoot,
	LEAN_PLANNER_PURGE_ROOTS,
	PROTECTED_PREFIXES,
} from "./allowlist";

export type SurfaceCleanupHost = {
	namespace: string;
	config: unknown;
	log: {
		info: (msg: string) => void;
		warn: (msg: string) => void;
		debug?: (msg: string) => void;
	};
	getObjectAsync: (id: string) => Promise<ioBroker.Object | null | undefined>;
	delObjectAsync: (id: string, options?: { recursive?: boolean }) => Promise<unknown>;
	/** Optional enumeration of relative object ids known to the host (tests / adapters). */
	listRelativeObjectIds?: () => string[] | Promise<string[]>;
};

export type SurfaceCleanupStats = {
	checked: number;
	deleted: number;
	skipped: number;
	skippedReasons: Record<string, number>;
};

function bump(stats: SurfaceCleanupStats, reason: string): void {
	stats.skipped += 1;
	stats.skippedReasons[reason] = (stats.skippedReasons[reason] ?? 0) + 1;
}

function isProtectedRelativeId(relativeId: string): boolean {
	if (isLeanPlannerPurgeRoot(relativeId)) {
		return false;
	}
	for (const p of PROTECTED_PREFIXES) {
		if (relativeId === p || relativeId.startsWith(`${p}.`) || relativeId.startsWith(p)) {
			return true;
		}
	}
	for (const p of COMPATIBILITY_STATE_PREFIXES) {
		if (relativeId === p || relativeId.startsWith(p)) {
			return true;
		}
	}
	return false;
}

async function safeDeleteRelative(
	host: SurfaceCleanupHost,
	relativeId: string,
	stats: SurfaceCleanupStats,
	kind: string,
): Promise<void> {
	stats.checked += 1;
	if (!isAllowlistedCleanupRelativeId(relativeId)) {
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
	} catch (e) {
		bump(stats, `delete_failed:${kind}`);
		host.log.warn(`surface cleanup skip ${relativeId}: ${e}`);
	}
}

function configuredVehicleIds(config: unknown): Set<string> {
	const vehicleCfg = wallboxVehicleProfilesConfigFromAdapter(config);
	const { profiles } = normalizeWallboxVehicleProfiles(vehicleCfg.profiles, new Date().toISOString());
	return new Set(profiles.map((p) => p.vehicleId));
}

async function cleanupUnconfiguredAcUnits(host: SurfaceCleanupHost, stats: SurfaceCleanupStats): Promise<void> {
	const keepCmds = new Set(acMappingCommandsForConfiguredUnits(host.config));
	for (let i = 1; i <= AC_UNIT_COUNT; i++) {
		if (!isAcUnitConfigured(host.config, i)) {
			const unitBase = acUnitRuntimeBase(i);
			await safeDeleteRelative(host, unitBase, stats, "ac_unit");
			for (const role of AC_MAPPING_ROLES) {
				const cmd = acUnitMappingCommand(i, role);
				const base = mappingBase(AC_ADDON_ID, cmd);
				for (const suffix of AC_MAPPING_LEAF_SUFFIXES) {
					await safeDeleteRelative(host, `${base}.${suffix}`, stats, "ac_mapping_leaf");
				}
				await safeDeleteRelative(host, base, stats, "ac_mapping");
			}
			continue;
		}
		stats.checked += 1;
		bump(stats, "ac_configured_kept");
		for (const role of AC_MAPPING_ROLES) {
			const cmd = acUnitMappingCommand(i, role);
			if (keepCmds.has(cmd)) {
				continue;
			}
			const base = mappingBase(AC_ADDON_ID, cmd);
			for (const suffix of AC_MAPPING_LEAF_SUFFIXES) {
				await safeDeleteRelative(host, `${base}.${suffix}`, stats, "ac_mapping_unused_role");
			}
			await safeDeleteRelative(host, base, stats, "ac_mapping_unused_role");
		}
	}
}

async function cleanupOrphanVehicles(host: SurfaceCleanupHost, stats: SurfaceCleanupStats): Promise<void> {
	const keep = configuredVehicleIds(host.config);
	const ids = host.listRelativeObjectIds ? await host.listRelativeObjectIds() : [];
	const vehicleFolderRe = new RegExp(`^${WALLBOX_VEHICLES_BASE.replace(/\./g, "\\.")}\\.([^./]+)$`);
	const seen = new Set<string>();
	for (const id of ids) {
		const m = vehicleFolderRe.exec(id);
		if (!m) continue;
		const vehicleId = m[1];
		if (seen.has(vehicleId)) continue;
		seen.add(vehicleId);
		stats.checked += 1;
		if (keep.has(vehicleId)) {
			bump(stats, "vehicle_configured_kept");
			continue;
		}
		await safeDeleteRelative(host, vehicleBasePath(vehicleId), stats, "vehicle_orphan");
	}
}

async function cleanupLeanPlannerSurface(host: SurfaceCleanupHost, stats: SurfaceCleanupStats): Promise<void> {
	for (const root of LEAN_PLANNER_PURGE_ROOTS) {
		await safeDeleteRelative(host, root, stats, "lean_planner");
	}
	if (!isAddonEnabled(host.config, "immersion_heater")) {
		await safeDeleteRelative(host, "planner.intent.thermal", stats, "planner_thermal_off");
	}
	if (!isAddonEnabled(host.config, "climate")) {
		await safeDeleteRelative(host, "planner.intent.cooling", stats, "planner_cooling_off");
	}
	if (!batteryWinterPlanConfigFromAdapter(host.config).enabled) {
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
] as const;

const BATTERY_RUNTIME_DIAG_IDS = [
	"learning.battery_runtime.power_history_raw_rows",
	"learning.battery_runtime.power_history_normalized_rows",
	"learning.battery_runtime.power_raw_charge_samples",
	"learning.battery_runtime.power_raw_discharge_samples",
	"learning.battery_runtime.power_hourly_charge_points",
	"learning.battery_runtime.power_hourly_discharge_points",
	"learning.battery_runtime.power_invert_applied",
	"learning.battery_runtime.power_invert_auto",
] as const;

async function cleanupLearningMirrorsAndDiag(host: SurfaceCleanupHost, stats: SurfaceCleanupStats): Promise<void> {
	for (const id of learningPersistenceMirrorRelativeIds()) {
		await safeDeleteRelative(host, id, stats, "learning_mirror");
	}
	for (const id of BATTERY_RUNTIME_DIAG_IDS) {
		await safeDeleteRelative(host, id, stats, "battery_runtime_diag");
	}
	/** Basis-States ohne Channel-Root (enabled/available/mode). */
	const stubLeaves = ["enabled", "available", "mode"] as const;
	for (const addonId of STUB_ADDON_IDS) {
		await safeDeleteRelative(host, `addons.${addonId}`, stats, "stub_addon");
		for (const leaf of stubLeaves) {
			await safeDeleteRelative(host, `addons.${addonId}.${leaf}`, stats, "stub_addon_leaf");
		}
	}
}

/** Orphan allowed_values leaves — no longer ensured; only recreated when native has values. */
async function cleanupOrphanAllowedValues(host: SurfaceCleanupHost, stats: SurfaceCleanupStats): Promise<void> {
	const ids = host.listRelativeObjectIds ? await host.listRelativeObjectIds() : [];
	const candidates =
		ids.length > 0
			? ids.filter((id) => id.endsWith(".allowed_values") && id.includes(".mapping."))
			: [];
	for (const id of candidates) {
		await safeDeleteRelative(host, id, stats, "allowed_values_orphan");
	}
	// Known AC mapping allowed_values even without full enumeration
	for (let i = 1; i <= AC_UNIT_COUNT; i++) {
		for (const role of AC_MAPPING_ROLES) {
			const base = mappingBase(AC_ADDON_ID, acUnitMappingCommand(i, role));
			await safeDeleteRelative(host, `${base}.allowed_values`, stats, "allowed_values_orphan");
		}
	}
}

/**
 * Idempotent controlled cleanup. Safe to re-run after interrupt.
 * Never deletes outside allowlist / protected prefixes.
 */
export async function runDynamicSurfaceCleanup(host: SurfaceCleanupHost): Promise<SurfaceCleanupStats> {
	const stats: SurfaceCleanupStats = {
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
	host.log.info(
		`surface cleanup: checked=${stats.checked} deleted=${stats.deleted} skipped=${stats.skipped}`,
	);
	return stats;
}

async function cleanupWallboxRuntimeBallast(host: SurfaceCleanupHost, stats: SurfaceCleanupStats): Promise<void> {
	for (const suffix of WALLBOX_RUNTIME_BALLAST_SUFFIXES) {
		await safeDeleteRelative(host, `${WALLBOX_RUNTIME_BASE}.${suffix}`, stats, "wallbox_runtime_ballast");
	}
}

async function cleanupUserIntentBallast(host: SurfaceCleanupHost, stats: SurfaceCleanupStats): Promise<void> {
	const roots = [
		"user_intent.resolved_all_json",
		"user_intent.wallbox.diagnostics",
		"user_intent.wallbox.sources",
		"user_intent.thermal.diagnostics",
		"user_intent.battery.diagnostics",
	] as const;
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
	] as const;
	for (const id of leaves) {
		await safeDeleteRelative(host, id, stats, "user_intent_ballast_leaf");
	}
}

async function cleanupLegacyInfoBackup(host: SurfaceCleanupHost, stats: SurfaceCleanupStats): Promise<void> {
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
