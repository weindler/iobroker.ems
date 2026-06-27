"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nextRevision = exports.semanticIntentChanged = exports.computeSemanticHash = exports.semanticIntentPayload = void 0;
const node_crypto_1 = require("node:crypto");
function sortKeysDeep(value) {
    if (value === null || typeof value !== "object") {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(sortKeysDeep);
    }
    const obj = value;
    const keys = Object.keys(obj).sort();
    const out = {};
    for (const k of keys) {
        const v = obj[k];
        if (v !== undefined) {
            out[k] = sortKeysDeep(v);
        }
    }
    return out;
}
function stableStringify(value) {
    return JSON.stringify(sortKeysDeep(value));
}
/** Semantischer Payload ohne Laufzeit-/Diagnose-Felder. */
function semanticIntentPayload(intent) {
    const fieldForHash = (f) => ({
        value: f.value,
        status: f.status,
        origin: f.origin,
        valid_until: f.valid_until,
    });
    return {
        schema_version: intent.schema_version,
        domain: intent.domain,
        target: intent.target,
        charge_strategy: fieldForHash(intent.charge_strategy),
        target_soc_pct: fieldForHash(intent.target_soc_pct),
        deadline: fieldForHash(intent.deadline),
        manual_override: manualOverrideForHash(intent.manual_override),
        intent_state: intent.intent_state,
        source_summary: [...intent.source_summary].sort(),
    };
}
exports.semanticIntentPayload = semanticIntentPayload;
function manualOverrideForHash(mo) {
    return {
        active: mo.active,
        scope: [...mo.scope].sort(),
        source: mo.source,
        owner: mo.owner,
        owner_id: mo.owner_id,
        valid_until: mo.valid_until,
        reason: mo.reason,
    };
}
function computeSemanticHash(intent) {
    return (0, node_crypto_1.createHash)("sha256").update(stableStringify(semanticIntentPayload(intent)), "utf8").digest("hex");
}
exports.computeSemanticHash = computeSemanticHash;
function semanticIntentChanged(prev, next) {
    if (!prev) {
        return true;
    }
    return computeSemanticHash(prev) !== computeSemanticHash(next);
}
exports.semanticIntentChanged = semanticIntentChanged;
function nextRevision(prev, next) {
    if (!prev) {
        return next.charge_strategy.status !== "missing" ||
            next.target_soc_pct.status !== "missing" ||
            next.deadline.status !== "missing" ||
            next.manual_override.active
            ? 1
            : 0;
    }
    if (!semanticIntentChanged(prev, next)) {
        return prev.revision;
    }
    return prev.revision + 1;
}
exports.nextRevision = nextRevision;
