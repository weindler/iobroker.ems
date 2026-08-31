"use strict";
/**
 * PHASE 6 — Erlaubte KI-Override-Parameter. Alles andere (insbesondere Safety) ist
 * unwiderruflich gesperrt. Die KI kann diese Liste nicht erweitern.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeOpportunityMarginWithOverride = exports.defaultOriginalValueForParameter = exports.boundsForOverrideParameter = exports.AI_OVERRIDEABLE_PARAMETERS = exports.AI_OVERRIDE_PARAM_BATTERY_OPPORTUNITY_MARGIN_CT = void 0;
const battery_discharge_authority_1 = require("../../operator/daily_plan/battery_discharge_authority");
exports.AI_OVERRIDE_PARAM_BATTERY_OPPORTUNITY_MARGIN_CT = "battery.opportunity_margin_ct";
exports.AI_OVERRIDEABLE_PARAMETERS = {
    [exports.AI_OVERRIDE_PARAM_BATTERY_OPPORTUNITY_MARGIN_CT]: {
        minValue: 0,
        maxValue: 10,
        maxChangePerStepAbs: 2,
        minConfidencePct: 70,
        minSampleCount: 1,
        maxDataAgeDays: 14,
        ttlMs: 24 * 60 * 60 * 1000,
    },
};
function boundsForOverrideParameter(parameter) {
    return exports.AI_OVERRIDEABLE_PARAMETERS[parameter] ?? null;
}
exports.boundsForOverrideParameter = boundsForOverrideParameter;
function defaultOriginalValueForParameter(parameter) {
    if (parameter === exports.AI_OVERRIDE_PARAM_BATTERY_OPPORTUNITY_MARGIN_CT) {
        return battery_discharge_authority_1.DEFAULT_OPPORTUNITY_MARGIN_CT_PER_KWH;
    }
    return null;
}
exports.defaultOriginalValueForParameter = defaultOriginalValueForParameter;
/** Wirksame Opportunity-Marge: validierter Override ersetzt die Basis, sonst bleibt die Basis. */
function mergeOpportunityMarginWithOverride(baseMarginCt, overrideValue) {
    if (overrideValue === null || !Number.isFinite(overrideValue))
        return baseMarginCt;
    return Math.max(0, overrideValue);
}
exports.mergeOpportunityMarginWithOverride = mergeOpportunityMarginWithOverride;
