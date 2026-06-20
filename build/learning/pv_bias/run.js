"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPvBiasLearning = void 0;
const state_util_1 = require("../../ems_light/state_util");
const config_1 = require("./config");
const freeze_1 = require("./freeze");
const history_1 = require("./history");
const math_1 = require("./math");
async function readForeignNum(host, stateId) {
    if (!stateId) {
        return null;
    }
    try {
        const read = host.getForeignStateAsync ?? host.getStateAsync;
        const st = await read.call(host, stateId);
        return (0, state_util_1.asNum)(st?.val);
    }
    catch {
        return null;
    }
}
async function readLiveRawForecast(host, configStateId, fallbackLocalId) {
    const fromConfig = await readForeignNum(host, configStateId);
    if (fromConfig !== null) {
        return fromConfig;
    }
    const local = await host.getStateAsync(fallbackLocalId);
    return (0, state_util_1.asNum)(local?.val);
}
async function setNumIfValid(host, id, value) {
    if (value !== null && Number.isFinite(value)) {
        await host.setStateAsync(id, { val: Math.round(value * 1000) / 1000, ack: true });
    }
}
async function writePvBiasResult(host, result) {
    await setNumIfValid(host, "learning.pv_bias.bias_today_pct", result.biasTodayPct);
    await setNumIfValid(host, "learning.pv_bias.bias_7d_pct", result.bias7dPct);
    await setNumIfValid(host, "learning.pv_bias.bias_30d_pct", result.bias30dPct);
    await setNumIfValid(host, "learning.pv_bias.corrected_today_kwh", result.correctedTodayKwh);
    await setNumIfValid(host, "learning.pv_bias.corrected_tomorrow_kwh", result.correctedTomorrowKwh);
    await setNumIfValid(host, "learning.pv_bias.confidence_pct", result.confidencePct);
    await setNumIfValid(host, "learning.pv_bias.raw_today_kwh", result.rawTodayKwh);
    await setNumIfValid(host, "learning.pv_bias.raw_tomorrow_kwh", result.rawTomorrowKwh);
    await setNumIfValid(host, "learning.pv_bias.sample_days_7d", result.sampleDays7d);
    await setNumIfValid(host, "learning.pv_bias.sample_days_30d", result.sampleDays30d);
    await host.setStateAsync("learning.pv_bias.last_update_ts", {
        val: new Date().toISOString(),
        ack: true,
    });
    await host.setStateAsync("learning.pv_bias.status", { val: result.status, ack: true });
    await host.setStateAsync("learning.pv_bias.reason", { val: result.reason, ack: true });
}
async function runPvBiasLearning(host) {
    const cfg = (0, config_1.pvBiasConfigFromAdapter)(host.config);
    if (!cfg.enabled) {
        await host.setStateAsync("learning.pv_bias.status", { val: "disabled", ack: true });
        await host.setStateAsync("learning.pv_bias.reason", {
            val: "PV-Bias Learning in Admin deaktiviert.",
            ack: true,
        });
        return;
    }
    if (!(0, config_1.pvBiasConfigReady)(cfg)) {
        await host.setStateAsync("learning.pv_bias.status", { val: "no_config", ack: true });
        await host.setStateAsync("learning.pv_bias.reason", {
            val: cfg.freezeEnabled
                ? "Historie-State für PV-Ist und gültige Freeze-Zeit in Admin konfigurieren."
                : "Historie-States für PV-Ist und PV-Forecast in Admin konfigurieren.",
            ack: true,
        });
        return;
    }
    try {
        await (0, freeze_1.runForecastFreeze)(host, cfg);
        const forecastHistoryStateId = cfg.freezeEnabled
            ? freeze_1.FROZEN_TODAY_STATE_ID
            : cfg.historyForecastStateId;
        host.log.info("PV-Bias: loading history (max 30 days, timeout per query)…");
        const pairs = await (0, history_1.fetchPvBiasDayPairs)(host, cfg.historyActualStateId, forecastHistoryStateId);
        host.log.info(`PV-Bias: history loaded, ${pairs.length} valid day pair(s)`);
        const rawTodayKwh = await readLiveRawForecast(host, cfg.rawTodayStateId, "forecast.pv.today_kwh");
        const rawTomorrowKwh = await readLiveRawForecast(host, cfg.rawTomorrowStateId, "forecast.pv.tomorrow_kwh");
        const frozen = cfg.freezeEnabled ? await (0, freeze_1.readFrozenForecast)(host) : { today: null, tomorrow: null };
        const forecastForCorrection = cfg.freezeEnabled
            ? { today: frozen.today, tomorrow: frozen.tomorrow }
            : { today: rawTodayKwh, tomorrow: rawTomorrowKwh };
        const result = (0, math_1.computePvBias)(pairs, forecastForCorrection.today, forecastForCorrection.tomorrow);
        result.rawTodayKwh = rawTodayKwh;
        result.rawTomorrowKwh = rawTomorrowKwh;
        if (cfg.freezeEnabled && frozen.today === null) {
            result.status = "insufficient_data";
            result.reason = "Eingefrorener Forecast fehlt — Bias/Korrektur warten auf Freeze-Snapshot.";
        }
        await writePvBiasResult(host, result);
        host.log.info(`PV-Bias: 7d=${result.bias7dPct ?? "—"}% 30d=${result.bias30dPct ?? "—"}% conf=${result.confidencePct}% samples=${result.sampleDays30d} freeze=${cfg.freezeEnabled}`);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        host.log.error(`PV-Bias Learning: ${msg}`);
        await host.setStateAsync("learning.pv_bias.status", { val: "error", ack: true });
        await host.setStateAsync("learning.pv_bias.reason", {
            val: `Fehler bei PV-Bias-Berechnung: ${msg}`,
            ack: true,
        });
    }
}
exports.runPvBiasLearning = runPvBiasLearning;
