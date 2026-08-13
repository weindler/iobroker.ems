"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isStale = exports.normalizeOptionalSocOrNull = exports.normalizeOptionalBoolOrNull = exports.normalizeSmartChargingActive = exports.externalControlEnabledFromConfig = exports.sourceIsHealthy = exports.resolveExternalSourceQuality = exports.DEFAULT_EXTERNAL_STALE_AFTER_MIN = void 0;
const normalize_1 = require("../../normalize");
exports.DEFAULT_EXTERNAL_STALE_AFTER_MIN = 30;
function resolveExternalSourceQuality(input) {
    if (!input.configured)
        return "unconfigured";
    if (input.stale)
        return "stale";
    if (input.planInvalid && !input.anyMappedReadable)
        return "invalid";
    if (input.planInvalid && input.anyMappedReadable)
        return "degraded";
    if (input.controlInvalid)
        return "invalid";
    if (input.anyMappedMissing && !input.anyMappedReadable)
        return "unknown";
    if (input.planDegraded)
        return "degraded";
    if (input.anyMappedReadable)
        return "ok";
    return "unknown";
}
exports.resolveExternalSourceQuality = resolveExternalSourceQuality;
function sourceIsHealthy(quality) {
    return quality === "ok" || quality === "degraded" || quality === "unconfigured";
}
exports.sourceIsHealthy = sourceIsHealthy;
function externalControlEnabledFromConfig(input) {
    if (input.tibberGridRewardsViaVehicleEnabled || input.tibberGridRewardsViaWallboxEnabled) {
        return true;
    }
    return input.externalControlType !== "none";
}
exports.externalControlEnabledFromConfig = externalControlEnabledFromConfig;
/** Smart-charging status → boolean without inventing false for unknown strings. */
function normalizeSmartChargingActive(raw) {
    const asBool = (0, normalize_1.normalizeOptionalBool)(raw);
    if (asBool.status === "valid")
        return asBool.value;
    if (asBool.status === "missing")
        return null;
    const s = String(raw ?? "")
        .trim()
        .toLowerCase();
    if (!s)
        return null;
    if (["charging", "active", "smart", "smart_charging", "in_progress", "in-progress"].includes(s)) {
        return true;
    }
    if (["idle", "inactive", "disabled", "complete", "completed", "paused", "pause"].includes(s)) {
        return false;
    }
    return null;
}
exports.normalizeSmartChargingActive = normalizeSmartChargingActive;
function normalizeOptionalBoolOrNull(raw) {
    const f = (0, normalize_1.normalizeOptionalBool)(raw);
    return f.status === "valid" ? f.value : null;
}
exports.normalizeOptionalBoolOrNull = normalizeOptionalBoolOrNull;
function normalizeOptionalSocOrNull(raw) {
    const f = (0, normalize_1.normalizeOptionalSoc)(raw);
    return f.status === "valid" ? f.value : null;
}
exports.normalizeOptionalSocOrNull = normalizeOptionalSocOrNull;
function isStale(updatedAtMs, nowMs, staleAfterMin) {
    if (updatedAtMs === null || staleAfterMin <= 0)
        return false;
    return nowMs - updatedAtMs > staleAfterMin * 60_000;
}
exports.isStale = isStale;
