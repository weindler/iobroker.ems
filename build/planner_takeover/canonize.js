"use strict";
/** Time and numeric canonization for dual-run semantic comparison. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.slotDurationMinutes = exports.utcDayKey = exports.numbersSemanticallyEqual = exports.canonicalizePercent = exports.canonicalizePriceCt = exports.canonicalizeEnergyKwh = exports.canonicalizePowerW = exports.roundTo = exports.canonicalizeUtcIso = void 0;
const constants_1 = require("./constants");
/** Strip sub-second noise; keep UTC ISO-8601 to the second. */
function canonicalizeUtcIso(value) {
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) {
        return value;
    }
    return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}
exports.canonicalizeUtcIso = canonicalizeUtcIso;
function roundTo(value, decimals) {
    const f = 10 ** decimals;
    return Math.round(value * f) / f;
}
exports.roundTo = roundTo;
/** Power: whole watts. */
function canonicalizePowerW(value) {
    if (value === null || value === undefined || !Number.isFinite(value))
        return null;
    return Math.round(value);
}
exports.canonicalizePowerW = canonicalizePowerW;
/** Energy: 6 decimal kWh (≈1 Wh resolution). */
function canonicalizeEnergyKwh(value) {
    if (value === null || value === undefined || !Number.isFinite(value))
        return null;
    return roundTo(value, 6);
}
exports.canonicalizeEnergyKwh = canonicalizeEnergyKwh;
/** Price: 4 decimal ct/kWh. */
function canonicalizePriceCt(value) {
    if (value === null || value === undefined || !Number.isFinite(value))
        return null;
    return roundTo(value, 4);
}
exports.canonicalizePriceCt = canonicalizePriceCt;
/** Percent: 2 decimal places. */
function canonicalizePercent(value) {
    if (value === null || value === undefined || !Number.isFinite(value))
        return null;
    return roundTo(value, 2);
}
exports.canonicalizePercent = canonicalizePercent;
function numbersSemanticallyEqual(a, b, domain) {
    if (a === null && b === null)
        return true;
    if (a === null || b === null)
        return false;
    const tol = domain === "power_w"
        ? constants_1.TAKEOVER_TOLERANCE_POWER_W
        : domain === "energy_kwh"
            ? constants_1.TAKEOVER_TOLERANCE_ENERGY_KWH
            : domain === "price_ct"
                ? constants_1.TAKEOVER_TOLERANCE_PRICE_CT
                : constants_1.TAKEOVER_TOLERANCE_PERCENT;
    return Math.abs(a - b) <= tol;
}
exports.numbersSemanticallyEqual = numbersSemanticallyEqual;
function utcDayKey(iso) {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms))
        return iso.slice(0, 10);
    return new Date(ms).toISOString().slice(0, 10);
}
exports.utcDayKey = utcDayKey;
function slotDurationMinutes(startIso, endIso) {
    const a = Date.parse(startIso);
    const b = Date.parse(endIso);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a)
        return 0;
    return Math.round((b - a) / 60_000);
}
exports.slotDurationMinutes = slotDurationMinutes;
