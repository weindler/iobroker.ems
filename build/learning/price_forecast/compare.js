"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMatchedPairs = exports.runPriceForecastFreeze = exports.fetchActualCtAtHour = void 0;
const state_util_1 = require("../../ems_light/state_util");
const freeze_1 = require("../pv_bias/freeze");
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
async function withHistoryTimeout(promise, timeoutMs) {
    let timer = null;
    try {
        return await Promise.race([
            promise,
            new Promise((resolve) => {
                timer = setTimeout(() => resolve(null), timeoutMs);
            }),
        ]);
    }
    catch {
        return null;
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
async function fetchActualCtAtHour(host, stateId, unit, hourStartMs) {
    const res = await withHistoryTimeout(host.getHistoryAsync(stateId, {
        start: hourStartMs,
        end: hourStartMs + constants_1.MS_PER_HOUR,
        aggregate: "onchange",
        ignoreNull: true,
        count: 20,
        returnNewestEntries: true,
        removeBorderValues: true,
    }), constants_1.HISTORY_QUERY_TIMEOUT_MS);
    if (!res?.result || !Array.isArray(res.result) || res.result.length === 0) {
        return null;
    }
    let best = null;
    for (const row of res.result) {
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
async function runPriceForecastFreeze(host, cfg) {
    if (!cfg.freezeEnabled || !host.getAbsolutePath) {
        return;
    }
    const now = new Date();
    const frozenAtSt = await host.getStateAsync("learning.price_forecast.frozen_at_ts");
    const frozenAtTs = typeof frozenAtSt?.val === "string" ? frozenAtSt.val : null;
    const decision = (0, freeze_1.decideForecastFreeze)(now, cfg.freezeEnabled, cfg.freezeTime, frozenAtTs);
    await host.setStateAsync("learning.price_forecast.freeze_status", {
        val: decision.status,
        ack: true,
    });
    await host.setStateAsync("learning.price_forecast.freeze_reason", {
        val: decision.reason,
        ack: true,
    });
    if (!decision.shouldFreeze) {
        return;
    }
    const tomorrowRaw = await readForeignVal(host, cfg.tomorrowJsonStateId);
    const targetDate = (0, tibber_parse_1.targetDateForTomorrowFreeze)(now);
    const slots = (0, tibber_parse_1.parseTibberPriceJsonToHourlySlots)(tomorrowRaw, targetDate);
    if (slots.length === 0) {
        host.log.warn(`Price Forecast Freeze: keine Slots für ${targetDate} in ${cfg.tomorrowJsonStateId}`);
        await host.setStateAsync("learning.price_forecast.freeze_status", {
            val: "error",
            ack: true,
        });
        await host.setStateAsync("learning.price_forecast.freeze_reason", {
            val: `Keine Forecast-Slots für ${targetDate} — evtl. Tibber-Morgenpreise noch nicht da (ca. 13:00).`,
            ack: true,
        });
        return;
    }
    const baseDir = host.getAbsolutePath("learning/price_forecast");
    const payload = {
        module: constants_1.MODULE_TAG,
        frozen_at: now.toISOString(),
        freeze_date: (0, freeze_1.localDateKey)(now),
        target_date: targetDate,
        forecast_source: cfg.tomorrowJsonStateId,
        slots,
    };
    await (0, persist_1.writeForecastFreezeFile)(baseDir, payload);
    await host.setStateAsync("learning.price_forecast.frozen_at_ts", {
        val: now.toISOString(),
        ack: true,
    });
    await host.setStateAsync("learning.price_forecast.frozen_target_date", {
        val: targetDate,
        ack: true,
    });
    await host.setStateAsync("learning.price_forecast.freeze_status", {
        val: "ready",
        ack: true,
    });
    await host.setStateAsync("learning.price_forecast.freeze_reason", {
        val: `Forecast für ${targetDate} eingefroren (${slots.length}h).`,
        ack: true,
    });
    host.log.info(`Price Forecast Freeze: ${targetDate} ${slots.length} Stunden`);
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
