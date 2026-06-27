import { asNum } from "../../ems_light/state_util";
import { unknownValue, policyValue } from "../core/value";
import { normalizeEnergyPriority, normalizeMutualExclusions } from "../core/normalize";
import type { GlobalPolicyContent } from "./types";

function numFromConfig(config: Record<string, unknown>, key: string): number | null {
	const v = config[key];
	if (v === null || v === undefined || v === "") {
		return null;
	}
	return asNum(v);
}

function parseJsonArray(config: Record<string, unknown>, key: string): unknown {
	const v = config[key];
	if (v === null || v === undefined || v === "") {
		return null;
	}
	if (Array.isArray(v)) {
		return v;
	}
	if (typeof v === "string") {
		try {
			return JSON.parse(v);
		} catch {
			return null;
		}
	}
	return null;
}

export interface GlobalPolicyAdminConfig {
	houseFuseLimitW: number | null;
	maxGridImportW: number | null;
	energyPriority: string[] | null;
	mutualExclusions: ReturnType<typeof normalizeMutualExclusions> | null;
	gridImportAllowed: boolean | null;
}

export function globalPolicyConfigFromAdapter(config: unknown): GlobalPolicyAdminConfig {
	if (!config || typeof config !== "object") {
		return {
			houseFuseLimitW: null,
			maxGridImportW: null,
			energyPriority: null,
			mutualExclusions: null,
			gridImportAllowed: null,
		};
	}
	const c = config as Record<string, unknown>;

	const fuse = numFromConfig(c, "global_policy_house_fuse_limit_w");
	const gridMax = numFromConfig(c, "global_policy_max_grid_import_w");
	const priorityRaw = parseJsonArray(c, "global_policy_energy_priority_json");
	const mutualRaw = parseJsonArray(c, "global_policy_mutual_exclusions_json");

	let gridImportAllowed: boolean | null = null;
	if (typeof c.global_policy_grid_import_allowed === "boolean") {
		gridImportAllowed = c.global_policy_grid_import_allowed;
	}

	return {
		houseFuseLimitW: fuse,
		maxGridImportW: gridMax,
		energyPriority: priorityRaw ? normalizeEnergyPriority(priorityRaw) : null,
		mutualExclusions: mutualRaw ? normalizeMutualExclusions(mutualRaw) : null,
		gridImportAllowed,
	};
}

export function emptyGlobalPolicyAdminConfig(): GlobalPolicyAdminConfig {
	return globalPolicyConfigFromAdapter({});
}
