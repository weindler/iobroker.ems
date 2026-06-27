"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nextBatteryRevision = exports.lastBatteryChangedAt = exports.deriveBatteryIntentState = exports.semanticBatteryHash = void 0;
const node_crypto_1 = require("node:crypto");
function stableStringify(v) {
    return JSON.stringify(v, Object.keys(v).sort());
}
function semanticBatteryHash(intent) {
    const payload = {
        domain: intent.domain,
        target: intent.target,
        operating_request: intent.operating_request,
        target_soc_pct: intent.target_soc_pct,
        grid_charge_request: intent.grid_charge_request,
        ev_discharge_allowed: intent.ev_discharge_allowed,
        top_off_requested: intent.top_off_requested,
        manual_override: intent.manual_override,
        intent_state: intent.intent_state,
    };
    return (0, node_crypto_1.createHash)("sha256").update(stableStringify(payload), "utf8").digest("hex");
}
exports.semanticBatteryHash = semanticBatteryHash;
function deriveBatteryIntentState(intent) {
    const fields = [
        intent.operating_request,
        intent.target_soc_pct,
        intent.grid_charge_request,
        intent.ev_discharge_allowed,
        intent.top_off_requested,
    ];
    const validCount = fields.filter((f) => f.status === "valid").length;
    if (validCount === 0 && !intent.manual_override.active)
        return "none";
    if (validCount > 0 && validCount < fields.length)
        return "partial";
    if (validCount > 0 || intent.manual_override.active)
        return "available";
    return "none";
}
exports.deriveBatteryIntentState = deriveBatteryIntentState;
function lastBatteryChangedAt(intent) {
    const times = [];
    for (const f of [
        intent.operating_request,
        intent.target_soc_pct,
        intent.grid_charge_request,
        intent.ev_discharge_allowed,
        intent.top_off_requested,
    ]) {
        if (f.changed_at) {
            const t = Date.parse(f.changed_at);
            if (Number.isFinite(t))
                times.push(t);
        }
    }
    return times.length ? new Date(Math.max(...times)).toISOString() : intent.resolved_at;
}
exports.lastBatteryChangedAt = lastBatteryChangedAt;
function nextBatteryRevision(prev, next) {
    if (!prev) {
        const has = [
            next.operating_request,
            next.target_soc_pct,
            next.grid_charge_request,
            next.ev_discharge_allowed,
            next.top_off_requested,
        ].some((f) => f.status === "valid");
        return has || next.manual_override.active ? 1 : 0;
    }
    if (semanticBatteryHash(prev) === semanticBatteryHash(next))
        return prev.revision;
    return prev.revision + 1;
}
exports.nextBatteryRevision = nextBatteryRevision;
