import { setStateIfChanged } from "../../../policy/core/state_write";
import type { StateHost } from "../../../ems_light/state_util";
import { WALLBOX_RUNTIME_STATES } from "./states";
import type { WallboxPlanDecision } from "./daily_plan";
import type { WallboxDryrunDispatchResult } from "./dispatch";
import type { WallboxLiveFoundationResult } from "./execute";

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
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.allocatedPowerW, decision.allocatedPowerW ?? "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.allocatedEnergyKwh, decision.allocatedEnergyKwh ?? "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.allocatedPvPowerW, decision.pvPowerW ?? "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.allocatedGridPowerW, decision.gridPowerW ?? "");
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
	await setStateIfChanged(
		host,
		WALLBOX_RUNTIME_STATES.dispatchIntentJson,
		JSON.stringify(dispatch.intent),
	);
	await setStateIfChanged(
		host,
		WALLBOX_RUNTIME_STATES.dispatchTargetJson,
		JSON.stringify(dispatch.target),
	);
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
	await setStateIfChanged(
		host,
		WALLBOX_RUNTIME_STATES.dryrunCommandJson,
		JSON.stringify(dispatch.dryrunCommand),
	);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.runtimeControlAvailable, false);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.writeAllowed, false);
}

export async function publishWallboxLiveFoundationStates(
	host: StateHost,
	foundation: WallboxLiveFoundationResult,
): Promise<void> {
	const candidate = foundation.candidate;
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.liveFoundationPhase, foundation.phase);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.liveWriteReleased, foundation.liveWriteReleased);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.commandCandidatePresent, candidate !== null);
	await setStateIfChanged(
		host,
		WALLBOX_RUNTIME_STATES.commandCandidateJson,
		candidate ? JSON.stringify(candidate) : "",
	);
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
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.executionBlockReason, foundation.writeResult?.reason ?? (foundation.phase === "dryrun" ? "execution_gate_closed" : ""));
	const plan = foundation.writePlan;
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.writePlanPresent, plan !== null);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.writePlanJson, plan ? JSON.stringify(plan) : "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.writeContractReady, plan?.contractReady ?? false);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.feedbackContractReady, plan?.feedbackContractReady ?? false);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.writeOperationCount, plan?.operations.length ?? 0);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.writeContractBlockReason, plan?.blockReason ?? "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.writeControlModel, plan?.controlModel ?? "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.writeEvccPathConfirmed, plan?.evccControlPathConfirmed ?? false);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.writeScenario, plan?.writeScenario ?? "");
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.runtimeControlAvailable, false);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.writeAllowed, false);
}

export { ensureWallboxRuntimeStates } from "./ensure_states";
export { resetWallboxDailyPlanCache, resolveWallboxDailyPlanDecision, telemetryInputFromSnapshot } from "./daily_plan";
export { buildWallboxDispatchIntent } from "./intent";
export { resetWallboxDispatchCache, runWallboxDryrunDispatch } from "./dispatch";
export { buildWallboxCommandCandidate } from "./command";
export { buildWallboxControlMappingSnapshot } from "./control_mapping";
export { buildWallboxWritePlan } from "./write_plan";
export {
	executeWallboxWrite,
	runWallboxLiveFoundation,
	resolveWallboxRuntimePhase,
	WALLBOX_LIVE_WRITE_RELEASED,
} from "./execute";
