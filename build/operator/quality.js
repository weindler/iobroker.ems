"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.operatorQuality = operatorQuality;
exports.mergeOperatorQuality = mergeOperatorQuality;
function operatorQuality(status, reasonDe, confidencePct = null) {
    return {
        status,
        confidencePct: confidencePct !== null && Number.isFinite(confidencePct) ? confidencePct : null,
        reasonDe,
    };
}
function mergeOperatorQuality(a, b) {
    const rank = {
        invalid: 7,
        unsupported: 6,
        blocked: 5,
        missing: 4,
        disabled: 3,
        degraded: 2,
        valid: 1,
    };
    const pick = rank[a.status] >= rank[b.status] ? a : b;
    return {
        status: pick.status,
        confidencePct: pick.confidencePct ?? a.confidencePct ?? b.confidencePct,
        reasonDe: pick.reasonDe || a.reasonDe || b.reasonDe,
    };
}
