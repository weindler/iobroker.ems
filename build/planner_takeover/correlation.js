"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDualRunId = exports.correlateDualRuns = exports.resolveEffectiveTakeoverEvaluation = void 0;
/**
 * Takeover evaluation is only effective when native/runtime planner mode is shadow_auto
 * and configured evaluation mode is observe.
 */
function resolveEffectiveTakeoverEvaluation(input) {
    const configuredMode = input.configuredEvaluationMode;
    const observing = input.plannerRuntimeMode === "shadow_auto" && configuredMode === "observe";
    return {
        configuredMode,
        effectiveMode: observing ? "observe" : "disabled",
        configClamped: input.configClamped === true,
        observing,
    };
}
exports.resolveEffectiveTakeoverEvaluation = resolveEffectiveTakeoverEvaluation;
/**
 * Dual-run comparison is only allowed when correlation keys match.
 * Missing correlation → not_comparable (never mismatch).
 */
function correlateDualRuns(input) {
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
    if (a.planningHorizonStart !== c.planningHorizonStart ||
        a.planningHorizonEnd !== c.planningHorizonEnd) {
        return { status: "not_comparable", reason: "horizon_mismatch" };
    }
    if (a.slotDurationMinutes !== c.slotDurationMinutes) {
        return { status: "not_comparable", reason: "slot_duration_mismatch" };
    }
    if (a.plannerContractVersion !== undefined &&
        c.plannerContractVersion !== undefined &&
        a.plannerContractVersion !== c.plannerContractVersion) {
        return { status: "not_comparable", reason: "schema_mismatch" };
    }
    if (a.configRevision !== undefined &&
        c.configRevision !== undefined &&
        a.configRevision !== c.configRevision) {
        return { status: "not_comparable", reason: "input_not_comparable" };
    }
    return { status: "comparable" };
}
exports.correlateDualRuns = correlateDualRuns;
function buildDualRunId(identity) {
    return `dual-${identity.generation}-${identity.inputRevision.slice(0, 12)}-${identity.triggerReason}`;
}
exports.buildDualRunId = buildDualRunId;
