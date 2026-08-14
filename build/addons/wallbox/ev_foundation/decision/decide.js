"use strict";
/**
 * Phase 3: external-authority vs EMS-takeover decision (diagnostic only).
 * Never writes EVCC / Tibber / Sonnen / Ford / go-e. Never calls button triggers.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateEvTakeoverDecision = exports.applyEvTakeoverDiagnosis = void 0;
const authority_1 = require("./authority");
const energy_1 = require("./energy");
const latest_start_1 = require("./latest_start");
const plan_coverage_1 = require("./plan_coverage");
const price_windows_1 = require("./price_windows");
function realRequirementEnergyKwh(energyToDepartureMinimumKWh) {
    return energyToDepartureMinimumKWh;
}
function recommendedEvStateFor(outcome, authority, prepared, severity) {
    if (severity === "required" || severity === "recommended")
        return "ems_takeover";
    if (outcome === "external" &&
        (authority === "active" ||
            authority === "planned" ||
            authority === "active_without_plan" ||
            authority === "inactive")) {
        return "external";
    }
    return prepared;
}
function applyEvTakeoverDiagnosis(model, decision) {
    return {
        ...model,
        emsTakeoverActive: false,
        preparedEvState: model.preparedEvState,
        recommendedEvState: decision.recommendedEvState,
        externalAuthorityState: decision.externalAuthorityState,
        takeoverSeverity: decision.takeoverSeverity,
        takeoverRecommended: decision.takeoverRecommended,
        takeoverRequired: decision.takeoverRequired,
        takeoverReason: decision.takeoverReason,
    };
}
exports.applyEvTakeoverDiagnosis = applyEvTakeoverDiagnosis;
function evaluateEvTakeoverDecision(input) {
    const { model, nowMs } = input;
    const authority = (0, authority_1.resolveExternalAuthorityState)(model);
    const chargePower = (0, energy_1.resolveChargePower)(model);
    const energy = (0, energy_1.computeEnergyNeed)(model, chargePower.chargePowerKw);
    const deadlineIso = (0, latest_start_1.resolveDecisionDeadlineIso)({
        departureAt: model.departureAt,
        vehicleAvailableUntil: model.vehicleAvailableUntil,
        externalDeadlineIso: input.externalDeadlineIso ?? null,
    });
    const deadlineMs = (0, latest_start_1.parseDeadlineMs)(deadlineIso);
    const requirementKWh = realRequirementEnergyKwh(energy.energyToDepartureMinimumKWh);
    const requirementMinutes = (0, energy_1.chargingMinutesForEnergy)(requirementKWh, chargePower.chargePowerKw);
    const latestRequiredStart = model.minimumDepartureSocPct == null
        ? null
        : (0, latest_start_1.computeLatestRequiredStartIso)({
            deadlineMs,
            requiredChargingMinutes: requirementMinutes,
            safetyMarginMin: model.safetyMarginMin,
            energyToRequirementKWh: requirementKWh,
            vehicleSocPct: model.vehicleSocPct,
            batteryCapacityKWh: model.batteryCapacityKWh,
            chargePowerKw: chargePower.chargePowerKw,
        });
    const deadlineRisk = (0, latest_start_1.computeDeadlineRisk)({
        deadlineMs,
        latestRequiredStart,
        nowMs,
        requiredChargingMinutes: requirementMinutes,
        energyToRequirementKWh: requirementKWh,
    });
    const plan = (0, plan_coverage_1.computePlanCoverage)({
        model,
        nowMs,
        deadlineMs,
        fallbackMaxAcKw: chargePower.chargePowerKw,
        energyToTargetKWh: energy.energyToTargetKWh,
        energyToDepartureMinimumKWh: energy.energyToDepartureMinimumKWh,
    });
    const latestMs = (0, latest_start_1.parseDeadlineMs)(latestRequiredStart);
    const prices = (0, price_windows_1.evaluatePriceWindows)({
        nowMs,
        deadlineMs,
        chargePowerKw: chargePower.chargePowerKw,
        energyNeededKWh: requirementKWh,
        latestRequiredStartMs: latestMs,
        windows: input.priceWindows ?? [],
        deadlineRisk,
    });
    const reliablePlanCoversRequirement = model.externalSmartPlanAvailable === true &&
        plan.remainingEnergyEstimated !== true &&
        plan.externalPlanCoversDepartureMinimum === true;
    const missingHardInputs = model.minimumDepartureSocPct != null &&
        deadlineMs != null &&
        (model.vehicleSocPct == null ||
            model.batteryCapacityKWh == null ||
            chargePower.chargePowerKw == null ||
            model.chargingEfficiency == null);
    let outcome;
    let severity = "none";
    let reason = null;
    if (model.vehicleConnected === false) {
        outcome = "not_applicable";
    }
    else if (!(0, authority_1.externalControlExpected)(model)) {
        outcome = "no_external_control";
    }
    else if (authority === "unavailable") {
        reason = "external_unavailable";
        if (deadlineRisk === true) {
            outcome = "ems_takeover_required";
            severity = "required";
            reason = "deadline_risk";
        }
        else {
            outcome = "external";
            severity = "observe";
        }
    }
    else if (missingHardInputs) {
        outcome = "insufficient_data";
        severity = "observe";
    }
    else if (deadlineRisk === true) {
        outcome = "ems_takeover_required";
        severity = "required";
        reason = "deadline_risk";
    }
    else if (model.externalSmartPlanAvailable &&
        plan.externalPlanCoversDepartureMinimum === false &&
        requirementKWh != null &&
        requirementKWh > 0 &&
        deadlineMs != null) {
        outcome = "ems_takeover_required";
        severity = "required";
        reason = "insufficient_external_plan";
    }
    else if (reliablePlanCoversRequirement) {
        outcome = "external";
        severity = "none";
        reason = null;
    }
    else if (prices.economicWindowLossRisk === true) {
        outcome = "ems_takeover_recommended";
        severity = "recommended";
        reason = "economic_window_loss";
    }
    else if ((0, authority_1.externalControlExpected)(model) &&
        !model.externalSmartPlanAvailable &&
        deadlineMs != null &&
        deadlineRisk === false &&
        requirementKWh != null) {
        outcome = "external";
        severity = "observe";
        reason = null;
    }
    else {
        outcome = "external";
        severity = "none";
        reason = null;
    }
    const takeoverRequired = severity === "required";
    const takeoverRecommended = severity === "recommended";
    const recommendedEvState = recommendedEvStateFor(outcome, authority, model.preparedEvState, severity);
    const explain = {
        vehicleSocPct: model.vehicleSocPct,
        targetSocPct: model.targetSocPct,
        minimumDepartureSocPct: model.minimumDepartureSocPct,
        externalSmartChargingMinSocPct: model.externalSmartChargingMinSocPct,
        departureAt: model.departureAt,
        deadlineIso,
        energyToTargetKWh: energy.energyToTargetKWh,
        energyToDepartureMinimumKWh: energy.energyToDepartureMinimumKWh,
        chargePowerKw: chargePower.chargePowerKw,
        chargePowerSource: chargePower.source,
        requiredChargingMinutes: energy.requiredChargingMinutes,
        requirementChargingMinutes: requirementMinutes,
        safetyMarginMin: model.safetyMarginMin,
        latestRequiredStart,
        externalAuthorityState: authority,
        gridRewardsActive: model.gridRewardsActive,
        smartChargingActive: model.smartChargingActive,
        externalSmartPlanAvailable: model.externalSmartPlanAvailable,
        externalPlanRemainingEnergyKWh: plan.externalPlanRemainingEnergyKWh,
        externalPlanRemainingMinutes: plan.externalPlanRemainingMinutes,
        externalPlanCoversTarget: plan.externalPlanCoversTarget,
        externalPlanCoversDepartureMinimum: plan.externalPlanCoversDepartureMinimum,
        remainingFeasibleEnergyKWh: prices.remainingFeasibleEnergyKWh,
        remainingCheapEnergyKWh: prices.remainingCheapEnergyKWh,
        cheapWindowEnergyCapacityKWh: prices.cheapWindowEnergyCapacityKWh,
        deadlineRisk,
        economicWindowLossRisk: prices.economicWindowLossRisk,
        takeoverReason: reason,
        takeoverSeverity: severity,
        outcome,
        dataQuality: model.dataQuality,
        vehicleSocQuality: model.vehicleSocQuality,
        externalSourceQuality: model.externalSourceQuality,
        externalSourceHealthy: model.externalSourceHealthy,
        reliablePlanCoversRequirement,
        vehicleConnected: model.vehicleConnected,
        charging: model.charging,
        preparedEvState: model.preparedEvState,
        recommendedEvState,
        emsTakeoverActive: false,
        phase: "decision_diagnostic_only",
    };
    return {
        outcome,
        externalAuthorityState: authority,
        energyToTargetKWh: energy.energyToTargetKWh,
        energyToDepartureMinimumKWh: energy.energyToDepartureMinimumKWh,
        requiredChargingMinutes: energy.requiredChargingMinutes,
        latestRequiredStart,
        deadlineIso,
        deadlineRisk,
        externalPlanExpectedSocGainPct: plan.externalPlanExpectedSocGainPct,
        externalPlanExpectedFinalSocPct: plan.externalPlanExpectedFinalSocPct,
        externalPlanCoversTarget: plan.externalPlanCoversTarget,
        externalPlanCoversDepartureMinimum: plan.externalPlanCoversDepartureMinimum,
        remainingFeasibleEnergyKWh: prices.remainingFeasibleEnergyKWh,
        remainingCheapEnergyKWh: prices.remainingCheapEnergyKWh,
        cheapWindowEnergyCapacityKWh: prices.cheapWindowEnergyCapacityKWh,
        economicWindowLossRisk: prices.economicWindowLossRisk,
        takeoverRecommended,
        takeoverRequired,
        takeoverSeverity: severity,
        takeoverReason: reason,
        recommendedEvState,
        chargePower,
        explain,
    };
}
exports.evaluateEvTakeoverDecision = evaluateEvTakeoverDecision;
