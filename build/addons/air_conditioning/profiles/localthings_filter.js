"use strict";
/**
 * LocalThings Filterstatus — Gerätewert ist maßgebend, keine Ableitung aus Stunden.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatLocalthingsFilterSummary = exports.localthingsFilterStatusLabelDe = exports.parseLocalthingsFilterStatus = void 0;
function parseLocalthingsFilterStatus(raw) {
    const s = String(raw ?? "")
        .trim()
        .toLowerCase();
    if (s === "normal" || s === "ok" || s === "good")
        return "normal";
    if (s === "wash" || s === "clean" || s === "cleaning_required")
        return "wash";
    if (s === "replace" || s === "exchange")
        return "replace";
    if (!s)
        return "unknown";
    return "unknown";
}
exports.parseLocalthingsFilterStatus = parseLocalthingsFilterStatus;
function localthingsFilterStatusLabelDe(status) {
    switch (status) {
        case "normal":
            return "Normal";
        case "wash":
            return "Reinigen";
        case "replace":
            return "Ersetzen";
        default:
            return "Unbekannt";
    }
}
exports.localthingsFilterStatusLabelDe = localthingsFilterStatusLabelDe;
function formatLocalthingsFilterSummary(input) {
    const st = parseLocalthingsFilterStatus(input.statusRaw);
    const pct = input.usagePct != null && Number.isFinite(input.usagePct) ? `${Math.round(input.usagePct)} %` : "—";
    const hours = input.usageHours != null && Number.isFinite(input.usageHours)
        ? `${Math.round(input.usageHours)} h`
        : "—";
    return `Filter ${pct} · ${hours} · ${localthingsFilterStatusLabelDe(st)}`;
}
exports.formatLocalthingsFilterSummary = formatLocalthingsFilterSummary;
