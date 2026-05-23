/** Logical command from EMS or manual test (inbox JSON). */
export interface CommandIntent {
	intent_id?: string;
	addon_id: string;
	command: string;
	value?: unknown;
	source?: string;
	reason?: string;
	policy_ref?: Record<string, unknown>;
}

export type AuditResult =
	| "success"
	| "dryrun_only"
	| "blocked"
	| "mapping_missing"
	| "capability_missing"
	| "safety_blocked"
	| "target_missing"
	| "value_not_allowed"
	| "write_failed"
	| "invalid_command";

export interface PipelineOutcome {
	result: AuditResult;
	reason: string;
	checks_passed: string[];
	checks_failed: string[];
}
