"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gridDataQuality = void 0;
function gridDataQuality(status, reasonDe, confidencePct = null) {
    return {
        status,
        confidencePct: confidencePct !== null && Number.isFinite(confidencePct) ? confidencePct : null,
        reasonDe,
    };
}
exports.gridDataQuality = gridDataQuality;
