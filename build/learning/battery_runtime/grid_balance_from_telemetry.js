"use strict";
/**
 * Netzausgleichs-Energie aus EMS-Day-Telemetry rekonstruieren.
 * Keine Schätzung: nur Slots mit gesetztem kWh (inkl. gemessener 0) werden zu Leistungspunkten.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.dayTelemetryDirFromHost = exports.loadGridBalancePowerFromDayTelemetry = exports.powerPointsFromGridBalanceDay = exports.gridBalanceKwhSlotToPowerW = void 0;
const constants_1 = require("../day_telemetry/constants");
const persist_1 = require("../day_telemetry/persist");
const time_1 = require("../../operator/time");
function gridBalanceKwhSlotToPowerW(kwh, slotWidthMs) {
    if (!(slotWidthMs > 0) || !Number.isFinite(kwh))
        return 0;
    return (kwh * 3_600_000_000) / slotWidthMs;
}
exports.gridBalanceKwhSlotToPowerW = gridBalanceKwhSlotToPowerW;
/**
 * Wandelt Slot-kWh in energieerhaltende Leistungspunkte (Slot-Mitte).
 * null-Slots werden ausgelassen (missing), 0 bleibt 0 W.
 */
function powerPointsFromGridBalanceDay(day) {
    const bucket = day.buckets.gridBalanceDischargeKwh;
    if (!Array.isArray(bucket))
        return [];
    const slotMs = day.slotWidthMs > 0 ? day.slotWidthMs : constants_1.DAY_TELEMETRY_SLOT_MS;
    const points = [];
    for (let i = 0; i < bucket.length; i++) {
        const kwh = bucket[i];
        if (kwh == null || !Number.isFinite(kwh) || kwh < 0)
            continue;
        const slotStart = day.startMs + i * slotMs;
        points.push({
            ts: slotStart + slotMs / 2,
            powerW: gridBalanceKwhSlotToPowerW(kwh, slotMs),
        });
    }
    return points;
}
exports.powerPointsFromGridBalanceDay = powerPointsFromGridBalanceDay;
async function loadGridBalancePowerFromDayTelemetry(baseDir, lookbackDays, now = new Date(), timezone = "Europe/Berlin") {
    if (!baseDir || lookbackDays <= 0) {
        return { points: [], observedDayCount: 0 };
    }
    const todayKey = (0, time_1.localDateKeyInTimezone)(now, timezone);
    const oldestKey = (0, time_1.addDaysToDateKey)(todayKey, -(lookbackDays - 1));
    let keys;
    try {
        keys = await (0, persist_1.listDayTelemetryDateKeys)(baseDir);
    }
    catch {
        return { points: [], observedDayCount: 0 };
    }
    const points = [];
    let observedDayCount = 0;
    for (const dateKey of keys) {
        if (dateKey < oldestKey || dateKey > todayKey)
            continue;
        const day = await (0, persist_1.readDayTelemetryDay)(baseDir, dateKey);
        if (!day)
            continue;
        const dayPoints = powerPointsFromGridBalanceDay(day);
        if (dayPoints.length > 0) {
            observedDayCount++;
            points.push(...dayPoints);
        }
    }
    points.sort((a, b) => a.ts - b.ts);
    return { points, observedDayCount };
}
exports.loadGridBalancePowerFromDayTelemetry = loadGridBalancePowerFromDayTelemetry;
function dayTelemetryDirFromHost(getAbsolutePath) {
    if (!getAbsolutePath)
        return undefined;
    return getAbsolutePath(constants_1.DAY_TELEMETRY_CATEGORY);
}
exports.dayTelemetryDirFromHost = dayTelemetryDirFromHost;
