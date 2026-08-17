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
	_governanceAllowed: boolean,
): Promise<void> {
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.decisionSource, decision.decisionSource);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.reasonDe, decision.reasonDe);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.dailyPlanStatus, decision.dailyPlanStatus);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.dailyPlanRevision, decision.dailyPlanRevision ?? 0);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.allocatedPowerW, decision.allocatedPowerW ?? 0);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.energySource, decision.energySource);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.writeAllowed, false);
}

export async function publishWallboxDispatchStates(
	_host: StateHost,
	_decision: WallboxPlanDecision,
	_dispatch: WallboxDryrunDispatchResult,
): Promise<void> {
	/* Dispatch-Details bleiben intern; öffentliche Runtime schreibt writeAllowed/detail_json. */
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
		WALLBOX_RUNTIME_STATES.executionBlockReason,
		foundation.writeResult?.reason ?? (foundation.phase === "dryrun" ? "execution_gate_closed" : ""),
	);
	await setStateIfChanged(host, WALLBOX_RUNTIME_STATES.writeLiveEligible, plan?.liveEligible ?? false);
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
				controlContractModel: mapping.controlContractModel,
				evccControlContractReady: mapping.evccControlContractReady,
				legacyDirectControlPresent: mapping.legacyDirectControlPresent,
				evccModeControlVariant: mapping.evccModeControlVariant,
				evccModeFeedbackStateId: mapping.evccModeFeedbackStateId,
				evccModeButtonsReady: mapping.evccModeButtonsReady,
				evccModeButtonReady: mapping.evccModeButtonReady,
				activeContractInputs: mapping.activeContractInputs,
				ignoredLegacyConfig: mapping.ignoredLegacyConfig,
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
