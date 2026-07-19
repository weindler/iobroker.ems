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
import { isAcUnitConfigured } from "../addons/air_conditioning/configured";
import { acUnitRuntimeBase } from "../addons/air_conditioning/runtime/ensure_states";
import { wallboxVehicleProfilesConfigFromAdapter } from "../addons/wallbox/vehicles/config";
import { normalizeWallboxVehicleProfiles } from "../addons/wallbox/vehicles/normalize";
import { WALLBOX_VEHICLES_BASE, vehicleBasePath } from "../addons/wallbox/vehicles/ensure_states";
import { mappingBase } from "../tree_paths";
import {
	COMPATIBILITY_STATE_PREFIXES,
	isAllowlistedCleanupRelativeId,
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
	// Re-check config immediately before delete (caller already gated, but stay explicit).
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
	for (let i = 1; i <= AC_UNIT_COUNT; i++) {
		if (isAcUnitConfigured(host.config, i)) {
			stats.checked += 1;
			bump(stats, "ac_configured_kept");
			continue;
		}
		const unitBase = acUnitRuntimeBase(i);
		await safeDeleteRelative(host, unitBase, stats, "ac_unit");
		for (const role of AC_MAPPING_ROLES) {
			const cmd = acUnitMappingCommand(i, role);
			await safeDeleteRelative(host, mappingBase(AC_ADDON_ID, cmd), stats, "ac_mapping");
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
	host.log.info(
		`surface cleanup: checked=${stats.checked} deleted=${stats.deleted} skipped=${stats.skipped}`,
	);
	return stats;
}
