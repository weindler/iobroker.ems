"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clampConfidencePct = clampConfidencePct;
exports.baseContribution = baseContribution;
exports.isPvForecastPresent = isPvForecastPresent;
exports.pvAddonId = pvAddonId;
exports.weatherForecastAddonId = weatherForecastAddonId;
exports.houseMainFuseAddonId = houseMainFuseAddonId;
exports.pvContributorRef = pvContributorRef;
const contributor_1 = require("../contributor");
function clampConfidencePct(value) {
    if (value === null || value === undefined || !Number.isFinite(value))
        return null;
    return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}
function baseContribution(contributionId, contributor, flow, roles, params) {
    return {
        contributionId,
        contributor,
        flow,
        roles,
        generatedAt: params.generatedAt,
        validUntil: params.validUntil,
        revision: params.revision,
        enabled: params.enabled,
        flexible: params.flexible,
        gridEligible: params.gridEligible,
        priorityBand: params.priorityBand ?? null,
        deadlineIso: params.deadlineIso ?? null,
        slots: params.slots ?? [],
        quality: params.quality,
        reasonDe: params.reasonDe,
        details: params.details,
    };
}
function isPvForecastPresent(correctedTodayKwh, correctedTomorrowKwh, status) {
    if (status === "ready" || status === "insufficient_data") {
        return correctedTodayKwh !== null || correctedTomorrowKwh !== null;
    }
    return correctedTodayKwh !== null || correctedTomorrowKwh !== null;
}
function pvAddonId() {
    return "pv_forecast";
}
function weatherForecastAddonId() {
    return "weather_forecast";
}
function houseMainFuseAddonId() {
    return "house_main_fuse";
}
function pvContributorRef() {
    return (0, contributor_1.addonContributorRef)("pv_forecast");
}
