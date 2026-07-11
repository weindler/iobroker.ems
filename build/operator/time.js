"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addDaysToDateKey = exports.isoAtTimezoneLocal = exports.localDateKeyInTimezone = exports.isValidIsoTimestamp = exports.slotEndMsFromStart = exports.isoFromMs = exports.OPERATOR_MS_PER_15MIN = void 0;
const tibber_parse_1 = require("../learning/price_forecast/tibber_parse");
exports.OPERATOR_MS_PER_15MIN = tibber_parse_1.MS_PER_15MIN;
function isoFromMs(ms) {
    return new Date(ms).toISOString();
}
exports.isoFromMs = isoFromMs;
function slotEndMsFromStart(startMs) {
    return startMs + exports.OPERATOR_MS_PER_15MIN;
}
exports.slotEndMsFromStart = slotEndMsFromStart;
function isValidIsoTimestamp(iso) {
    if (!iso.trim())
        return false;
    const ms = Date.parse(iso);
    return Number.isFinite(ms);
}
exports.isValidIsoTimestamp = isValidIsoTimestamp;
function zonedParts(ms, timezone) {
    const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
    const parts = fmt.formatToParts(new Date(ms));
    const pick = (type) => {
        const v = parts.find((p) => p.type === type)?.value ?? "0";
        return parseInt(v, 10);
    };
    return {
        year: pick("year"),
        month: pick("month"),
        day: pick("day"),
        hour: pick("hour"),
        minute: pick("minute"),
    };
}
function localDateKeyInTimezone(d, timezone) {
    const p = zonedParts(d.getTime(), timezone);
    return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
exports.localDateKeyInTimezone = localDateKeyInTimezone;
function isoAtTimezoneLocal(dateKey, hour, minute, timezone) {
    const [y, mo, da] = dateKey.split("-").map((x) => parseInt(x, 10));
    let lo = Date.UTC(y, mo - 1, da, 0, 0, 0) - 36 * tibber_parse_1.MS_PER_15MIN;
    let hi = Date.UTC(y, mo - 1, da, 23, 59, 59) + 36 * tibber_parse_1.MS_PER_15MIN;
    for (let ms = lo; ms <= hi; ms += 60_000) {
        const p = zonedParts(ms, timezone);
        if (p.year === y && p.month === mo && p.day === da && p.hour === hour && p.minute === minute) {
            return isoFromMs(ms);
        }
    }
    return isoFromMs(Date.UTC(y, mo - 1, da, hour, minute, 0));
}
exports.isoAtTimezoneLocal = isoAtTimezoneLocal;
function addDaysToDateKey(dateKey, days) {
    const [y, mo, da] = dateKey.split("-").map((x) => parseInt(x, 10));
    const d = new Date(Date.UTC(y, mo - 1, da + days, 12, 0, 0));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
exports.addDaysToDateKey = addDaysToDateKey;
