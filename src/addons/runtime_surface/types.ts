/**
 * Unified addon runtime surface (Masterplan §10 / Roadmap Block 7).
 * Canonical fields under `addons.<runtimeId>.runtime.surface.*`.
 * Detailed per-addon `decision_source` leaves stay as decision_detail input — not overwritten.
 */

export type CanonicalDecisionSource =
	| "off"
	| "manual"
	| "policy"
	| "deterministic_planner"
	| "ai"
	| "policy_fallback"
	| "safety";

export const CANONICAL_DECISION_SOURCES: readonly CanonicalDecisionSource[] = [
	"off",
	"manual",
	"policy",
	"deterministic_planner",
	"ai",
	"policy_fallback",
	"safety",
] as const;

/** Daily-plan usability for the addon. */
export type PlannerStatus = "off" | "missing" | "invalid" | "valid" | "unused";

/** Whether an actionable intent / commanded action is present. */
export type IntentStatus = "none" | "idle" | "active" | "blocked" | "hold";

/** Write/execution posture. */
export type ExecutionStatus = "idle" | "dryrun" | "live" | "blocked" | "fault" | "lockout";

export interface AddonRuntimeSurfaceSnapshot {
	decisionSource: CanonicalDecisionSource;
	/** Addon-specific detailed source (existing decision_source enum). */
	decisionDetail: string;
	decisionReason: string;
	lastDecisionAt: string;
	plannerStatus: PlannerStatus;
	intentStatus: IntentStatus;
	executionStatus: ExecutionStatus;
	profileReady: boolean;
	telemetryReady: boolean;
	fault: boolean;
	lockout: boolean;
}

export interface AddonRuntimeSurfaceInput {
	/** Existing detailed decision_source string from the addon. */
	decisionDetail: string;
	decisionReason: string;
	nowIso: string;
	plannerStatus: PlannerStatus;
	intentStatus: IntentStatus;
	executionStatus: ExecutionStatus;
	profileReady: boolean;
	telemetryReady: boolean;
	fault: boolean;
	lockout: boolean;
}
