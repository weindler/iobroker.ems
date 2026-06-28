"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateBatteryIntent = void 0;
const intent_1 = require("./intent");
const capabilities_1 = require("./capabilities");
const limits_1 = require("./limits");
const ACTION_REQUIRED_CAPABILITY = {
    charge: "set_charge_power",
    grid_charge: "enable_grid_charge",
    topoff: "set_charge_power",
    hold: "hold_battery",
};
function validateBatteryIntent(input) {
    const checksPassed = [];
    const checksFailed = [];
    const clamps = [];
    const reject = (code) => {
        checksFailed.push(code);
        return {
            accepted: false,
            rejectCode: code,
            effectiveChargeW: null,
            effectiveTargetSocPct: null,
            clamps,
            checksPassed,
            checksFailed,
        };
    };
    if (!input.governanceEnabled)
        return reject("addon_disabled");
    checksPassed.push("governance_enabled");
    if (input.fault)
        return reject("fault");
    if (input.lockout)
        return reject("lockout");
    checksPassed.push("no_fault_lockout");
    // discharge is never represented as a BatteryAction; guard explicitly anyway.
    if (input.intent.action === "discharge") {
        return reject("unsupported_action");
    }
    const requiredCap = ACTION_REQUIRED_CAPABILITY[input.intent.action];
    if (requiredCap && !(0, capabilities_1.isCapabilityAvailable)(input.capabilities, requiredCap)) {
        return reject("unsupported_action");
    }
    checksPassed.push("action_supported");
    if (!input.limits.valid)
        return reject("invalid_limits");
    checksPassed.push("limits_valid");
    let effectiveChargeW = null;
    let effectiveTargetSocPct = null;
    if ((0, intent_1.isChargingAction)(input.intent.action)) {
        if (!input.telemetryFreshForAction)
            return reject("telemetry_stale");
        checksPassed.push("telemetry_fresh");
        const requested = input.intent.maxChargeW ?? input.limits.maxChargeW ?? 0;
        const hwMax = input.limits.maxChargeW ?? requested;
        let eff = Math.max(0, Math.round(requested));
        if (eff > hwMax) {
            clamps.push({ field: "charge_power_w", from: eff, to: hwMax, reason: "hardware_max_charge_w" });
            eff = hwMax;
        }
        if (input.policyMaxChargeW != null && Number.isFinite(input.policyMaxChargeW) && eff > input.policyMaxChargeW) {
            const to = Math.max(0, Math.round(input.policyMaxChargeW));
            clamps.push({ field: "charge_power_w", from: eff, to, reason: "policy_max_charge_w" });
            eff = to;
        }
        effectiveChargeW = eff;
        if (input.intent.targetSocPct != null) {
            effectiveTargetSocPct = clampSoc(input.intent.targetSocPct, input.limits, clamps);
        }
    }
    else if (input.intent.targetSocPct != null) {
        effectiveTargetSocPct = clampSoc(input.intent.targetSocPct, input.limits, clamps);
    }
    void limits_1.hasDischargeCapability;
    return {
        accepted: true,
        rejectCode: null,
        effectiveChargeW,
        effectiveTargetSocPct,
        clamps,
        checksPassed,
        checksFailed,
    };
}
exports.validateBatteryIntent = validateBatteryIntent;
function clampSoc(requested, limits, clamps) {
    let soc = requested;
    const min = limits.minSocPct ?? 0;
    const max = limits.maxSocPct ?? 100;
    if (soc < min) {
        clamps.push({ field: "target_soc_pct", from: soc, to: min, reason: "hardware_min_soc_pct" });
        soc = min;
    }
    if (soc > max) {
        clamps.push({ field: "target_soc_pct", from: soc, to: max, reason: "hardware_max_soc_pct" });
        soc = max;
    }
    return soc;
}
