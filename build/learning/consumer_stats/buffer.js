"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dayRecordFromEntry = exports.snapshotFromEntry = exports.ingestConsumerStatsTick = exports.resolveActivePowerW = exports.computeTickDeltaSec = exports.emptyConsumerEntry = void 0;
const day_1 = require("../energy_daily_rollup/day");
const types_1 = require("./types");
function emptyConsumerEntry(consumerKey, nowMs) {
    const dateKey = (0, day_1.localDateKey)(new Date(nowMs));
    return {
        consumerKey,
        totalRuntimeSec: 0,
        totalEnergyKwh: 0,
        todayDateKey: dateKey,
        todayRuntimeSec: 0,
        todayEnergyKwh: 0,
        sessionRuntimeSec: 0,
        sessionEnergyKwh: 0,
        lastSessionRuntimeSec: 0,
        lastSessionEnergyKwh: 0,
        lastTickMs: nowMs,
        wasActive: false,
        days: {},
    };
}
exports.emptyConsumerEntry = emptyConsumerEntry;
function computeTickDeltaSec(nowMs, lastTickMs, maxDeltaSec = types_1.MAX_TICK_DELTA_SEC) {
    if (lastTickMs <= 0) {
        return 0;
    }
    const raw = (nowMs - lastTickMs) / 1000;
    if (raw <= 0) {
        return 0;
    }
    return Math.min(raw, maxDeltaSec);
}
exports.computeTickDeltaSec = computeTickDeltaSec;
function resolveActivePowerW(input) {
    if (input.measuredPowerW !== null && input.measuredPowerW >= input.powerOnThresholdW) {
        return input.measuredPowerW;
    }
    return input.commandedPowerW > 0 ? input.commandedPowerW : 0;
}
exports.resolveActivePowerW = resolveActivePowerW;
function rolloverDay(entry, dateKey) {
    if (entry.todayDateKey === dateKey) {
        return entry;
    }
    const nextDays = { ...entry.days };
    if (entry.todayRuntimeSec > 0 || entry.todayEnergyKwh > 0) {
        nextDays[entry.todayDateKey] = {
            dateKey: entry.todayDateKey,
            runtimeSec: entry.todayRuntimeSec,
            energyKwh: entry.todayEnergyKwh,
            lastTickMs: entry.lastTickMs,
        };
    }
    return {
        ...entry,
        todayDateKey: dateKey,
        todayRuntimeSec: 0,
        todayEnergyKwh: 0,
        days: nextDays,
    };
}
function startSession(entry) {
    return {
        ...entry,
        sessionRuntimeSec: 0,
        sessionEnergyKwh: 0,
    };
}
function finalizeSession(entry) {
    if (!entry.wasActive) {
        return entry;
    }
    return {
        ...entry,
        lastSessionRuntimeSec: entry.sessionRuntimeSec,
        lastSessionEnergyKwh: entry.sessionEnergyKwh,
        sessionRuntimeSec: 0,
        sessionEnergyKwh: 0,
    };
}
function ingestConsumerStatsTick(entry, input, config) {
    const dateKey = (0, day_1.localDateKey)(new Date(input.nowMs));
    let next = rolloverDay(entry, dateKey);
    if (!config.enabled) {
        return {
            ...next,
            lastTickMs: input.nowMs,
            wasActive: input.countable,
        };
    }
    const deltaSec = computeTickDeltaSec(input.nowMs, next.lastTickMs);
    const powerW = resolveActivePowerW({
        measuredPowerW: input.measuredPowerW,
        commandedPowerW: input.commandedPowerW,
        powerOnThresholdW: input.powerOnThresholdW ?? 50,
    });
    if (next.wasActive && deltaSec > 0) {
        if (config.trackRuntime) {
            next = {
                ...next,
                totalRuntimeSec: next.totalRuntimeSec + deltaSec,
                todayRuntimeSec: next.todayRuntimeSec + deltaSec,
                sessionRuntimeSec: next.sessionRuntimeSec + deltaSec,
            };
        }
        if (config.trackEnergy && powerW > 0) {
            const deltaKwh = (powerW * deltaSec) / 3_600_000;
            next = {
                ...next,
                totalEnergyKwh: roundKwh(next.totalEnergyKwh + deltaKwh),
                todayEnergyKwh: roundKwh(next.todayEnergyKwh + deltaKwh),
                sessionEnergyKwh: roundKwh(next.sessionEnergyKwh + deltaKwh),
            };
        }
    }
    if (!input.countable && next.wasActive) {
        next = finalizeSession(next);
    }
    if (input.countable && !next.wasActive) {
        next = startSession(next);
    }
    return {
        ...next,
        lastTickMs: input.nowMs,
        wasActive: input.countable,
    };
}
exports.ingestConsumerStatsTick = ingestConsumerStatsTick;
function snapshotFromEntry(entry, config, nowMs, deviceActive = false) {
    return {
        consumerKey: entry.consumerKey,
        tracking: config.enabled,
        deviceActive,
        todayRuntimeSec: entry.todayRuntimeSec,
        todayEnergyKwh: entry.todayEnergyKwh,
        totalRuntimeSec: entry.totalRuntimeSec + config.runtimeOffsetSec,
        totalEnergyKwh: roundKwh(entry.totalEnergyKwh + config.energyOffsetKwh),
        sessionRuntimeSec: entry.sessionRuntimeSec,
        sessionEnergyKwh: entry.sessionEnergyKwh,
        lastSessionRuntimeSec: entry.lastSessionRuntimeSec,
        lastSessionEnergyKwh: entry.lastSessionEnergyKwh,
        lastUpdated: new Date(nowMs).toISOString(),
    };
}
exports.snapshotFromEntry = snapshotFromEntry;
function dayRecordFromEntry(entry) {
    if (entry.todayRuntimeSec <= 0 && entry.todayEnergyKwh <= 0) {
        return null;
    }
    return {
        dateKey: entry.todayDateKey,
        runtimeSec: entry.todayRuntimeSec,
        energyKwh: entry.todayEnergyKwh,
        lastTickMs: entry.lastTickMs,
    };
}
exports.dayRecordFromEntry = dayRecordFromEntry;
function roundKwh(value) {
    return Math.round(value * 1000) / 1000;
}
