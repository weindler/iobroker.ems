"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.globalConstraintsStatus = exports.houseFuseConstraintStatus = void 0;
/** Pure diagnostic status derived from snapshot policy fields — no operator contributions. */
function houseFuseConstraintStatus(input) {
    const hasLimits = input.configuredHouseFuseLimitW !== null || input.configuredMaxGridImportW !== null;
    return hasLimits ? "valid" : "missing";
}
exports.houseFuseConstraintStatus = houseFuseConstraintStatus;
function globalConstraintsStatus(input) {
    const hasEffective = input.effectiveMaxGridImportW !== null ||
        input.gridImportAllowed !== undefined ||
        input.globalMode !== null;
    if (!hasEffective)
        return "missing";
    return input.gridSupplyQuality.status === "valid" ? "valid" : "degraded";
}
exports.globalConstraintsStatus = globalConstraintsStatus;
