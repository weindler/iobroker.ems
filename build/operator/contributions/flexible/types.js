"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.flexibleContributionsRevisionPayload = exports.wallboxMaxChargePowerW = exports.round3 = exports.participationQuality = exports.evaluateParticipation = void 0;
const quality_1 = require("../../quality");
function evaluateParticipation(input) {
    if (input.unsupported) {
        return { allowed: false, status: "unsupported", reasonDe: "Funktion durch Profil nicht unterstützt." };
    }
    if (!input.addonEnabled) {
        return { allowed: false, status: "disabled", reasonDe: "Add-on deaktiviert." };
    }
    if (!input.governanceEnabled) {
        return { allowed: false, status: "disabled", reasonDe: "Governance deaktiviert." };
    }
    if (input.globalModeOff) {
        return { allowed: false, status: "disabled", reasonDe: "Global Mode off — keine flexiblen Contributions." };
    }
    if (input.fault) {
        return { allowed: false, status: "blocked", reasonDe: "Gerätestörung (Fault) aktiv." };
    }
    if (input.lockout) {
        return { allowed: false, status: "blocked", reasonDe: "Gerät im Lockout." };
    }
    if (!input.configured) {
        return { allowed: false, status: "missing", reasonDe: "Add-on nicht konfiguriert." };
    }
    if (!input.mappingsReady) {
        return { allowed: false, status: "missing", reasonDe: "Erforderliche Mappings fehlen." };
    }
    if (input.telemetryValid === false) {
        return { allowed: false, status: "invalid", reasonDe: "Telemetrie ungültig." };
    }
    if (input.telemetryStale) {
        return { allowed: false, status: "degraded", reasonDe: "Telemetrie veraltet." };
    }
    return { allowed: true, status: "valid", reasonDe: "Teilnahmebedingungen erfüllt." };
}
exports.evaluateParticipation = evaluateParticipation;
function participationQuality(result) {
    return (0, quality_1.operatorQuality)(result.status, result.reasonDe);
}
exports.participationQuality = participationQuality;
function round3(n) {
    return Math.round(n * 1000) / 1000;
}
exports.round3 = round3;
/** Max. Ladeleistung Wallbox aus Phasen × Spannung × Strom (keine Phasenumschaltung). */
function wallboxMaxChargePowerW(phases, maxCurrentA, voltage = 230) {
    if (phases === null || maxCurrentA === null || phases <= 0 || maxCurrentA <= 0)
        return null;
    return Math.round(phases * voltage * maxCurrentA);
}
exports.wallboxMaxChargePowerW = wallboxMaxChargePowerW;
const FLEX_REVISION_OMIT_DETAIL_KEYS = new Set([
    "lastUpdate",
    "lastUpdateTs",
    "calculated_at",
    "calculatedAt",
    "runtimeId",
    "runtime_id",
    "generatedAt",
    "validUntil",
    "forecastHorizonStart",
    "forecastHorizonEnd",
    "todayDateKey",
    "tomorrowDateKey",
]);
function stripVolatileFlexibleDetails(details) {
    const out = {};
    for (const [key, value] of Object.entries(details)) {
        if (FLEX_REVISION_OMIT_DETAIL_KEYS.has(key))
            continue;
        out[key] = value;
    }
    return out;
}
function flexibleContributionsRevisionPayload(contributions) {
    return JSON.stringify(contributions.map((c) => ({
        contributionId: c.contributionId,
        enabled: c.enabled,
        quality: c.quality,
        details: stripVolatileFlexibleDetails(c.details),
        slots: c.slots.map((slot) => {
            const { slot: _time, ...rest } = slot;
            return rest;
        }),
    })));
}
exports.flexibleContributionsRevisionPayload = flexibleContributionsRevisionPayload;
