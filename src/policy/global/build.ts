import type { GlobalModeProfile } from "../../global_modes/types";
import {
	POLICY_ENGINE_VERSION,
	POLICY_SCHEMA_VERSION,
} from "../core/constants";
import { mergePolicySections } from "../core/merge";
import { buildProvenanceMap } from "../core/provenance";
import { unknownTriState, policyValue, unknownValue } from "../core/value";
import { validatePolicySnapshot } from "../core/validate";
import type { PolicySnapshot } from "../core/types";
import type { GlobalPolicyAdminConfig } from "./config";
import type { GlobalPolicyContent } from "./types";

const GLOBAL_LIMIT_KINDS = {
	houseFuseLimitW: "maximum" as const,
	maxGridImportW: "maximum" as const,
};

function baseCapabilities(): GlobalPolicyContent["capabilities"] {
	return {
		flexibleOptimization: unknownTriState("default", "advisory"),
	};
}

export function buildConfiguredGlobalPolicy(admin: GlobalPolicyAdminConfig): PolicySnapshot {
	const limits: GlobalPolicyContent["limits"] = {};
	const preferences: GlobalPolicyContent["preferences"] = {};
	const protection: GlobalPolicyContent["protection"] = {};
	const economics: GlobalPolicyContent["economics"] = {};

	if (admin.houseFuseLimitW !== null && Number.isFinite(admin.houseFuseLimitW)) {
		limits.houseFuseLimitW = policyValue(admin.houseFuseLimitW, "admin", "hard", {
			sourcePath: "global_policy_house_fuse_limit_w",
		});
	} else {
		limits.houseFuseLimitW = unknownValue<number>("default", "advisory");
	}

	if (admin.maxGridImportW !== null && Number.isFinite(admin.maxGridImportW)) {
		limits.maxGridImportW = policyValue(admin.maxGridImportW, "admin", "hard", {
			sourcePath: "global_policy_max_grid_import_w",
		});
	} else {
		limits.maxGridImportW = unknownValue<number>("default", "advisory");
	}

	if (admin.energyPriority && admin.energyPriority.length > 0) {
		preferences.energyPriority = policyValue(admin.energyPriority, "admin", "soft", {
			sourcePath: "global_policy_energy_priority_json",
		});
	} else {
		preferences.energyPriority = unknownValue<string[]>("default", "advisory");
	}

	if (admin.mutualExclusions && admin.mutualExclusions.length > 0) {
		protection.mutualExclusions = policyValue(admin.mutualExclusions, "admin", "hard", {
			sourcePath: "global_policy_mutual_exclusions_json",
		});
	} else {
		protection.mutualExclusions = unknownValue("default", "advisory");
	}

	if (admin.gridImportAllowed !== null) {
		economics.gridImportAllowed = policyValue(admin.gridImportAllowed, "admin", "hard", {
			sourcePath: "global_policy_grid_import_allowed",
		});
	} else {
		economics.gridImportAllowed = unknownValue<boolean>("default", "advisory");
	}

	const snapshot: PolicySnapshot = {
		meta: {
			schemaVersion: POLICY_SCHEMA_VERSION,
			engineVersion: POLICY_ENGINE_VERSION,
			providerId: "policy.global",
			addonType: "system",
			instanceId: "global",
		},
		capabilities: baseCapabilities(),
		limits,
		preferences,
		protection,
		economics,
		validation: { valid: true, status: "valid", issues: [] },
		status: "ready",
	};

	snapshot.validation = validatePolicySnapshot(snapshot);
	snapshot.provenance = buildProvenanceMap(snapshot);
	return snapshot;
}

function globalModeOverlay(profile: GlobalModeProfile): Partial<PolicySnapshot> {
	const capabilities: PolicySnapshot["capabilities"] = {
		flexibleOptimization: policyValue(
			profile.flexibleOptimization,
			"global_mode",
			"soft",
			{ reason: `Global Mode ${profile.mode}` },
		),
	};

	const preferences: PolicySnapshot["preferences"] = {
		economyWeight: policyValue(profile.economyWeight, "global_mode", "soft"),
		comfortWeight: policyValue(profile.comfortWeight, "global_mode", "soft"),
		shiftTolerance: policyValue(profile.shiftTolerance, "global_mode", "soft"),
		userDemandPriority: policyValue(profile.userDemandPriority, "global_mode", "soft"),
	};

	const economics: PolicySnapshot["economics"] = {};

	const limits: PolicySnapshot["limits"] = {};
	if (profile.gridImportFactor < 1 && profile.gridImportFactor > 0) {
		economics.gridImportRestricted = policyValue(true, "global_mode", "soft", {
			reason: "Global Mode verschärft Netzbezug (Preference).",
		});
	}

	if (profile.mode === "off") {
		capabilities.flexibleOptimization = policyValue(false, "global_mode", "soft", {
			reason: "off: flexible Optimierung deaktiviert (keine Aktion).",
		});
	}

	return { capabilities, preferences, economics, limits };
}

export function buildEffectiveGlobalPolicy(
	configured: PolicySnapshot,
	profile: GlobalModeProfile,
): PolicySnapshot {
	const overlay = globalModeOverlay(profile);

	const merged: PolicySnapshot = {
		...configured,
		capabilities: mergePolicySections(
			configured.capabilities as Record<string, import("../core/types").PolicyValue<unknown>>,
			(overlay.capabilities ?? {}) as Record<string, import("../core/types").PolicyValue<unknown>>,
			"capabilities",
			{ flexibleOptimization: "soft" },
		) as PolicySnapshot["capabilities"],
		limits: mergePolicySections(
			configured.limits,
			overlay.limits ?? {},
			"limits",
			GLOBAL_LIMIT_KINDS,
		),
		preferences: mergePolicySections(
			configured.preferences,
			overlay.preferences ?? {},
			"preferences",
			{
				economyWeight: "preference",
				comfortWeight: "preference",
				shiftTolerance: "preference",
				userDemandPriority: "preference",
				energyPriority: "preference",
			},
		),
		protection: { ...configured.protection },
		economics: mergePolicySections(
			configured.economics,
			overlay.economics ?? {},
			"economics",
			{ gridImportAllowed: "hard_boolean", gridImportRestricted: "soft" },
		),
	};

	merged.validation = validatePolicySnapshot(merged);
	merged.status = merged.validation.valid ? "ready" : "invalid";
	merged.provenance = buildProvenanceMap(merged);
	return merged;
}

export function buildNeutralGlobalPolicy(): PolicySnapshot {
	return buildConfiguredGlobalPolicy({
		houseFuseLimitW: null,
		maxGridImportW: null,
		energyPriority: null,
		mutualExclusions: null,
		gridImportAllowed: null,
	});
}
