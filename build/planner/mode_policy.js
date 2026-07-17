"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plannerModePolicyFromGlobalMode = exports.PLANNER_BATTERY_TARGET_SOC_PCT = void 0;
const constants_1 = require("../global_modes/constants");
const config_1 = require("../global_modes/config");
/** Default charge target used by balanced/comfort mode policies. */
exports.PLANNER_BATTERY_TARGET_SOC_PCT = 95;
const MODE_POLICIES = {
    off: {
        mode: "off",
        allowOptimization: false,
        allowThermalAuto: false,
        allowPvCharge: false,
        supportBatteryOnDeficit: false,
        batteryMinSocForDeficitPct: 100,
        chargeTargetSocPct: exports.PLANNER_BATTERY_TARGET_SOC_PCT,
        batterySurplusMinFactor: 1,
        labelDe: "Off — keine Planner-Optimierung",
    },
    eco: {
        mode: "eco",
        allowOptimization: true,
        allowThermalAuto: true,
        allowPvCharge: true,
        supportBatteryOnDeficit: false,
        batteryMinSocForDeficitPct: 100,
        chargeTargetSocPct: 90,
        batterySurplusMinFactor: 1.15,
        labelDe: "Eco — nur PV-Überschuss, sparsames Laden",
    },
    balanced: {
        mode: "balanced",
        allowOptimization: true,
        allowThermalAuto: true,
        allowPvCharge: true,
        supportBatteryOnDeficit: false,
        batteryMinSocForDeficitPct: 100,
        chargeTargetSocPct: exports.PLANNER_BATTERY_TARGET_SOC_PCT,
        batterySurplusMinFactor: 1,
        labelDe: "Balanced — Überschuss Heizstab, dann Batterie",
    },
    comfort: {
        mode: "comfort",
        allowOptimization: true,
        allowThermalAuto: true,
        allowPvCharge: true,
        supportBatteryOnDeficit: true,
        batteryMinSocForDeficitPct: 15,
        chargeTargetSocPct: exports.PLANNER_BATTERY_TARGET_SOC_PCT,
        batterySurplusMinFactor: 1,
        labelDe: "Comfort — Batterie bei Wolken mitnutzen",
    },
    forced: {
        mode: "forced",
        allowOptimization: true,
        allowThermalAuto: true,
        allowPvCharge: true,
        supportBatteryOnDeficit: true,
        batteryMinSocForDeficitPct: 10,
        chargeTargetSocPct: 98,
        batterySurplusMinFactor: 1,
        labelDe: "Forced — maximale Eigenverbrauchs-Nutzung",
    },
};
function plannerModePolicyFromGlobalMode(raw) {
    const s = String(raw ?? "").trim().toLowerCase();
    if ((0, config_1.isGlobalMode)(s)) {
        return MODE_POLICIES[s];
    }
    return MODE_POLICIES[constants_1.DEFAULT_GLOBAL_MODE];
}
exports.plannerModePolicyFromGlobalMode = plannerModePolicyFromGlobalMode;
