import type { MutualExclusionRule, PolicyValue } from "../core/types";

export interface GlobalPolicyLimits {
	houseFuseLimitW?: PolicyValue<number>;
	maxGridImportW?: PolicyValue<number>;
}

export interface GlobalPolicyPreferences {
	energyPriority?: PolicyValue<string[]>;
}

export interface GlobalPolicyProtection {
	mutualExclusions?: PolicyValue<MutualExclusionRule[]>;
}

export interface GlobalPolicyEconomics {
	gridImportAllowed?: PolicyValue<boolean>;
}

export interface GlobalPolicyContent {
	capabilities: Record<string, PolicyValue<import("../core/types").TriState | string | number | boolean>>;
	limits: GlobalPolicyLimits & Record<string, PolicyValue<unknown>>;
	preferences: GlobalPolicyPreferences & Record<string, PolicyValue<unknown>>;
	protection: GlobalPolicyProtection & Record<string, PolicyValue<unknown>>;
	economics: GlobalPolicyEconomics & Record<string, PolicyValue<unknown>>;
}
