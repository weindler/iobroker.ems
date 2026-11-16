"use strict";
/**
 * Netzausgleichs-Energie aus EMS-Day-Telemetry rekonstruieren.
 * Keine Schätzung: nur Slots mit gesetztem kWh (inkl. gemessener 0) werden zu Leistungspunkten.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.gridBalanceKwhSlotToPowerW = gridBalanceKwhSlotToPowerW;
exports.powerPointsFromGridBalanceDay = powerPointsFromGridBalanceDay;
exports.loadGridBalancePowerFromDayTelemetry = loadGridBalancePowerFromDayTelemetry;
exports.dayTelemetryDirFromHost = dayTelemetryDirFromHost;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const constants_1 = require("../day_telemetry/constants");
const persist_1 = require("../day_telemetry/persist");
const time_1 = require("../../operator/time");
function gridBalanceKwhSlotToPowerW(kwh, slotWidthMs) {
    if (!(slotWidthMs > 0) || !Number.isFinite(kwh))
        return 0;
    return (kwh * 3_600_000_000) / slotWidthMs;
}
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
        let kwh = bucket[i];
        if (kwh == null || !Number.isFinite(kwh) || kwh < 0)
            continue;
        if (day.gridBalanceEnergyKind !== "additional_offset") {
            const house = day.buckets.houseTotalKwh?.[i];
            const pv = day.buckets.pvKwh?.[i];
            if (house == null || pv == null || !Number.isFinite(house) || !Number.isFinite(pv))
                continue;
            kwh = Math.max(0, kwh - Math.max(0, house - pv));
        }
        const slotStart = day.startMs + i * slotMs;
        points.push({
            ts: slotStart + slotMs / 2,
            powerW: gridBalanceKwhSlotToPowerW(kwh, slotMs),
        });
    }
    return points;
}
/** Tage jünger als dies (in Tagen) werden immer neu gelesen; ältere sind abgeschlossen und unveränderlich. */
const CACHE_SETTLED_DAYS = 2;
async function readDaysCache(file) {
    const empty = { version: 1, days: {} };
    if (!file)
        return empty;
    try {
        const parsed = JSON.parse(await fs.readFile(file, "utf8"));
        return parsed && parsed.version === 1 && parsed.days && typeof parsed.days === "object" ? parsed : empty;
    }
    catch {
        return empty;
    }
}
async function writeDaysCache(file, cache) {
    try {
        await fs.mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(cache), "utf8");
        await fs.rename(tmp, file);
    }
    catch {
        /* Cache ist nur Beschleunigung; Fehler dürfen das Lernen nicht stören. */
    }
}
async function loadGridBalancePowerFromDayTelemetry(baseDir, lookbackDays, now = new Date(), timezone = "Europe/Berlin", cacheFile) {
    if (!baseDir || lookbackDays <= 0) {
        return { points: [], observedDayCount: 0 };
    }
    const todayKey = (0, time_1.localDateKeyInTimezone)(now, timezone);
    const oldestKey = (0, time_1.addDaysToDateKey)(todayKey, -(lookbackDays - 1));
    const settledBefore = (0, time_1.addDaysToDateKey)(todayKey, -CACHE_SETTLED_DAYS);
    let keys;
    try {
        keys = await (0, persist_1.listDayTelemetryDateKeys)(baseDir);
    }
    catch {
        return { points: [], observedDayCount: 0 };
    }
    const cache = await readDaysCache(cacheFile);
    let cacheChanged = false;
    for (const key of Object.keys(cache.days)) {
        if (key < oldestKey) {
            delete cache.days[key];
            cacheChanged = true;
        }
    }
    const points = [];
    let observedDayCount = 0;
    for (const dateKey of keys) {
        if (dateKey < oldestKey || dateKey > todayKey)
            continue;
        const settled = dateKey < settledBefore;
        const cached = settled ? cache.days[dateKey] : undefined;
        let dayPoints;
        if (cached) {
            dayPoints = cached.map(([ts, powerW]) => ({ ts, powerW }));
        }
        else {
            const day = await (0, persist_1.readDayTelemetryDay)(baseDir, dateKey);
            if (!day)
                continue;
            dayPoints = powerPointsFromGridBalanceDay(day);
            if (settled) {
                cache.days[dateKey] = dayPoints.map((pt) => [Math.round(pt.ts), Math.round(pt.powerW * 100) / 100]);
                cacheChanged = true;
            }
        }
        if (dayPoints.length > 0) {
            observedDayCount++;
            points.push(...dayPoints);
        }
    }
    if (cacheFile && cacheChanged)
        await writeDaysCache(cacheFile, cache);
    points.sort((a, b) => a.ts - b.ts);
    return { points, observedDayCount };
}
function dayTelemetryDirFromHost(getAbsolutePath) {
    if (!getAbsolutePath)
        return undefined;
    return getAbsolutePath(constants_1.DAY_TELEMETRY_CATEGORY);
}
