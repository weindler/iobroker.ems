"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadDailyPersist = exports.backfillDailyPersist = exports.runActualDailySnapshot = exports.recordForecastDailySnapshot = exports.shouldCaptureActualSnapshot = exports.actualSnapshotCapturedForDate = void 0;
const config_1 = require("./config");
const daily_persist_1 = require("./daily_persist");
const history_1 = require("./history");
const dates_1 = require("./dates");
function persistDir(host) {
    if (typeof host.getAbsolutePath !== "function") {
        return null;
    }
    return host.getAbsolutePath("learning/pv_bias");
}
function actualSnapshotCapturedForDate(persist, dateKey) {
    const row = (0, daily_persist_1.dailyRecord)(persist, dateKey);
    return row?.actualKwh != null && row.actualCapturedAt != null;
}
exports.actualSnapshotCapturedForDate = actualSnapshotCapturedForDate;
/** Nach Snapshot-Zeit am selben Kalendertag, noch nicht gespeichert. */
function shouldCaptureActualSnapshot(now, snapshotTime, alreadyCapturedToday) {
    if (alreadyCapturedToday) {
        return false;
    }
    const parsed = (0, config_1.parseFreezeTimeHHMM)(snapshotTime);
    if (!parsed) {
        return false;
    }
    const snapshotMs = new Date(now);
    snapshotMs.setHours(parsed.hours, parsed.minutes, 0, 0);
    return now.getTime() >= snapshotMs.getTime();
}
exports.shouldCaptureActualSnapshot = shouldCaptureActualSnapshot;
async function recordForecastDailySnapshot(host, cfg, forecastKwh, source, now = new Date()) {
    const dir = persistDir(host);
    if (!dir || !cfg.freezeEnabled) {
        return;
    }
    const dateKey = (0, dates_1.localDateKey)(now);
    const persist = await (0, daily_persist_1.readDailyPersist)(dir);
    const updated = (0, daily_persist_1.upsertDailyRecord)(persist, {
        date: dateKey,
        actualKwh: (0, daily_persist_1.dailyRecord)(persist, dateKey)?.actualKwh ?? null,
        actualCapturedAt: (0, daily_persist_1.dailyRecord)(persist, dateKey)?.actualCapturedAt ?? null,
        forecastKwh,
        forecastCapturedAt: now.toISOString(),
        forecastSource: source,
        actualSource: (0, daily_persist_1.dailyRecord)(persist, dateKey)?.actualSource,
    });
    await (0, daily_persist_1.writeDailyPersist)(dir, updated);
}
exports.recordForecastDailySnapshot = recordForecastDailySnapshot;
async function runActualDailySnapshot(host, cfg, now = new Date()) {
    if (!cfg.actualSnapshotEnabled || !cfg.historyActualStateId) {
        return false;
    }
    const dir = persistDir(host);
    if (!dir) {
        return false;
    }
    const persist = await (0, daily_persist_1.readDailyPersist)(dir);
    const todayKey = (0, dates_1.localDateKey)(now);
    if (!shouldCaptureActualSnapshot(now, cfg.actualSnapshotTime, actualSnapshotCapturedForDate(persist, todayKey))) {
        return false;
    }
    const actualKwh = await (0, history_1.readStateNum)(host, cfg.historyActualStateId);
    if (actualKwh === null || actualKwh <= 0) {
        host.log.warn(`PV-Bias Snapshot ${cfg.actualSnapshotTime}: DAY_ENERGY fehlt oder ≤ 0 — kein Ist-Snapshot.`);
        return false;
    }
    const updated = (0, daily_persist_1.upsertDailyRecord)(persist, {
        date: todayKey,
        actualKwh,
        actualCapturedAt: now.toISOString(),
        actualSource: cfg.historyActualStateId,
        forecastKwh: (0, daily_persist_1.dailyRecord)(persist, todayKey)?.forecastKwh ?? null,
        forecastCapturedAt: (0, daily_persist_1.dailyRecord)(persist, todayKey)?.forecastCapturedAt ?? null,
        forecastSource: (0, daily_persist_1.dailyRecord)(persist, todayKey)?.forecastSource,
    });
    await (0, daily_persist_1.writeDailyPersist)(dir, updated);
    host.log.info(`PV-Bias Snapshot: Ist ${actualKwh} kWh für ${todayKey} um ${now.toISOString()} gespeichert.`);
    return true;
}
exports.runActualDailySnapshot = runActualDailySnapshot;
/** Fehlende Tage aus History nachziehen (letzter Tageswert, kein MAX). */
async function backfillDailyPersist(host, cfg, maxDays = 30) {
    const dir = persistDir(host);
    if (!dir || !cfg.historyActualStateId) {
        return 0;
    }
    let persist = await (0, daily_persist_1.readDailyPersist)(dir);
    let filled = 0;
    const forecastStateId = cfg.historyForecastStateId || cfg.rawTodayStateId || "learning.pv_bias.frozen_today_kwh";
    for (let dayOffset = 1; dayOffset < maxDays; dayOffset++) {
        const { start, end } = (0, history_1.dayBoundsMs)(dayOffset);
        const dateKey = (0, dates_1.localDateKey)(new Date(start));
        const existing = (0, daily_persist_1.dailyRecord)(persist, dateKey);
        let actualKwh = existing?.actualKwh ?? null;
        let forecastKwh = existing?.forecastKwh ?? null;
        let changed = false;
        if (actualKwh === null) {
            const last = await (0, history_1.fetchDayLastValue)(host, cfg.historyActualStateId, start, end);
            if (last !== null && last > 0) {
                actualKwh = last;
                changed = true;
            }
        }
        if (forecastKwh === null && forecastStateId) {
            const freezeMs = (0, dates_1.freezeInstantMs)(cfg.freezeTime, new Date(start));
            if (freezeMs !== null) {
                const near = await (0, history_1.fetchDayValueNearTime)(host, forecastStateId, freezeMs, freezeMs + 2 * 3_600_000);
                if (near !== null && near > 0) {
                    forecastKwh = near;
                    changed = true;
                }
            }
        }
        if (!changed) {
            continue;
        }
        persist = (0, daily_persist_1.upsertDailyRecord)(persist, {
            date: dateKey,
            actualKwh,
            actualCapturedAt: existing?.actualCapturedAt ?? (actualKwh !== null ? `${dateKey}T23:58:00.000Z` : null),
            forecastKwh,
            forecastCapturedAt: existing?.forecastCapturedAt ?? (forecastKwh !== null ? `${dateKey}T${cfg.freezeTime}:00.000Z` : null),
            actualSource: existing?.actualSource ?? cfg.historyActualStateId,
            forecastSource: existing?.forecastSource ?? forecastStateId,
        });
        filled++;
    }
    if (filled > 0) {
        await (0, daily_persist_1.writeDailyPersist)(dir, persist);
        host.log.info(`PV-Bias: ${filled} Tages-Snapshot(s) aus History nachgezogen (letzter Tageswert).`);
    }
    return filled;
}
exports.backfillDailyPersist = backfillDailyPersist;
async function loadDailyPersist(host) {
    const dir = persistDir(host);
    if (!dir) {
        return null;
    }
    return (0, daily_persist_1.readDailyPersist)(dir);
}
exports.loadDailyPersist = loadDailyPersist;
