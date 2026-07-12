import { stableJsonStringify, isSecretKey } from "../backup/schema";
import { isAllowedConfigKey } from "../backup/collect_config";
import { SELECTED_STATE_DATA_KEYS } from "../backup/collect_persistence";
import { isKnownLearningKey, RESTORE_LEARNING_KEYS } from "./learning_map";
import type { RestoreProjection } from "./types";
import type { AdapterConfigExport } from "../backup/types";
import { EXPORT_LIMITS, assertWithinLimit } from "../backup/limits";

const EXECUTION_MODE_KEYS = [
	"global_execution_mode",
	"wb_addon_mode",
	"bat_addon_mode",
	"ih_addon_mode",
	"ac_addon_mode",
] as const;

function parseJsonBuffer(buf: Buffer, label: string): unknown {
	const text = buf.toString("utf8");
	assertWithinLimit(text.length, EXPORT_LIMITS.MAX_SINGLE_FILE_BYTES, label);
	return JSON.parse(text) as unknown;
}

function stableEqual(a: unknown, b: unknown): boolean {
	return stableJsonStringify(a).trim() === stableJsonStringify(b).trim();
}

/** Baut die restorefähige Native-Projektion aus validierten Backup-Dateien. */
export function buildRestoreProjection(payloadMap: Map<string, Buffer>): RestoreProjection {
	const adapter = parseJsonBuffer(payloadMap.get("config/adapter.json")!, "adapter.json") as AdapterConfigExport;
	const mappings = parseJsonBuffer(payloadMap.get("config/mappings.json")!, "mappings.json") as Record<string, unknown>;
	const vehicleProfiles = parseJsonBuffer(payloadMap.get("config/vehicle_profiles.json")!, "vehicle_profiles.json") as {
		profiles?: unknown[];
	};
	const policies = parseJsonBuffer(payloadMap.get("config/policies.json")!, "policies.json") as Record<string, unknown>;
	const selectedState = parseJsonBuffer(
		payloadMap.get("persistence/selected_state_data.json")!,
		"selected_state_data.json",
	) as Record<string, unknown>;

	const warnings: string[] = [];
	const skippedClasses: string[] = ["transient", "support_only", "excluded"];

	const native: Record<string, unknown> = {};

	for (const [k, v] of Object.entries(adapter.allowed_native ?? {})) {
		if (isAllowedConfigKey(k) && !isSecretKey(k)) {
			native[k] = v;
		}
	}
	for (const [k, v] of Object.entries(mappings)) {
		if (isAllowedConfigKey(k) && !isSecretKey(k)) {
			if (native[k] !== undefined && !stableEqual(native[k], v)) {
				throw new Error(`conflicting projection for ${k}`);
			}
			native[k] = v;
		}
	}
	if (vehicleProfiles.profiles !== undefined) {
		const fromAdapter = native.wb_vehicle_profiles;
		if (fromAdapter !== undefined && !stableEqual(fromAdapter, vehicleProfiles.profiles)) {
			throw new Error("conflicting vehicle profiles");
		}
		native.wb_vehicle_profiles = vehicleProfiles.profiles;
	}
	for (const [k, v] of Object.entries(policies)) {
		if (isAllowedConfigKey(k) && !isSecretKey(k)) {
			if (native[k] !== undefined && !stableEqual(native[k], v)) {
				throw new Error(`conflicting policy field ${k}`);
			}
			native[k] = v;
		}
	}

	for (const key of EXECUTION_MODE_KEYS) {
		native[key] = "dryrun";
	}

	const learning: Record<string, unknown> = {};
	for (const key of Object.keys(selectedState)) {
		if (!SELECTED_STATE_DATA_KEYS.includes(key)) {
			throw new Error(`unknown selected_state_data key: ${key}`);
		}
		if (!isKnownLearningKey(key)) {
			throw new Error(`unknown learning key: ${key}`);
		}
		learning[key] = selectedState[key];
	}

	return {
		native,
		learning,
		configuredModesAtExport: { ...adapter.configured_modes_at_export },
		warnings,
		skippedClasses,
	};
}

export function countChangedConfigFields(current: Record<string, unknown>, projected: Record<string, unknown>): number {
	let n = 0;
	for (const [k, v] of Object.entries(projected)) {
		if (!stableEqual(current[k], v)) n += 1;
	}
	return n;
}

export function exportCurrentNativeProjection(current: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(current)) {
		if (isAllowedConfigKey(k) && !isSecretKey(k)) {
			out[k] = v;
		}
	}
	return out;
}

export function mergeNativeForRestore(
	current: Record<string, unknown>,
	projection: Record<string, unknown>,
): Record<string, unknown> {
	const out: Record<string, unknown> = { ...current };
	const restoreKeys = new Set<string>();
	for (const k of Object.keys(projection)) {
		if (isAllowedConfigKey(k)) restoreKeys.add(k);
	}
	for (const k of restoreKeys) {
		delete out[k];
	}
	for (const [k, v] of Object.entries(projection)) {
		if (isAllowedConfigKey(k) && !isSecretKey(k)) {
			out[k] = v;
		}
	}
	for (const key of EXECUTION_MODE_KEYS) {
		out[key] = "dryrun";
	}
	return out;
}

export { EXECUTION_MODE_KEYS };
