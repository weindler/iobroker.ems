"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runHouseLoadLearning = void 0;
const config_1 = require("./config");
const constants_1 = require("./constants");
const history_1 = require("./history");
const mapping_1 = require("./mapping");
const math_1 = require("./math");
const persist_1 = require("./persist");
const decompose_1 = require("./decompose");
const types_1 = require("../../addons/immersion_heater/runtime/types");
const ensure_states_1 = require("../../addons/air_conditioning/runtime/ensure_states");
const constants_2 = require("../../addons/air_conditioning/constants");
const ensure_states_2 = require("../../addons/battery/ensure_states");
const ensure_evcc_states_1 = require("../../addons/wallbox/ensure_evcc_states");
const state_util_1 = require("../../ems_light/state_util");
const JSON_STATE_LIMIT = 12_000;
function truncateJson(obj) {
    const raw = JSON.stringify(obj);
    if (raw.length <= JSON_STATE_LIMIT) {
        return raw;
    }
    return `${raw.slice(0, JSON_STATE_LIMIT - 20)}…truncated"}`;
}
async function setNumIfValid(host, id, value) {
    if (value !== null && Number.isFinite(value)) {
        await host.setStateAsync(id, { val: value, ack: true });
    }
}
async function writeResult(host, result, _historyMode) {
    const lastRun = new Date().toISOString();
    await setNumIfValid(host, "learning.house_load.sample_days", result.sampleDays);
    await setNumIfValid(host, "learning.house_load.confidence", result.confidence);
    await host.setStateAsync("learning.house_load.status", { val: result.status, ack: true });
    await host.setStateAsync("learning.house_load.current_day_type", {
        val: result.currentDayType,
        ack: true,
    });
    await host.setStateAsync("learning.house_load.forecast_today_json", {
        val: truncateJson(result.forecastTodayJson),
        ack: true,
    });
    await host.setStateAsync("learning.house_load.forecast_tomorrow_json", {
        val: truncateJson(result.forecastTomorrowJson),
        ack: true,
    });
    await host.setStateAsync("learning.house_load.forecast_horizon_json", {
        val: truncateJson(result.forecastHorizonJson),
        ack: true,
    });
    await host.setStateAsync("learning.house_load.error", { val: result.error, ack: true });
    await host.setStateAsync("learning.house_load.last_update", { val: lastRun, ack: true });
}
async function runHouseLoadLearning(host) {
    const cfg = (0, config_1.houseLoadConfigFromAdapter)(host.config);
    const now = new Date();
    if (!cfg.enabled) {
        await writeResult(host, (0, math_1.disabledResult)());
        return;
    }
    const resolved = await (0, mapping_1.resolveHouseLoadPowerStateId)(host, cfg.powerStateId);
    if (!resolved.stateId) {
        await writeResult(host, (0, math_1.noSourceResult)(resolved.stateId, now));
        return;
    }
    let lastPersistAt = null;
    if (host.getAbsolutePath) {
        const existing = await (0, persist_1.readHouseLoadPersist)(host.getAbsolutePath("learning/house_load"));
        lastPersistAt = existing?.generated_at ?? null;
    }
    try {
        host.log.debug?.(`House-Load-Learning: loading history (${cfg.lookbackDays}d, ${(0, config_1.sourceLabelFromStateId)(resolved.stateId)})…`);
        const { samples: rawSamples, lastValidTs, stats } = await (0, history_1.fetchHouseLoadSamples)(host, resolved.stateId, cfg.lookbackDays);
        /*
         * Flex-Dekomposition: bekannte EMS-Istwerte vom aktuellen Stundenfenster
         * (keine erfundenen Historien). Ältere Samples bleiben unverändert, bis
         * stundenweise Flex-Historie verfügbar ist.
         */
        const flexMap = new Map();
        const currentHour = Math.floor(now.getTime() / constants_1.MS_PER_HOUR) * constants_1.MS_PER_HOUR;
        /*
         * Nur belastbare Istwerte abziehen. Aktiv ohne Leistungstelemetrie → null
         * (quality partial). Inaktiv/unmapped → weglassen (nicht als missing markieren).
         */
        const climateUnitsW = [];
        for (let u = 1; u <= constants_2.AC_UNIT_COUNT; u++) {
            const ids = (0, ensure_states_1.acUnitRuntimeStates)(u);
            const running = (await host.getStateAsync(ids.running))?.val === true;
            const est = (0, state_util_1.asNum)((await host.getStateAsync(ids.estimatedPowerW))?.val);
            if (!running)
                climateUnitsW.push(undefined);
            else
                climateUnitsW.push(est != null && est >= 0 ? est : null);
        }
        const ihMeas = (0, state_util_1.asNum)((await host.getStateAsync(types_1.IMMERSION_RUNTIME_STATES.measuredPowerW))?.val);
        const ihCmd = (0, state_util_1.asNum)((await host.getStateAsync(types_1.IMMERSION_RUNTIME_STATES.commandedPowerW))?.val);
        const ihStage = (0, state_util_1.asNum)((await host.getStateAsync(types_1.IMMERSION_RUNTIME_STATES.feedbackStage))?.val) ?? 0;
        const ihActive = ihStage > 0 || (ihMeas != null && ihMeas > 0);
        const wbCharge = (0, state_util_1.asNum)((await host.getStateAsync(ensure_evcc_states_1.WALLBOX_EVCC_STATES.chargePowerW))?.val);
        const batCharge = (0, state_util_1.asNum)((await host.getStateAsync(ensure_states_2.BAT.telemetry.chargingPowerW))?.val);
        const flex = {
            climateUnitsW,
            immersionHeaterW: ihMeas != null && ihMeas >= 0
                ? ihMeas
                : ihActive
                    ? ihCmd != null && ihCmd >= 0
                        ? ihCmd
                        : null
                    : undefined,
        };
        if (wbCharge != null && wbCharge >= 0)
            flex.wallboxChargeW = wbCharge;
        if (batCharge != null && batCharge >= 0)
            flex.batteryChargeW = batCharge;
        flexMap.set(currentHour, flex);
        const decomp = (0, decompose_1.applyFlexDecompositionToSamples)(rawSamples, flexMap);
        const samples = decomp.samples.map((s, i) => ({
            ...rawSamples[i],
            powerW: s.powerW,
        }));
        if (decomp.decomposedCount > 0) {
            host.log.debug?.(`House-Load-Learning: Flex-Dekomposition auf ${decomp.decomposedCount} Samples (partial=${decomp.partialCount})`);
        }
        const sampleDays = (0, history_1.distinctSampleDays)(samples);
        const sampleDaysMinHours = (0, history_1.distinctSampleDaysWithMinHours)(samples, constants_1.MIN_DAY_HOURS);
        const result = (0, math_1.computeHouseLoadLearning)({
            samples,
            sampleDays,
            lastValidTs,
            sourceStateId: resolved.stateId,
            now,
            lastPersistAt,
        });
        if (host.getAbsolutePath) {
            const baseDir = host.getAbsolutePath("learning/house_load");
            const lastRun = new Date().toISOString();
            await (0, persist_1.writeHouseLoadPersist)(baseDir, result, lastRun);
            result.healthJson.last_persist_at = lastRun;
        }
        await writeResult(host, result, stats.historySource);
        host.log.debug?.(`House-Load-Learning: status=${result.status} health=${result.healthStatus} samples=${result.sampleCount} days=${result.sampleDays} source=${(0, config_1.sourceLabelFromStateId)(resolved.stateId)} (history=${stats.historySource}, ${stats.rowsTotal} rows → ${stats.hourlySamples} h, span=${stats.tsSpanHours ?? "?"}h)`);
        if (stats.rowsTotal > 50 && stats.hourlySamples < 10) {
            host.log.warn(`House Load Learning: ${stats.rowsTotal} History-Zeilen aber nur ${stats.hourlySamples} Stunden-Samples (invalid=${stats.skippedInvalid}, negative=${stats.skippedNegative}, span=${stats.tsSpanHours ?? "?"}h) — Timestamps/Einheit prüfen`);
        }
        if (sampleDaysMinHours < sampleDays && result.status === "insufficient_data") {
            host.log.debug?.(`House Load Learning: ${sampleDays} Kalendertage mit Daten, ${sampleDaysMinHours} mit ≥${constants_1.MIN_DAY_HOURS}h/Tag`);
        }
        if (result.status === "insufficient_data") {
            host.log.warn(`House Load Learning: ungenügende Historie (sample_days=${result.sampleDays}, samples=${result.sampleCount})`);
        }
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        host.log.error(`House Load Learning: ${msg}`);
        await writeResult(host, (0, math_1.errorResult)(msg, resolved.stateId, now));
    }
}
exports.runHouseLoadLearning = runHouseLoadLearning;
