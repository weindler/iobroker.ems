"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.timestampAtLocalTime = exports.isInNightWindow = exports.localDateKey = exports.parseTimeHHMM = void 0;
function parseTimeHHMM(value) {
    const trimmed = value.trim();
    const m = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m)
        return null;
    const hour = parseInt(m[1], 10);
    const minute = parseInt(m[2], 10);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59)
        return null;
    return { hour, minute };
}
exports.parseTimeHHMM = parseTimeHHMM;
function localDateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}
exports.localDateKey = localDateKey;
/** Nachtfenster über Mitternacht, z. B. 22:00–06:00. */
function isInNightWindow(hour, nightStartHour, nightEndHour) {
    if (nightStartHour === nightEndHour)
        return false;
    if (nightStartHour < nightEndHour) {
        return hour >= nightStartHour && hour < nightEndHour;
    }
    return hour >= nightStartHour || hour < nightEndHour;
}
exports.isInNightWindow = isInNightWindow;
function timestampAtLocalTime(dateKey, hour, minute) {
    const [y, m, d] = dateKey.split("-").map((x) => parseInt(x, 10));
    return new Date(y, m - 1, d, hour, minute, 0, 0).getTime();
}
exports.timestampAtLocalTime = timestampAtLocalTime;
