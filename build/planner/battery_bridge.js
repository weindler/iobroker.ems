"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePlannerIntentJson = exports.deviceIntentFromPlannerDecision = void 0;
function deviceIntentFromPlannerDecision(decision, revision, resolvedAt) {
    if (decision.action !== "charge")
        return null;
    return {
        requestId: `planner-${revision}`,
        action: "charge",
        targetSocPct: decision.target_soc_pct,
        maxChargeW: decision.max_charge_w > 0 ? decision.max_charge_w : null,
        maxDischargeW: null,
        energySource: "pv",
        validFrom: null,
        validUntil: null,
        issuedAt: resolvedAt,
        reason: decision.reason_de,
        source: "planner",
    };
}
exports.deviceIntentFromPlannerDecision = deviceIntentFromPlannerDecision;
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
