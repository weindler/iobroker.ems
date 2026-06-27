"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildResolvedAllIntent = exports.nextAggregateRevision = exports.computeAggregateRevisionHash = void 0;
const node_crypto_1 = require("node:crypto");
function stableStringify(value) {
    return JSON.stringify(sortKeysDeep(value));
}
function sortKeysDeep(value) {
    if (value === null || typeof value !== "object")
        return value;
    if (Array.isArray(value))
        return value.map(sortKeysDeep);
    const obj = value;
    const keys = Object.keys(obj).sort();
    const out = {};
    for (const k of keys) {
        const v = obj[k];
        if (v !== undefined)
            out[k] = sortKeysDeep(v);
    }
    return out;
}
function computeAggregateRevisionHash(domains) {
    const payload = {
        schema_version: 1,
        domains: sortKeysDeep(domains),
    };
    return (0, node_crypto_1.createHash)("sha256").update(stableStringify(payload), "utf8").digest("hex");
}
exports.computeAggregateRevisionHash = computeAggregateRevisionHash;
function nextAggregateRevision(prev, domains) {
    const hash = computeAggregateRevisionHash(domains);
    if (!prev) {
        return Object.keys(domains).length > 0 ? 1 : 0;
    }
    const prevHash = computeAggregateRevisionHash(prev.domains);
    if (hash === prevHash) {
        return prev.revision;
    }
    return prev.revision + 1;
}
exports.nextAggregateRevision = nextAggregateRevision;
function buildResolvedAllIntent(prev, domains, now) {
    const revision = nextAggregateRevision(prev, domains);
    const changed = !prev || revision !== prev.revision;
    return {
        schema_version: 1,
        revision,
        resolved_at: changed ? now.toISOString() : prev.resolved_at,
        domains,
    };
}
exports.buildResolvedAllIntent = buildResolvedAllIntent;
