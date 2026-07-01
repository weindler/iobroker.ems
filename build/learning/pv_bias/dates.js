"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.freezeInstantMs = exports.localDateKey = void 0;
const config_1 = require("./config");
/** Lokales Kalenderdatum YYYY-MM-DD. */
function localDateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}
exports.localDateKey = localDateKey;
/** Zeitpunkt des Freeze an einem Referenztag (lokale Zeit) in ms. */
function freezeInstantMs(freezeTime, ref) {
    const parsed = (0, config_1.parseFreezeTimeHHMM)(freezeTime);
    if (!parsed) {
        return null;
    }
    const d = new Date(ref);
    d.setHours(parsed.hours, parsed.minutes, 0, 0);
    return d.getTime();
}
exports.freezeInstantMs = freezeInstantMs;
