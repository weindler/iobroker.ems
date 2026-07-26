import { setStateIfChanged } from "../../../policy/core/state_write";
import type { StateHost } from "../../../ems_light/state_util";
import { WALLBOX_RUNTIME_STATES } from "./states";
import type { WallboxPlanDecision } from "./daily_plan";
import type { WallboxDryrunDispatchResult } from "./dispatch";
import type { WallboxLiveFoundationResult } from "./execute";
import { countWallboxFeedbackExpectations } from "./feedback";
import type { WallboxOwnershipState } from "./ownership";
import type { WallboxFaultState } from "./fault";

export async function publishWallboxRuntimeStates(
	host: StateHost,
	decision: WallboxPlanDecision,
	governanceAllowed: boolean,
): Promise<void> {
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.decisionSource, decision.decisionSource);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.reasonDe, decision.reasonDe);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.dailyPlanStatus, decision.dailyPlanStatus);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.dailyPlanValid, decision.planValid);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.dailyPlanRevision, decision.dailyPlanRevision ?? 0);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.dailyPlanSlotStart, decision.slotStartIso ?? "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.dailyPlanSlotEnd, decision.slotEndIso ?? "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.connected, decision.connected);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.chargingAllowedByPlan, decision.chargingAllowedByPlan);
	// 0 W = kein Slot-Bedarf (nicht null/"" — VIS-Float sonst „NaN“)
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.allocatedPowerW, decision.allocatedPowerW ?? 0);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.allocatedEnergyKwh, decision.allocatedEnergyKwh ?? 0);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.allocatedPvPowerW, decision.pvPowerW ?? 0);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.allocatedGridPowerW, decision.gridPowerW ?? 0);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.energySource, decision.energySource);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.deadlineIso, decision.deadlineIso ?? "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.remainingEnergyKwh, decision.remainingEnergyKwh ?? "");
	await setStateIfChanged(
		host,
		WALLBOX_RUNTIME_STATES.plannedEnergyUntilDeadlineKwh,
		decision.plannedEnergyUntilDeadlineKwh,
	);
	await setStateIfChanged(
		host,
		WALLBOX_RUNTIME_STATES.plannedPvEnergyUntilDeadlineKwh,
		decision.plannedPvEnergyUntilDeadlineKwh,
	);
	await setStateIfChanged(
		host,
		WALLBOX_RUNTIME_STATES.plannedGridEnergyUntilDeadlineKwh,
		decision.plannedGridEnergyUntilDeadlineKwh,
	);
	await setStateIfChanged(
		host,
		WALLBOX_RUNTIME_STATES.plannedCostUntilDeadlineCt,
		decision.plannedCostUntilDeadlineCt ?? "",
	);
	await setStateIfChanged(
		host,
		WALLBOX_RUNTIME_STATES.deadlineReachable,
		decision.deadlineReachable === null
			? "unknown"
			: decision.deadlineReachable
				? "true"
				: "false",
	);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.firstPlannedSlot, decision.firstPlannedSlot ?? "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.lastPlannedSlot, decision.lastPlannedSlot ?? "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.activePlannedSlots, decision.activePlannedSlots);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.maxPlannedPowerW, decision.maxPlannedPowerW);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.minChargePowerW, decision.minChargePowerW ?? "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.maxChargePowerW, decision.maxChargePowerW ?? "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.planExecutionStatus, decision.planExecutionStatus);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.externalPlanActive, decision.externalPlanActive);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.externalPlanTime, decision.externalPlanTime ?? "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.governanceAllowed, governanceAllowed);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.runtimeControlAvailable, false);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.writeAllowed, false);
}

export async function publishWallboxDispatchStates(
	host: StateHost,
	decision: WallboxPlanDecision,
	dispatch: WallboxDryrunDispatchResult,
): Promise<void> {
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.dispatchStatus, dispatch.dispatchStatus);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.dispatchReasonDe, dispatch.dispatchReasonDe);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.dispatchAction, dispatch.intent.action);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.targetEnabled, dispatch.target.enableCharging);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.targetPowerW, dispatch.target.targetPowerW ?? 0);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.targetCurrentA, dispatch.target.targetCurrentA ?? "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.targetPhases, dispatch.target.phases ?? "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.targetEvccMode, dispatch.target.desiredEvccMode ?? "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.dispatchSource, decision.decisionSource);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.dispatchValidUntil, dispatch.intent.validUntil ?? "");
	await setStateIfChanged(
		host,
		WALLBOX_RUNTIME_STATES.dispatchDailyPlanRevision,
		dispatch.intent.dailyPlanRevision ?? 0,
	);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.deadlineStatus, dispatch.deadlineStatus);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.deadlineRisk, dispatch.deadlineStatus === "at_risk");
	await setStateIfChanged(
		host,
		WALLBOX_RUNTIME_STATES.controlMappingComplete,
		dispatch.readiness.controlMappingComplete,
	);
	await setStateIfChanged(
		host,
		WALLBOX_RUNTIME_STATES.controlMappingMissingJson,
		JSON.stringify(dispatch.readiness.missingMappings),
	);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.runtimeControlAvailable, false);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.writeAllowed, false);
}

export async function publishWallboxLiveFoundationStates(
	host: StateHost,
	foundation: WallboxLiveFoundationResult,
): Promise<void> {
	const candidate = foundation.candidate;
	const plan = foundation.writePlan;
	const mapping = foundation.mappingSnapshot;
	const fb = foundation.feedbackContract;
	const fbCounts = fb ? countWallboxFeedbackExpectations(fb.expectations) : null;

	await setStateIfChanged(
		host,
		WALLBOX_RUNTIME_STATES.executionAttempted,
		foundation.writeResult?.attempted ?? false,
	);
	await setStateIfChanged(
		host,
		WALLBOX_RUNTIME_STATES.executionExecuted,
		foundation.writeResult?.executed ?? false,
	);
	await setStateIfChanged(
		host,
		WALLBOX_RUNTIME_STATES.executionBlockReason,
		foundation.writeResult?.reason ?? (foundation.phase === "dryrun" ? "execution_gate_closed" : ""),
	);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.writeContractBlockReason, plan?.blockReason ?? "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.writeLiveEligible, plan?.liveEligible ?? false);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.feedbackStatus, fb?.status ?? "not_required");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.feedbackBlockReason, fb?.blockReason ?? "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.runtimeControlAvailable, plan?.liveEligible ?? false);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.writeAllowed, foundation.writeAllowed);

	const detail = {
		phase: foundation.phase,
		liveWriteReleased: foundation.liveWriteReleased,
		commandCandidate: candidate,
		writeResult: foundation.writeResult,
		writePlan: plan,
		mapping: {
			controlModel: mapping.controlModel,
			legacyMappingsPresent: mapping.legacyMappingsPresent,
			evccMappingsPresent: mapping.evccMappingsPresent,
			missingRoles: mapping.missingRoles,
			validationIssues: mapping.validationIssues,
		},
		feedback: fb
			? {
					required: fb.required,
					ready: fb.ready,
					status: fb.status,
					blockReason: fb.blockReason,
					issueKind: fb.issueKind,
					expectationCount: fb.expectations.length,
					counts: fbCounts,
					settleTimeMs: fb.settleTimeMs,
					timeoutMs: fb.timeoutMs,
				}
			: null,
	};
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.detailJson, JSON.stringify(detail));
}

export async function publishWallboxSafetyStates(
	host: StateHost,
	ownership: WallboxOwnershipState,
	fault: WallboxFaultState,
): Promise<void> {
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.ownershipActive, ownership.active);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.faultActive, fault.active);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.faultCode, fault.code ?? "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.faultMessage, fault.message ?? "");
}

export { ensureWallboxRuntimeStates } from "./ensure_states";
export { resetWallboxDailyPlanCache, resolveWallboxDailyPlanDecision, telemetryInputFromSnapshot } from "./daily_plan";
export { buildWallboxDispatchIntent } from "./intent";
export { resetWallboxDispatchCache, runWallboxDryrunDispatch } from "./dispatch";
export { buildWallboxCommandCandidate } from "./command";
export { buildWallboxControlMappingSnapshot, collectConfiguredControlTargetStateIds } from "./control_mapping";
export { resolveWallboxControlObjectMetas, metaFromObject } from "./control_object_meta";
export {
	resolveWallboxControlModel,
	hasEvccControlWriteMapping,
	WB_CONTROL_MODEL,
} from "../evcc_control_config";
export { buildWallboxWritePlan } from "./write_plan";
export {
	buildWallboxFeedbackContract,
	evaluateWallboxFeedback,
	normalizeWallboxFeedbackValue,
	countWallboxFeedbackExpectations,
} from "./feedback";
export { wallboxFeedbackConfigFromAdapter } from "./feedback_config";
export {
	executeWallboxWrite,
	runWallboxLiveFoundation,
	resolveWallboxRuntimePhase,
	WALLBOX_LIVE_WRITE_RELEASED,
} from "./execute";
export {
	emptyWallboxOwnership,
	grantWallboxOwnership,
	canSafeRestoreWallbox,
	type WallboxOwnershipState,
} from "./ownership";
export {
	emptyWallboxFault,
	raiseWallboxFault,
	clearWallboxFault,
	faultCodeForFeedbackStatus,
	type WallboxFaultState,
	type WallboxFaultCode,
} from "./fault";
export { planWallboxSafeRestore, type WallboxRestorePlan } from "./restore";
export { tickWallboxFeedback, isWallboxFeedbackStatusTerminal } from "./feedback_tick";
