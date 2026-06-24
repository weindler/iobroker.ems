"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMatchedPairs = exports.runPriceForecastFreeze = exports.fetchActualCtAtHour = void 0;
const state_util_1 = require("../../ems_light/state_util");
const freeze_1 = require("../pv_bias/freeze");
const history_query_1 = require("../history_query");
const units_1 = require("../price_common/units");
const constants_1 = require("./constants");
const tibber_parse_1 = require("./tibber_parse");
const persist_1 = require("./persist");
async function readForeignVal(host, stateId) {
    if (!stateId)
        return null;
    const tryRead = async (fn) => {
        if (!fn)
            return null;
        try {
            const st = await fn.call(host, stateId);
            return st?.val ?? null;
        }
        catch {
            return null;
        }
    };
    const foreign = await tryRead(host.getForeignStateAsync);
    if (foreign !== null && foreign !== undefined)
        return foreign;
    return tryRead(host.getStateAsync);
}
async function fetchActualCtAtHour(host, stateId, unit, hourStartMs) {
    const rows = await (0, history_query_1.fetchHistoryRowsInRange)(host, stateId, hourStartMs, hourStartMs + constants_1.MS_PER_HOUR, 20, history_query_1.HISTORY_CHUNK_TIMEOUT_MS);
    if (rows.length === 0) {
        return null;
    }
    let best = null;
    for (const row of rows) {
        const ts = typeof row?.ts === "number" ? row.ts : null;
        const raw = (0, state_util_1.asNum)(row?.val);
        if (ts === null || !(0, units_1.isValidPriceValue)(raw, unit))
            continue;
        if (!best || Math.abs(ts - hourStartMs) < Math.abs(best.ts - hourStartMs)) {
            best = { ts, val: raw };
        }
    }
    if (!best)
        return null;
    return Math.round((0, units_1.toCtPerKwh)((0, units_1.toEurPerKwh)(best.val, unit)) * 1000) / 1000;
}
exports.fetchActualCtAtHour = fetchActualCtAtHour;
async function runFreezeTrack(host, cfg, track) {
    if (!track.jsonStateId || !host.getAbsolutePath) {
        return false;
    }
    const now = new Date();
    const frozenAtSt = await host.getStateAsync(track.frozenAtStateId);
    const frozenAtTs = typeof frozenAtSt?.val === "string" ? frozenAtSt.val : null;
    const decision = (0, freeze_1.decideForecastFreeze)(now, cfg.freezeEnabled, track.freezeTime, frozenAtTs);
    await host.setStateAsync(track.statusStateId, { val: decision.status, ack: true });
    await host.setStateAsync(track.reasonStateId, { val: decision.reason, ack: true });
    if (!decision.shouldFreeze) {
        return false;
    }
    const raw = await readForeignVal(host, track.jsonStateId);
    const targetDate = track.targetDate(now);
    const slots = (0, tibber_parse_1.parseTibberPriceJsonToHourlySlots)(raw, targetDate);
    if (slots.length === 0) {
        host.log.warn(`Price Forecast Freeze (${track.label}): keine Slots für ${targetDate}`);
        await host.setStateAsync(track.statusStateId, { val: "error", ack: true });
        await host.setStateAsync(track.reasonStateId, {
            val: `Keine Forecast-Slots für ${targetDate} (${track.label}).`,
            ack: true,
        });
        return false;
    }
    const baseDir = host.getAbsolutePath("learning/price_forecast");
    const payload = {
        module: constants_1.MODULE_TAG,
        frozen_at: now.toISOString(),
        freeze_date: (0, freeze_1.localDateKey)(now),
        target_date: targetDate,
        forecast_source: track.jsonStateId,
        slots,
    };
    await (0, persist_1.writeForecastFreezeFile)(baseDir, payload);
    await host.setStateAsync(track.frozenAtStateId, { val: now.toISOString(), ack: true });
    await host.setStateAsync(track.targetDateStateId, { val: targetDate, ack: true });
    await host.setStateAsync(track.statusStateId, { val: "ready", ack: true });
    await host.setStateAsync(track.reasonStateId, {
        val: `${track.label}: Forecast für ${targetDate} eingefroren (${slots.length}h).`,
        ack: true,
    });
    host.log.info(`Price Forecast Freeze (${track.label}): ${targetDate} ${slots.length} Stunden`);
    return true;
}
async function runPriceForecastFreeze(host, cfg) {
    if (!cfg.freezeEnabled || !host.getAbsolutePath) {
        return;
    }
    if (cfg.todayFreezeEnabled && cfg.todayJsonStateId) {
        await runFreezeTrack(host, cfg, {
            label: "heute",
            jsonStateId: cfg.todayJsonStateId,
            freezeTime: cfg.todayFreezeTime,
            frozenAtStateId: "learning.price_forecast.frozen_today_at_ts",
            targetDateStateId: "learning.price_forecast.frozen_today_target_date",
            statusStateId: "learning.price_forecast.freeze_today_status",
            reasonStateId: "learning.price_forecast.freeze_today_reason",
            targetDate: tibber_parse_1.targetDateForTodayFreeze,
        });
    }
    if (cfg.tomorrowJsonStateId) {
        await runFreezeTrack(host, cfg, {
            label: "morgen",
            jsonStateId: cfg.tomorrowJsonStateId,
            freezeTime: cfg.tomorrowFreezeTime,
            frozenAtStateId: "learning.price_forecast.frozen_at_ts",
            targetDateStateId: "learning.price_forecast.frozen_target_date",
            statusStateId: "learning.price_forecast.freeze_status",
            reasonStateId: "learning.price_forecast.freeze_reason",
            targetDate: tibber_parse_1.targetDateForTomorrowFreeze,
        });
    }
}
exports.runPriceForecastFreeze = runPriceForecastFreeze;
async function buildMatchedPairs(host, cfg) {
    if (!host.getAbsolutePath) {
        return [];
    }
    const baseDir = host.getAbsolutePath("learning/price_forecast");
    const freezeFiles = await (0, persist_1.readForecastFreezeFiles)(baseDir, cfg.lookbackDays);
    const unit = await (0, units_1.resolvePriceUnit)(host, cfg.actualStateId);
    const nowMs = Date.now();
    const pairs = [];
    for (const file of freezeFiles) {
        for (const slot of file.slots) {
            if (slot.hourStartMs + constants_1.MS_PER_HOUR > nowMs) {
                continue;
            }
            const actualCt = await fetchActualCtAtHour(host, cfg.actualStateId, unit, slot.hourStartMs);
            if (actualCt === null)
                continue;
            const absErrorCt = Math.abs(slot.forecastCtPerKwh - actualCt);
            pairs.push({
                targetDate: file.target_date,
                hourStartMs: slot.hourStartMs,
                forecastCt: slot.forecastCtPerKwh,
                actualCt,
                absErrorCt: Math.round(absErrorCt * 1000) / 1000,
            });
        }
    }
    return pairs;
}
exports.buildMatchedPairs = buildMatchedPairs;
