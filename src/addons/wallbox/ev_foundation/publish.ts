import type { StateHost } from "../../../ems_light/state_util";
import { setOptionalNumberIfChanged, setStateIfChanged } from "../../../policy/core/state_write";
import type { EvCapabilities, EvModelV1 } from "./types";
import { WALLBOX_EV_FOUNDATION_STATES } from "./ensure_states";
import { emptySmartPlanEval, type ExternalEvInformation } from "./external/types";
import type { EvTakeoverDecision } from "./decision/types";

function boolOrNull(v: boolean | null): boolean | null {
	return v === true || v === false ? v : null;
}

export async function publishEvFoundationDiagnosis(
	host: StateHost,
	model: EvModelV1,
	capabilities: EvCapabilities,
	observedAt: string,
	external?: ExternalEvInformation | null,
	decision?: EvTakeoverDecision | null,
): Promise<void> {
	const plan = external?.smartPlan ?? emptySmartPlanEval();
	await setStateIfChanged(host, WALLBOX_EV_FOUNDATION_STATES.evccReachable, capabilities.evccAvailable);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.vehicleConnected,
		boolOrNull(model.vehicleConnected) as ioBroker.StateValue,
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.charging,
		boolOrNull(model.charging) as ioBroker.StateValue,
	);
	await setOptionalNumberIfChanged(host, WALLBOX_EV_FOUNDATION_STATES.chargePowerW, model.chargePowerW);
	await setStateIfChanged(host, WALLBOX_EV_FOUNDATION_STATES.evccMode, model.evccMode ?? "");
	await setOptionalNumberIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.phasesConfigured,
		model.phasesConfigured,
	);
	await setOptionalNumberIfChanged(host, WALLBOX_EV_FOUNDATION_STATES.phasesActive, model.phasesActive);
	await setOptionalNumberIfChanged(host, WALLBOX_EV_FOUNDATION_STATES.vehicleSocPct, model.vehicleSocPct);
	await setStateIfChanged(host, WALLBOX_EV_FOUNDATION_STATES.vehicleSocQuality, model.vehicleSocQuality);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.capabilitiesJson,
		JSON.stringify(capabilities),
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.externalControlConfigured,
		model.externalControlConfigured,
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.externalControlActive,
		boolOrNull(model.externalControlActive) as ioBroker.StateValue,
	);
	await setStateIfChanged(host, WALLBOX_EV_FOUNDATION_STATES.externalControlType, model.externalControlType);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.gridRewardsActive,
		boolOrNull(model.gridRewardsActive) as ioBroker.StateValue,
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.smartChargingActive,
		boolOrNull(model.smartChargingActive) as ioBroker.StateValue,
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.externalSourceQuality,
		model.externalSourceQuality,
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.externalSourceUpdatedAt,
		model.externalSourceUpdatedAt ?? "",
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.externalSmartPlanMappingConfigured,
		plan.mappingConfigured,
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.externalSmartPlanParseable,
		plan.payloadParseable,
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.externalSmartPlanAvailable,
		plan.validPlanPresent,
	);
	await setStateIfChanged(host, WALLBOX_EV_FOUNDATION_STATES.externalSmartPlanSlotCount, plan.slots.length);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.externalSmartPlanNextStart,
		plan.nextStart ?? "",
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.externalSmartPlanLastEnd,
		plan.lastEnd ?? "",
	);
	await setOptionalNumberIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.externalPlanRemainingEnergyKwh,
		plan.remainingEnergyKWh,
	);
	await setOptionalNumberIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.externalPlanRemainingMinutes,
		plan.remainingMinutes,
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.externalPlanDeadlineUsed,
		plan.deadlineUsed,
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.externalSmartPlanJson,
		JSON.stringify(plan.slots),
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.externalRawDiagnosticsJson,
		JSON.stringify({
			quality: model.externalSourceQuality,
			parseError: plan.parseError,
			rawPreview: plan.rawPreview,
			ignoredSlotCount: plan.ignoredSlotCount,
			parsedSlotCount: plan.parsedSlotCount,
			remainingEnergyEstimated: plan.remainingEnergyEstimated,
			deadlineIso: plan.deadlineIso,
			vehicleChargePauseDiagnostic: external?.vehicleChargePauseDiagnostic ?? null,
			freshnessSignalConfigured: external?.freshnessSignalConfigured ?? false,
		}),
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.departureMinSocConfigured,
		model.departureMinSocConfigured,
	);
	await setOptionalNumberIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.externalMinSocPct,
		model.externalSmartChargingMinSocPct,
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.externalMinSocQuality,
		model.externalSmartChargingMinSocQuality,
	);
	await setStateIfChanged(host, WALLBOX_EV_FOUNDATION_STATES.vehicleModelSource, model.vehicleModelSource);
	await setStateIfChanged(host, WALLBOX_EV_FOUNDATION_STATES.vehicleModelReady, model.vehicleModelReady);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.controlContractModel,
		model.controlContractModel,
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.evccControlContractReady,
		model.evccControlContractReady,
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.legacyDirectControlPresent,
		model.legacyDirectControlPresent,
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.evccModeControlVariant,
		model.evccModeControlVariant,
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.evccModeFeedbackState,
		model.evccModeFeedbackState,
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.evccModeButtonsReady,
		model.evccModeButtonsReady,
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.evccModeOffTargetReady,
		model.evccModeOffTargetReady,
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.evccModePvTargetReady,
		model.evccModePvTargetReady,
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.evccModeMinTargetReady,
		model.evccModeMinTargetReady,
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.evccModeNowTargetReady,
		model.evccModeNowTargetReady,
	);
	await setStateIfChanged(host, WALLBOX_EV_FOUNDATION_STATES.preparedEvState, model.preparedEvState);
	await setStateIfChanged(host, WALLBOX_EV_FOUNDATION_STATES.takeoverReason, model.takeoverReason ?? "");
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.externalAuthorityState,
		decision?.externalAuthorityState ?? model.externalAuthorityState,
	);
	await setOptionalNumberIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.energyToTargetKwh,
		decision?.energyToTargetKWh ?? null,
	);
	await setOptionalNumberIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.energyToDepartureMinimumKwh,
		decision?.energyToDepartureMinimumKWh ?? null,
	);
	await setOptionalNumberIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.requiredChargingMinutes,
		decision?.requiredChargingMinutes ?? null,
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.latestRequiredStart,
		decision?.latestRequiredStart ?? "",
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.deadlineRisk,
		boolOrNull(decision?.deadlineRisk ?? null) as ioBroker.StateValue,
	);
	await setOptionalNumberIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.externalPlanExpectedSocGainPct,
		decision?.externalPlanExpectedSocGainPct ?? null,
	);
	await setOptionalNumberIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.externalPlanExpectedFinalSocPct,
		decision?.externalPlanExpectedFinalSocPct ?? null,
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.externalPlanCoversTarget,
		boolOrNull(decision?.externalPlanCoversTarget ?? null) as ioBroker.StateValue,
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.externalPlanCoversDepartureMinimum,
		boolOrNull(decision?.externalPlanCoversDepartureMinimum ?? null) as ioBroker.StateValue,
	);
	await setOptionalNumberIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.remainingFeasibleEnergyKwh,
		decision?.remainingFeasibleEnergyKWh ?? null,
	);
	await setOptionalNumberIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.remainingCheapEnergyKwh,
		decision?.remainingCheapEnergyKWh ?? null,
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.economicWindowLossRisk,
		boolOrNull(decision?.economicWindowLossRisk ?? null) as ioBroker.StateValue,
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.takeoverRecommended,
		decision?.takeoverRecommended === true,
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.takeoverRequired,
		decision?.takeoverRequired === true,
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.takeoverSeverity,
		decision?.takeoverSeverity ?? model.takeoverSeverity,
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.recommendedEvState,
		decision?.recommendedEvState ?? model.recommendedEvState,
	);
	await setStateIfChanged(
		host,
		WALLBOX_EV_FOUNDATION_STATES.takeoverDecisionJson,
		JSON.stringify(decision?.explain ?? { phase: "decision_diagnostic_only", pending: decision == null }),
	);
	await setStateIfChanged(host, WALLBOX_EV_FOUNDATION_STATES.dataQuality, model.dataQuality);
	await setStateIfChanged(host, WALLBOX_EV_FOUNDATION_STATES.modelJson, JSON.stringify(model));
	await setStateIfChanged(host, WALLBOX_EV_FOUNDATION_STATES.updatedAt, observedAt);
}
