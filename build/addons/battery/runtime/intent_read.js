"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deviceIntentFromResolvedBattery = exports.resolvedIntentHasConstraint = exports.parseResolvedBatteryIntentJson = void 0;
const intent_1 = require("../core/intent");
function parseResolvedBatteryIntentJson(raw) {
    if (!raw)
        return null;
    try {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (parsed && typeof parsed === "object" && parsed.domain === "battery") {
            return parsed;
        }
    }
    catch {
        return null;
    }
    return null;
}
exports.parseResolvedBatteryIntentJson = parseResolvedBatteryIntentJson;
function resolvedIntentHasConstraint(intent) {
    if (intent.intent_state === "disabled" || intent.intent_state === "not_configured")
        return false;
    const fields = [
        intent.operating_request,
        intent.target_soc_pct,
        intent.grid_charge_request,
        intent.ev_discharge_allowed,
        intent.top_off_requested,
    ];
    return fields.some((f) => f.status === "valid");
}
exports.resolvedIntentHasConstraint = resolvedIntentHasConstraint;
function deviceIntentFromResolvedBattery(resolved) {
    const { intent, rejected } = (0, intent_1.deviceIntentFromResolved)(resolved, { source: "user_intent" });
    if (!intent)
        return null;
    return { intent, wantsCharge: (0, intent_1.isChargingAction)(intent.action), rejected };
}
exports.deviceIntentFromResolvedBattery = deviceIntentFromResolvedBattery;
