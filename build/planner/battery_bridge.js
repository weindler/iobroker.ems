"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePlannerIntentJson = exports.plannerWantsActiveBatteryIntent = exports.deviceIntentFromPlannerDecision = void 0;
const intent_1 = require("../addons/battery/core/intent");
function deviceIntentFromPlannerDecision(decision, revision, resolvedAt) {
    if (decision.action === "none")
        return null;
    let action;
    if (decision.action === "charge") {
        action = "charge";
    }
    else if (decision.action === "hold") {
        action = "hold";
    }
    else {
        action = "self_consumption";
    }
    return {
        requestId: `planner-${revision}`,
        action,
        targetSocPct: decision.target_soc_pct,
        maxChargeW: decision.action === "charge" && decision.max_charge_w > 0 ? decision.max_charge_w : null,
        maxDischargeW: null,
        energySource: decision.action === "charge" ? "pv" : "any",
        validFrom: null,
        validUntil: null,
        issuedAt: resolvedAt,
        reason: decision.reason_de,
        source: "planner",
    };
}
exports.deviceIntentFromPlannerDecision = deviceIntentFromPlannerDecision;
function plannerWantsActiveBatteryIntent(decision) {
    if (decision.action === "none")
        return false;
    if (decision.action === "charge")
        return (0, intent_1.isChargingAction)("charge");
    return decision.action === "self_consumption" || decision.action === "hold";
}
exports.plannerWantsActiveBatteryIntent = plannerWantsActiveBatteryIntent;
function parsePlannerIntentJson(raw) {
    if (!raw)
        return null;
    try {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (!parsed || typeof parsed !== "object")
            return null;
        const p = parsed;
        if (p.schema_version !== 1)
            return null;
        const battery = p.battery;
        if (!battery || typeof battery !== "object")
            return null;
        return {
            revision: typeof p.revision === "number" ? p.revision : 0,
            resolved_at: typeof p.resolved_at === "string" ? p.resolved_at : new Date().toISOString(),
            battery,
        };
    }
    catch {
        return null;
    }
}
exports.parsePlannerIntentJson = parsePlannerIntentJson;
