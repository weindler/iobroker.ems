"use strict";
/**
 * Modus-abhängige Gewichte für score-basierte Unified-Allocation.
 * globalMode → plannerModePolicyFromGlobalMode → Skalierung von Kosten vs. Komfort vs. Deadline.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.optimizeWeightsFromInput = void 0;
const mode_policy_1 = require("../../../planner/mode_policy");
const BASE = {
    costWeight: 1,
    pvOpportunityWeight: 1,
    comfortWeight: 1,
    deadlineWeight: 1,
    thermalDeadlineWeight: 1,
    socTargetWeight: 1,
    reserveProtectWeight: 1,
    flexShiftWeight: 0.6,
    batteryCyclePenalty: 0.15,
    vehicleUrgencyBoost: 1.2,
    minScoreThreshold: 1e-5,
};
const MODE_SCALE = {
    off: {
        costWeight: 2,
        comfortWeight: 0,
        deadlineWeight: 0,
        thermalDeadlineWeight: 0,
        socTargetWeight: 0,
        flexShiftWeight: 0,
    },
    eco: {
        costWeight: 1.45,
        pvOpportunityWeight: 1.25,
        comfortWeight: 0.65,
        deadlineWeight: 0.9,
        thermalDeadlineWeight: 0.85,
        socTargetWeight: 0.85,
        flexShiftWeight: 0.75,
        batteryCyclePenalty: 0.35,
        vehicleUrgencyBoost: 1,
    },
    balanced: {},
    comfort: {
        costWeight: 0.72,
        pvOpportunityWeight: 0.85,
        comfortWeight: 1.45,
        deadlineWeight: 1.15,
        thermalDeadlineWeight: 1.1,
        reserveProtectWeight: 0.9,
        flexShiftWeight: 0.5,
        batteryCyclePenalty: 0.08,
        vehicleUrgencyBoost: 1.25,
    },
    forced: {
        costWeight: 0.45,
        pvOpportunityWeight: 0.7,
        comfortWeight: 1.7,
        deadlineWeight: 1.4,
        thermalDeadlineWeight: 1.25,
        socTargetWeight: 1.15,
        reserveProtectWeight: 0.75,
        flexShiftWeight: 0.35,
        batteryCyclePenalty: 0.05,
        vehicleUrgencyBoost: 1.5,
    },
};
function optimizeWeightsFromInput(input) {
    const policy = (0, mode_policy_1.plannerModePolicyFromGlobalMode)(input.globalMode);
    const scale = MODE_SCALE[policy.mode] ?? MODE_SCALE.balanced;
    return {
        ...BASE,
        ...scale,
        batterySurplusMinFactor: policy.batterySurplusMinFactor,
        supportBatteryOnDeficit: policy.supportBatteryOnDeficit,
        batteryMinSocForDeficitPct: policy.batteryMinSocForDeficitPct,
        chargeTargetSocPct: policy.chargeTargetSocPct,
        allowOptimization: policy.allowOptimization,
        allowThermalAuto: policy.allowThermalAuto,
        allowPvCharge: policy.allowPvCharge,
    };
}
exports.optimizeWeightsFromInput = optimizeWeightsFromInput;
