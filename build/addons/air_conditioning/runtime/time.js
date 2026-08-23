"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.switchIsOff = exports.switchIsOn = exports.isHardOffTime = exports.isWithinClockWindow = exports.localMinutesNow = exports.parseClockToMinutes = void 0;
/** Minuten seit Mitternacht aus HH:MM oder HH:MM:SS. */
function parseClockToMinutes(raw) {
    const m = String(raw ?? "").trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m)
        return null;
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59)
        return null;
    return h * 60 + min;
}
exports.parseClockToMinutes = parseClockToMinutes;
function localMinutesNow(d) {
    return d.getHours() * 60 + d.getMinutes();
}
exports.localMinutesNow = localMinutesNow;
function isWithinClockWindow(nowMin, fromRaw, untilRaw) {
    const from = parseClockToMinutes(fromRaw);
    const until = parseClockToMinutes(untilRaw);
    if (from === null || until === null)
        return true;
    if (from <= until) {
        return nowMin >= from && nowMin < until;
    }
    return nowMin >= from || nowMin < until;
}
exports.isWithinClockWindow = isWithinClockWindow;
function isHardOffTime(nowMin, hardOffRaw) {
    const off = parseClockToMinutes(hardOffRaw);
    if (off === null)
        return false;
    return nowMin >= off;
}
exports.isHardOffTime = isHardOffTime;
function switchIsOn(raw) {
    if (typeof raw === "boolean")
        return raw;
    if (typeof raw === "number")
        return raw !== 0;
    const s = String(raw ?? "").trim().toLowerCase();
    if (s === "on" || s === "true" || s === "1")
        return true;
    if (s === "off" || s === "false" || s === "0" || s === "")
        return false;
    // LocalThings climate.state: HVAC-Modi = Gerät an
    return s === "cool" || s === "heat" || s === "dry" || s === "fan_only" || s === "auto";
}
exports.switchIsOn = switchIsOn;
function switchIsOff(raw) {
    if (typeof raw === "boolean")
        return !raw;
    if (typeof raw === "number")
        return raw === 0;
    const s = String(raw ?? "").trim().toLowerCase();
    return s === "off" || s === "false" || s === "0" || s === "";
}
exports.switchIsOff = switchIsOff;
