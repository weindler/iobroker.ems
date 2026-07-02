"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hourKeyToStartTs = exports.localHourKey = void 0;
/** Lokale Stunden-ID (Adapter-Zeitzone). */
function localHourKey(ts) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    return `${y}-${m}-${day}T${h}`;
}
exports.localHourKey = localHourKey;
/** Start-Timestamp der lokalen Stunde. */
function hourKeyToStartTs(hourKey) {
    const [datePart, hourPart] = hourKey.split("T");
    const [y, m, d] = datePart.split("-").map((x) => parseInt(x, 10));
    return new Date(y, m - 1, d, parseInt(hourPart, 10), 0, 0, 0).getTime();
}
exports.hourKeyToStartTs = hourKeyToStartTs;
