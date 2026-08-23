"use strict";
/**
 * Normalisierte AC-Werte für VIS (Power-Anzeige, Filter) — keine Write-Logik.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveAcFilterVis = exports.acFilterStatusCode = exports.acFilterStatusLabelShortDe = exports.resolveAcPowerDisplay = void 0;
const localthings_filter_1 = require("../profiles/localthings_filter");
/**
 * Messwert nur wenn bereits plausibel gefiltert (nicht 0 W bei AC an).
 * Sonst bei Betrieb Fallback auf geschätzte/gelernte Leistung.
 */
function resolveAcPowerDisplay(input) {
    const meas = input.measuredPowerW;
    if (meas != null && Number.isFinite(meas) && meas > 0) {
        return { measuredPowerW: Math.round(meas), displayPowerW: Math.round(meas), kind: "measured" };
    }
    if (input.running) {
        const est = input.estimatedPowerW;
        if (est != null && Number.isFinite(est) && est > 0) {
            return { measuredPowerW: null, displayPowerW: Math.round(est), kind: "estimated" };
        }
    }
    return { measuredPowerW: null, displayPowerW: null, kind: "none" };
}
exports.resolveAcPowerDisplay = resolveAcPowerDisplay;
/** Kurzlabels für VIS-Kachel (User-Auftrag). */
function acFilterStatusLabelShortDe(status) {
    switch (status) {
        case "normal":
            return "Normal";
        case "wash":
            return "Reinigen";
        case "replace":
            return "Ersetzen";
        default:
            return "";
    }
}
exports.acFilterStatusLabelShortDe = acFilterStatusLabelShortDe;
/**
 * Numerischer Filtercode für VIS/Diagnose (keine Regelung).
 * normal→0, wash→1, replace→2, sonst/fehlend→-1.
 */
function acFilterStatusCode(status) {
    const s = String(status ?? "")
        .trim()
        .toLowerCase();
    if (s === "normal")
        return 0;
    if (s === "wash")
        return 1;
    if (s === "replace")
        return 2;
    return -1;
}
exports.acFilterStatusCode = acFilterStatusCode;
function resolveAcFilterVis(input) {
    const hasAny = (input.statusRaw != null && String(input.statusRaw).trim() !== "") ||
        (input.usagePct != null && Number.isFinite(input.usagePct)) ||
        (input.usageHours != null && Number.isFinite(input.usageHours));
    if (!hasAny) {
        return { status: "", labelDe: "", usagePct: null, usageHours: null, warnDe: "" };
    }
    const parsed = (0, localthings_filter_1.parseLocalthingsFilterStatus)(input.statusRaw);
    const status = parsed === "unknown" && String(input.statusRaw ?? "").trim() === "" ? "" : parsed;
    const labelDe = !status || status === "unknown" ? "" : acFilterStatusLabelShortDe(status);
    let warnDe = "";
    if (status === "wash")
        warnDe = "FILTER REINIGEN";
    if (status === "replace")
        warnDe = "FILTER ERSETZEN";
    const pct = input.usagePct != null && Number.isFinite(input.usagePct) ? Math.round(input.usagePct) : null;
    const hours = input.usageHours != null && Number.isFinite(input.usageHours)
        ? Math.round(input.usageHours)
        : null;
    return {
        status: status === "unknown" ? "" : status,
        labelDe: labelDe ||
            (status === "unknown" ? "" : (0, localthings_filter_1.localthingsFilterStatusLabelDe)(parsed)),
        usagePct: pct,
        usageHours: hours,
        warnDe,
    };
}
exports.resolveAcFilterVis = resolveAcFilterVis;
