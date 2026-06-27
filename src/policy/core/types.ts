import type { GlobalMode, GlobalModeProfile } from "../../global_modes/types";

/** Capabilities: true/false/unknown — kein stiller Fallback auf false. */
export type TriState = true | false | "unknown";

export type PolicySource =
	| "default"
	| "admin"
	| "mapping"
	| "learning"
	| "global_mode"
	| "protection";

export type PolicyStrength = "hard" | "soft" | "advisory";

export interface PolicyValue<T> {
	value: T | null;
	source: PolicySource;
	strength: PolicyStrength;
	valid: boolean;
	confidence?: number;
	reason?: string;
	updatedAt?: string;
	sourcePath?: string;
}

export type PolicySection = "capabilities" | "limits" | "preferences" | "protection" | "economics";

export interface PolicyMeta {
	schemaVersion: string;
	engineVersion: string;
	providerId?: string;
	addonType?: string;
	instanceId?: string;
}

export type PolicyIssueSeverity = "info" | "warning" | "error";

export interface PolicyIssue {
	code: string;
	severity: PolicyIssueSeverity;
	path?: string;
	message: string;
}

export interface PolicyValidationResult {
	valid: boolean;
	status: "valid" | "invalid" | "degraded";
	issues: PolicyIssue[];
}

export interface PolicySnapshot {
	meta: PolicyMeta;
	capabilities: Record<string, PolicyValue<TriState | string | number | boolean>>;
	limits: Record<string, PolicyValue<unknown>>;
	preferences: Record<string, PolicyValue<unknown>>;
	protection: Record<string, PolicyValue<unknown>>;
	economics: Record<string, PolicyValue<unknown>>;
	validation: PolicyValidationResult;
	status: "ready" | "invalid" | "degraded" | "not_initialized";
	provenance?: Record<string, PolicySource>;
}

export interface MutualExclusionRule {
	id: string;
	addonA: string;
	addonB: string;
	reason?: string;
}

export interface PolicyProvider<TConfig = unknown, TFacts = unknown> {
	id: string;
	addonType: string;
	instanceId: string;
	schemaVersion: string;
	readConfig(): Promise<TConfig>;
	readFacts(): Promise<TFacts>;
	buildConfiguredPolicy(config: TConfig, facts: TFacts): PolicySnapshot;
	buildEffectivePolicy(
		configuredPolicy: PolicySnapshot,
		facts: TFacts,
		globalMode: GlobalModeProfile,
	): PolicySnapshot;
	validate(policy: PolicySnapshot): PolicyValidationResult;
}

export interface PolicyRevisionPayload {
	schemaVersion: string;
	content: Omit<PolicySnapshot, "validation"> & {
		validation: Pick<PolicyValidationResult, "valid" | "status" | "issues">;
	};
}
