"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nextThermalRevision = exports.lastThermalChangedAt = exports.deriveThermalIntentState = exports.semanticThermalHash = void 0;
const node_crypto_1 = require("node:crypto");
function stableStringify(v) {
    return JSON.stringify(v, Object.keys(v).sort());
}
function semanticThermalHash(intent) {
    const payload = {
        domain: intent.domain,
        target: intent.target,
        operating_request: intent.operating_request,
        target_temperature_c: intent.target_temperature_c,
        ready_at: intent.ready_at,
        priority: intent.priority,
        manual_override: intent.manual_override,
        intent_state: intent.intent_state,
    };
    return (0, node_crypto_1.createHash)("sha256").update(stableStringify(payload), "utf8").digest("hex");
}
exports.semanticThermalHash = semanticThermalHash;
function deriveThermalIntentState(intent) {
    const fields = [intent.operating_request, intent.target_temperature_c, intent.ready_at, intent.priority];
    const validCount = fields.filter((f) => f.status === "valid").length;
    if (validCount === 0 && !intent.manual_override.active)
        return "none";
    if (validCount > 0 && validCount < fields.length)
        return "partial";
    if (validCount > 0 || intent.manual_override.active)
        return "available";
    return "none";
}
exports.deriveThermalIntentState = deriveThermalIntentState;
function lastThermalChangedAt(intent) {
    const times = [];
    for (const f of [intent.operating_request, intent.target_temperature_c, intent.ready_at, intent.priority]) {
        if (f.changed_at) {
            const t = Date.parse(f.changed_at);
            if (Number.isFinite(t))
                times.push(t);
        }
    }
    return times.length ? new Date(Math.max(...times)).toISOString() : intent.resolved_at;
}
exports.lastThermalChangedAt = lastThermalChangedAt;
function nextThermalRevision(prev, next) {
    if (!prev) {
        const has = [next.operating_request, next.target_temperature_c, next.ready_at, next.priority].some((f) => f.status === "valid");
        return has || next.manual_override.active ? 1 : 0;
    }
    if (semanticThermalHash(prev) === semanticThermalHash(next))
        return prev.revision;
    return prev.revision + 1;
}
exports.nextThermalRevision = nextThermalRevision;
