"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.localDateKey = localDateKey;
exports.dateKeyToStartMs = dateKeyToStartMs;
/** Lokales Kalenderdatum YYYY-MM-DD. */
function localDateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}
function dateKeyToStartMs(dateKey) {
    const [y, m, d] = dateKey.split("-").map((x) => parseInt(x, 10));
    return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}
