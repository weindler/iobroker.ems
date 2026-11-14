"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gridDataQuality = gridDataQuality;
function gridDataQuality(status, reasonDe, confidencePct = null) {
    return {
        status,
        confidencePct: confidencePct !== null && Number.isFinite(confidencePct) ? confidencePct : null,
        reasonDe,
    };
}
