"use strict";
/**
 * External charging-authority diagnosis from the neutral EV model.
 * Vendor state IDs never appear here.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveExternalAuthorityState = exports.externalControlExpected = void 0;
function externalControlExpected(model) {
    if (model.externalControlConfigured)
        return true;
    if (model.externalControlEnabled === true)
        return true;
    return model.externalControlType !== "none";
}
exports.externalControlExpected = externalControlExpected;
function hasActiveExternalSignal(model) {
    return (model.gridRewardsActive === true ||
        model.smartChargingActive === true ||
        model.externalControlActive === true);
}
function sourceUnavailable(model) {
    const q = model.externalSourceQuality;
    return q === "stale" || q === "invalid";
}
function resolveExternalAuthorityState(model) {
    if (!externalControlExpected(model))
        return "inactive";
    if (sourceUnavailable(model))
        return "unavailable";
    const q = model.externalSourceQuality;
    if (q === "unknown" && !model.externalSourceHealthy && !hasActiveExternalSignal(model)) {
        return "unavailable";
    }
    if (q === "unconfigured" && model.externalControlType !== "none") {
        return "unavailable";
    }
    const plan = model.externalSmartPlanAvailable === true;
    const active = hasActiveExternalSignal(model);
    if (active && plan)
        return "active";
    if (active && !plan)
        return "active_without_plan";
    if (!active && plan)
        return "planned";
    if (q === "unknown")
        return "unknown";
    return "inactive";
}
exports.resolveExternalAuthorityState = resolveExternalAuthorityState;
