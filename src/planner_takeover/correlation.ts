import type { PlannerRuntimeMode } from "../planner_config";
import type { PlannerTakeoverEvaluationMode } from "../planner_config/evaluation_mode";
import type { PlannerDualRunIdentity } from "./types";

export interface EffectiveTakeoverEvaluation {
	configuredMode: PlannerTakeoverEvaluationMode;
	effectiveMode: PlannerTakeoverEvaluationMode;
	configClamped: boolean;
	/** Evidence collection / readiness evaluation is active. */
	observing: boolean;
}

/**
 * Takeover evaluation is only effective when native/runtime planner mode is shadow_auto
 * and configured evaluation mode is observe.
 */
export function resolveEffectiveTakeoverEvaluation(input: {
	plannerRuntimeMode: PlannerRuntimeMode;
	configuredEvaluationMode: PlannerTakeoverEvaluationMode;
	configClamped?: boolean;
}): EffectiveTakeoverEvaluation {
	const configuredMode = input.configuredEvaluationMode;
	const observing =
		input.plannerRuntimeMode === "shadow_auto" && configuredMode === "observe";
	return {
		configuredMode,
		effectiveMode: observing ? "observe" : "disabled",
		configClamped: input.configClamped === true,
		observing,
	};
}

export interface DualRunCorrelationInput {
	authoritative: PlannerDualRunIdentity;
	candidate: PlannerDualRunIdentity;
}

export type DualRunCorrelationStatus = "comparable" | "not_comparable";

export interface DualRunCorrelationResult {
	status: DualRunCorrelationStatus;
	reason?: string;
}

/**
 * Dual-run comparison is only allowed when correlation keys match.
 * Missing correlation → not_comparable (never mismatch).
 */
export function correlateDualRuns(input: DualRunCorrelationInput): DualRunCorrelationResult {
	const a = input.authoritative;
	const c = input.candidate;
	if (a.generation !== c.generation) {
		return { status: "not_comparable", reason: "generation_mismatch" };
	}
	if (a.inputRevision !== c.inputRevision) {
		return { status: "not_comparable", reason: "input_revision_mismatch" };
	}
	if (a.snapshotSchemaVersion !== c.snapshotSchemaVersion) {
		return { status: "not_comparable", reason: "schema_mismatch" };
	}
	if (
		a.planningHorizonStart !== c.planningHorizonStart ||
		a.planningHorizonEnd !== c.planningHorizonEnd
	) {
		return { status: "not_comparable", reason: "horizon_mismatch" };
	}
	if (a.slotDurationMinutes !== c.slotDurationMinutes) {
		return { status: "not_comparable", reason: "slot_duration_mismatch" };
	}
	if (
		a.plannerContractVersion !== undefined &&
		c.plannerContractVersion !== undefined &&
		a.plannerContractVersion !== c.plannerContractVersion
	) {
		return { status: "not_comparable", reason: "schema_mismatch" };
	}
	if (
		a.configRevision !== undefined &&
		c.configRevision !== undefined &&
		a.configRevision !== c.configRevision
	) {
		return { status: "not_comparable", reason: "input_not_comparable" };
	}
	return { status: "comparable" };
}

export function buildDualRunId(identity: Pick<PlannerDualRunIdentity, "generation" | "inputRevision" | "triggerReason">): string {
	return `dual-${identity.generation}-${identity.inputRevision.slice(0, 12)}-${identity.triggerReason}`;
}
