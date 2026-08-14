"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishEvFoundationDiagnosis = void 0;
const state_write_1 = require("../../../policy/core/state_write");
const ensure_states_1 = require("./ensure_states");
const types_1 = require("./external/types");
function boolOrNull(v) {
    return v === true || v === false ? v : null;
}
async function publishEvFoundationDiagnosis(host, model, capabilities, observedAt, external, decision) {
    const plan = external?.smartPlan ?? (0, types_1.emptySmartPlanEval)();
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evccReachable, capabilities.evccAvailable);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.vehicleConnected, boolOrNull(model.vehicleConnected));
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.charging, boolOrNull(model.charging));
    await (0, state_write_1.setOptionalNumberIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.chargePowerW, model.chargePowerW);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evccMode, model.evccMode ?? "");
    await (0, state_write_1.setOptionalNumberIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.phasesConfigured, model.phasesConfigured);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.phasesActive, model.phasesActive);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.vehicleSocPct, model.vehicleSocPct);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.vehicleSocQuality, model.vehicleSocQuality);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.capabilitiesJson, JSON.stringify(capabilities));
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.externalControlConfigured, model.externalControlConfigured);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.externalControlActive, boolOrNull(model.externalControlActive));
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.externalControlType, model.externalControlType);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.gridRewardsActive, boolOrNull(model.gridRewardsActive));
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.smartChargingActive, boolOrNull(model.smartChargingActive));
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.externalSourceQuality, model.externalSourceQuality);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.externalSourceUpdatedAt, model.externalSourceUpdatedAt ?? "");
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.externalSmartPlanMappingConfigured, plan.mappingConfigured);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.externalSmartPlanParseable, plan.payloadParseable);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.externalSmartPlanAvailable, plan.validPlanPresent);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.externalSmartPlanSlotCount, plan.slots.length);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.externalSmartPlanNextStart, plan.nextStart ?? "");
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.externalSmartPlanLastEnd, plan.lastEnd ?? "");
    await (0, state_write_1.setOptionalNumberIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.externalPlanRemainingEnergyKwh, plan.remainingEnergyKWh);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.externalPlanRemainingMinutes, plan.remainingMinutes);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.externalPlanDeadlineUsed, plan.deadlineUsed);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.externalSmartPlanJson, JSON.stringify(plan.slots));
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.externalRawDiagnosticsJson, JSON.stringify({
        quality: model.externalSourceQuality,
        parseError: plan.parseError,
        rawPreview: plan.rawPreview,
        ignoredSlotCount: plan.ignoredSlotCount,
        parsedSlotCount: plan.parsedSlotCount,
        remainingEnergyEstimated: plan.remainingEnergyEstimated,
        deadlineIso: plan.deadlineIso,
        vehicleChargePauseDiagnostic: external?.vehicleChargePauseDiagnostic ?? null,
        freshnessSignalConfigured: external?.freshnessSignalConfigured ?? false,
    }));
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.departureMinSocConfigured, model.departureMinSocConfigured);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.externalMinSocPct, model.externalSmartChargingMinSocPct);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.externalMinSocQuality, model.externalSmartChargingMinSocQuality);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.vehicleModelSource, model.vehicleModelSource);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.vehicleModelReady, model.vehicleModelReady);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.controlContractModel, model.controlContractModel);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evccControlContractReady, model.evccControlContractReady);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.legacyDirectControlPresent, model.legacyDirectControlPresent);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evccModeControlVariant, model.evccModeControlVariant);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evccModeFeedbackState, model.evccModeFeedbackState);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evccModeButtonsReady, model.evccModeButtonsReady);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evccModeOffTargetReady, model.evccModeOffTargetReady);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evccModePvTargetReady, model.evccModePvTargetReady);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evccModeMinTargetReady, model.evccModeMinTargetReady);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evccModeNowTargetReady, model.evccModeNowTargetReady);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.preparedEvState, model.preparedEvState);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.takeoverReason, model.takeoverReason ?? "");
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.externalAuthorityState, decision?.externalAuthorityState ?? model.externalAuthorityState);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.energyToTargetKwh, decision?.energyToTargetKWh ?? null);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.energyToDepartureMinimumKwh, decision?.energyToDepartureMinimumKWh ?? null);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.requiredChargingMinutes, decision?.requiredChargingMinutes ?? null);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.latestRequiredStart, decision?.latestRequiredStart ?? "");
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.deadlineRisk, boolOrNull(decision?.deadlineRisk ?? null));
    await (0, state_write_1.setOptionalNumberIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.externalPlanExpectedSocGainPct, decision?.externalPlanExpectedSocGainPct ?? null);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.externalPlanExpectedFinalSocPct, decision?.externalPlanExpectedFinalSocPct ?? null);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.externalPlanCoversTarget, boolOrNull(decision?.externalPlanCoversTarget ?? null));
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.externalPlanCoversDepartureMinimum, boolOrNull(decision?.externalPlanCoversDepartureMinimum ?? null));
    await (0, state_write_1.setOptionalNumberIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.remainingFeasibleEnergyKwh, decision?.remainingFeasibleEnergyKWh ?? null);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.remainingCheapEnergyKwh, decision?.remainingCheapEnergyKWh ?? null);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.economicWindowLossRisk, boolOrNull(decision?.economicWindowLossRisk ?? null));
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.takeoverRecommended, decision?.takeoverRecommended === true);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.takeoverRequired, decision?.takeoverRequired === true);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.takeoverSeverity, decision?.takeoverSeverity ?? model.takeoverSeverity);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.recommendedEvState, decision?.recommendedEvState ?? model.recommendedEvState);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.takeoverDecisionJson, JSON.stringify(decision?.explain ?? { phase: "decision_diagnostic_only", pending: decision == null }));
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.dataQuality, model.dataQuality);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.modelJson, JSON.stringify(model));
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.updatedAt, observedAt);
}
exports.publishEvFoundationDiagnosis = publishEvFoundationDiagnosis;
