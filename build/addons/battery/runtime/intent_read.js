"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deviceIntentFromResolvedBattery = exports.resolvedIntentHasConstraint = exports.resolvedIntentHasManualPriority = exports.parseResolvedBatteryIntentJson = void 0;
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
function resolvedIntentHasManualPriority(intent) {
    if (intent.intent_state === "disabled" || intent.intent_state === "not_configured")
        return false;
    if (intent.manual_override.active) {
        if (intent.manual_override.valid_until) {
            const until = Date.parse(intent.manual_override.valid_until);
            if (Number.isFinite(until) && until <= Date.now())
                return false;
        }
        return true;
    }
    if (intent.operating_request.status === "valid") {
        const op = intent.operating_request.value;
        const kind = intent.operating_request.origin?.change_kind;
        const manualKind = kind === "manual_explicit" || kind === "manual_inferred";
        if (manualKind && op !== null && op !== "auto" && op !== "unknown")
            return true;
    }
    return false;
}
exports.resolvedIntentHasManualPriority = resolvedIntentHasManualPriority;
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
