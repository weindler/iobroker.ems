"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPERATOR_MS_PER_15MIN = void 0;
exports.isoFromMs = isoFromMs;
exports.slotEndMsFromStart = slotEndMsFromStart;
exports.isValidIsoTimestamp = isValidIsoTimestamp;
exports.localDateKeyInTimezone = localDateKeyInTimezone;
exports.formatLocalDateTimeDe = formatLocalDateTimeDe;
exports.isoAtTimezoneLocal = isoAtTimezoneLocal;
exports.addDaysToDateKey = addDaysToDateKey;
exports.zonedFormatterCacheSizeForTest = zonedFormatterCacheSizeForTest;
exports.resetZonedFormatterCacheForTest = resetZonedFormatterCacheForTest;
exports.zonedFormatterCacheHasForTest = zonedFormatterCacheHasForTest;
const tibber_parse_1 = require("../learning/price_forecast/tibber_parse");
exports.OPERATOR_MS_PER_15MIN = tibber_parse_1.MS_PER_15MIN;
function isoFromMs(ms) {
    return new Date(ms).toISOString();
}
function slotEndMsFromStart(startMs) {
    return startMs + exports.OPERATOR_MS_PER_15MIN;
}
function isValidIsoTimestamp(iso) {
    if (!iso.trim())
        return false;
    const ms = Date.parse(iso);
    return Number.isFinite(ms);
}
const FORMATTER_OPTIONS = {
    timeZone: "UTC",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
};
/** Cache formatters — creating one per minute-scan blew RSS by hundreds of MiB. */
const zonedFormatters = new Map();
function createFormatter(timezone) {
    return new Intl.DateTimeFormat("en-US", { ...FORMATTER_OPTIONS, timeZone: timezone });
}
/**
 * Resolve a cached formatter for a timezone.
 * Invalid zones are not cached; callers fall back to UTC for conversion.
 */
function zonedFormatter(timezone) {
    const key = timezone.trim() || "UTC";
    const cached = zonedFormatters.get(key);
    if (cached)
        return cached;
    try {
        const fmt = createFormatter(key);
        // Validate eagerly so bad zones never enter the cache.
        fmt.formatToParts(new Date());
        zonedFormatters.set(key, fmt);
        return fmt;
    }
    catch {
        if (key === "UTC") {
            return createFormatter("UTC");
        }
        return zonedFormatter("UTC");
    }
}
function zonedParts(ms, timezone) {
    const parts = zonedFormatter(timezone).formatToParts(new Date(ms));
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
/**
 * ISO/UTC → deutsche Ortszeit-Anzeige (TT.MM.JJJJ, HH:MM) in `timezone`.
 * Für Briefing/KI — nie die UTC-Ziffern aus `…Z` als lokale Uhrzeit vorlesen.
 */
function formatLocalDateTimeDe(isoOrMs, timezone) {
    const ms = typeof isoOrMs === "number" ? isoOrMs : Date.parse(isoOrMs);
    if (!Number.isFinite(ms))
        return null;
    const p = zonedParts(ms, timezone.trim() || "Europe/Berlin");
    return (`${String(p.day).padStart(2, "0")}.${String(p.month).padStart(2, "0")}.${p.year}, ` +
        `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`);
}
/** Versatz (ms) der Zeitzone gegenüber UTC zum Zeitpunkt `ms`, auf volle Minuten. */
function zoneOffsetMs(ms, timezone) {
    const p = zonedParts(ms, timezone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0) - Math.floor(ms / 60_000) * 60_000;
}
const isoLocalMemo = new Map();
const ISO_LOCAL_MEMO_MAX = 4000;
/**
 * Ortszeit (Datum, Stunde, Minute) → ISO/UTC. Früheste passende Zeit; gibt es die Ortszeit nicht
 * (Zeitumstellung), wird die Zeit als UTC gelesen. Direkte Berechnung über die Zeitzonen-Versätze
 * des Tages statt Minutensuche (die Suche erzeugte pro Aufruf tausende Objekte).
 */
function isoAtTimezoneLocal(dateKey, hour, minute, timezone) {
    const memoKey = `${timezone}|${dateKey}|${hour}|${minute}`;
    const hit = isoLocalMemo.get(memoKey);
    if (hit !== undefined)
        return hit;
    const [y, mo, da] = dateKey.split("-").map((x) => parseInt(x, 10));
    const wall = Date.UTC(y, mo - 1, da, hour, minute, 0);
    const offsets = new Set([zoneOffsetMs(wall - 24 * 3_600_000, timezone), zoneOffsetMs(wall + 24 * 3_600_000, timezone)]);
    let best = null;
    for (const off of offsets) {
        const ms = wall - off;
        const p = zonedParts(ms, timezone);
        if (p.year === y && p.month === mo && p.day === da && p.hour === hour && p.minute === minute) {
            if (best === null || ms < best)
                best = ms;
        }
    }
    const out = isoFromMs(best ?? wall);
    if (isoLocalMemo.size >= ISO_LOCAL_MEMO_MAX)
        isoLocalMemo.clear();
    isoLocalMemo.set(memoKey, out);
    return out;
}
function addDaysToDateKey(dateKey, days) {
    const [y, mo, da] = dateKey.split("-").map((x) => parseInt(x, 10));
    const d = new Date(Date.UTC(y, mo - 1, da + days, 12, 0, 0));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function zonedFormatterCacheSizeForTest() {
    return zonedFormatters.size;
}
function resetZonedFormatterCacheForTest() {
    zonedFormatters.clear();
    isoLocalMemo.clear();
}
function zonedFormatterCacheHasForTest(timezone) {
    return zonedFormatters.has(timezone);
}
