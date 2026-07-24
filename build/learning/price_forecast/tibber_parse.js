"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dateKeyFromMs = exports.targetDateForTodayFreeze = exports.targetDateForTomorrowFreeze = exports.diagnoseTibberPriceJson = exports.parseTibberPriceJsonToHourlySlots = exports.parseTibberPriceJsonTo15MinSlots = exports.MS_PER_15MIN = void 0;
exports.MS_PER_15MIN = 15 * 60 * 1000;
function asNum(v) {
    if (v === null || v === undefined || v === "")
        return null;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : null;
}
function parseStartsAtMs(raw) {
    if (typeof raw !== "string" || !raw.trim())
        return null;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : null;
}
function hourStartMs(ts) {
    return Math.floor(ts / 3_600_000) * 3_600_000;
}
function dateKeyFromMs(ts) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}
exports.dateKeyFromMs = dateKeyFromMs;
function tomorrowDateKey(ref) {
    const d = new Date(ref);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + 1);
    return dateKeyFromMs(d.getTime());
}
function parseTibberPriceEntries(raw) {
    let parsed = raw;
    if (typeof raw === "string") {
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            return [];
        }
    }
    if (!Array.isArray(parsed)) {
        return [];
    }
    return parsed.filter((entry) => entry != null && typeof entry === "object");
}
/** Parse Tibber PricesToday/Tomorrow JSON → 15-min-Slots in ct/kWh (keine Stundenaggregation). */
function parseTibberPriceJsonTo15MinSlots(raw, options = {}) {
    const slots = [];
    const seen = new Set();
    for (const row of parseTibberPriceEntries(raw)) {
        const totalEur = asNum(row.total);
        const startsMs = parseStartsAtMs(row.startsAt ?? row.starts_at);
        if (totalEur === null || startsMs === null || totalEur < 0 || totalEur > 5) {
            continue;
        }
        if (options.minStartMs != null && startsMs < options.minStartMs)
            continue;
        if (options.maxStartMs != null && startsMs > options.maxStartMs)
            continue;
        if (seen.has(startsMs))
            continue;
        seen.add(startsMs);
        slots.push({
            slotStartMs: startsMs,
            priceCtPerKwh: Math.round(totalEur * 100 * 1000) / 1000,
        });
    }
    return slots.sort((a, b) => a.slotStartMs - b.slotStartMs);
}
exports.parseTibberPriceJsonTo15MinSlots = parseTibberPriceJsonTo15MinSlots;
/** Parse Tibber PricesToday/Tomorrow JSON → stündliche Forecast-Slots in ct/kWh. */
function parseTibberPriceJsonToHourlySlots(raw, targetDateKey) {
    const byHour = new Map();
    for (const row of parseTibberPriceEntries(raw)) {
        const totalEur = asNum(row.total);
        const startsMs = parseStartsAtMs(row.startsAt ?? row.starts_at);
        if (totalEur === null || startsMs === null || totalEur < 0 || totalEur > 5) {
            continue;
        }
        if (dateKeyFromMs(startsMs) !== targetDateKey) {
            continue;
        }
        const bucket = hourStartMs(startsMs);
        const list = byHour.get(bucket) ?? [];
        list.push(totalEur * 100);
        byHour.set(bucket, list);
    }
    const slots = [];
    for (const [hourStart, values] of byHour.entries()) {
        if (values.length === 0)
            continue;
        const avgCt = values.reduce((a, b) => a + b, 0) / values.length;
        slots.push({ hourStartMs: hourStart, forecastCtPerKwh: Math.round(avgCt * 1000) / 1000 });
    }
    return slots.sort((a, b) => a.hourStartMs - b.hourStartMs);
}
exports.parseTibberPriceJsonToHourlySlots = parseTibberPriceJsonToHourlySlots;
/** Read-only diagnosis of a Tibber PricesToday/Tomorrow JSON payload vs. a target date — for log output only. */
function diagnoseTibberPriceJson(raw, targetDateKey) {
    const rawType = typeof raw;
    const entries = parseTibberPriceEntries(raw);
    let validRows = 0;
    let rejectedByRange = 0;
    let rejectedByStartsAt = 0;
    let matchedTargetCount = 0;
    const dateKeySet = new Set();
    for (const row of entries) {
        const totalEur = asNum(row.total);
        const startsMs = parseStartsAtMs(row.startsAt ?? row.starts_at);
        if (startsMs === null) {
            rejectedByStartsAt += 1;
            continue;
        }
        if (totalEur === null || totalEur < 0 || totalEur > 5) {
            rejectedByRange += 1;
            continue;
        }
        validRows += 1;
        const key = dateKeyFromMs(startsMs);
        dateKeySet.add(key);
        if (key === targetDateKey)
            matchedTargetCount += 1;
    }
    return {
        rawType,
        totalRows: entries.length,
        validRows,
        rejectedByRange,
        rejectedByStartsAt,
        distinctDateKeys: [...dateKeySet].sort(),
        targetDateKey,
        matchedTargetCount,
    };
}
exports.diagnoseTibberPriceJson = diagnoseTibberPriceJson;
function targetDateForTomorrowFreeze(ref) {
    return tomorrowDateKey(ref);
}
exports.targetDateForTomorrowFreeze = targetDateForTomorrowFreeze;
function targetDateForTodayFreeze(ref) {
    const d = new Date(ref);
    d.setHours(12, 0, 0, 0);
    return dateKeyFromMs(d.getTime());
}
exports.targetDateForTodayFreeze = targetDateForTodayFreeze;
