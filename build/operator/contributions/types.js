"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pvContributorRef = exports.houseMainFuseAddonId = exports.weatherForecastAddonId = exports.pvAddonId = exports.isPvForecastPresent = exports.baseContribution = exports.clampConfidencePct = void 0;
const contributor_1 = require("../contributor");
function clampConfidencePct(value) {
    if (value === null || value === undefined || !Number.isFinite(value))
        return null;
    return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}
exports.clampConfidencePct = clampConfidencePct;
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
exports.baseContribution = baseContribution;
function isPvForecastPresent(correctedTodayKwh, correctedTomorrowKwh, status) {
    if (status === "ready" || status === "insufficient_data") {
        return correctedTodayKwh !== null || correctedTomorrowKwh !== null;
    }
    return correctedTodayKwh !== null || correctedTomorrowKwh !== null;
}
exports.isPvForecastPresent = isPvForecastPresent;
function pvAddonId() {
    return "pv_forecast";
}
exports.pvAddonId = pvAddonId;
function weatherForecastAddonId() {
    return "weather_forecast";
}
exports.weatherForecastAddonId = weatherForecastAddonId;
function houseMainFuseAddonId() {
    return "house_main_fuse";
}
exports.houseMainFuseAddonId = houseMainFuseAddonId;
function pvContributorRef() {
    return (0, contributor_1.addonContributorRef)("pv_forecast");
}
exports.pvContributorRef = pvContributorRef;
