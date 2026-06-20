"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPvHorizon = void 0;
const history_1 = require("../pv_bias/history");
const config_1 = require("./config");
const math_1 = require("./math");
const constants_1 = require("./constants");
const BIAS_STATE_IDS = [
    "learning.pv_bias.bias_7d_pct",
    "learning.pv_bias.bias_30d_pct",
    "learning.pv_bias.bias_today_pct",
];
const DAY1_FALLBACK_STATE_IDS = [
    "learning.pv_bias.raw_today_kwh",
    "forecast.pv.today_kwh",
];
const DAY2_FALLBACK_STATE_IDS = [
    "learning.pv_bias.raw_tomorrow_kwh",
    "forecast.pv.tomorrow_kwh",
];
async function readFirstNum(host, ids) {
    for (const id of ids) {
        const n = await (0, history_1.readStateNum)(host, id);
        if (n !== null) {
            return n;
        }
    }
    return null;
}
async function readBiasPct(host) {
    for (const id of BIAS_STATE_IDS) {
        const n = await (0, history_1.readStateNum)(host, id);
        if (n !== null) {
            return n;
        }
    }
    return null;
}
async function resolveRawKwhByDay(host, rawStateIds) {
    const values = [];
    for (let i = 0; i < constants_1.PV_HORIZON_DAY_COUNT; i++) {
        let raw = null;
        const configured = rawStateIds[i];
        if (configured) {
            raw = await (0, history_1.readStateNum)(host, configured);
        }
        if (raw === null && i === 0) {
            raw = await readFirstNum(host, DAY1_FALLBACK_STATE_IDS);
        }
        if (raw === null && i === 1) {
            raw = await readFirstNum(host, DAY2_FALLBACK_STATE_IDS);
        }
        values.push(raw);
    }
    return values;
}
async function setNumIfValid(host, id, value) {
    if (value !== null && Number.isFinite(value)) {
        await host.setStateAsync(id, { val: Math.round(value * 1000) / 1000, ack: true });
    }
}
async function writePvHorizonResult(host, result) {
    for (const day of result.days) {
        const prefix = `learning.pv_horizon.day${day.dayIndex}`;
        await setNumIfValid(host, `${prefix}.raw_kwh`, day.rawKwh);
        await setNumIfValid(host, `${prefix}.corrected_kwh`, day.correctedKwh);
        await setNumIfValid(host, `${prefix}.confidence_pct`, day.confidencePct);
    }
    await setNumIfValid(host, "learning.pv_horizon.total_7d_raw_kwh", result.total7dRawKwh);
    await setNumIfValid(host, "learning.pv_horizon.total_7d_corrected_kwh", result.total7dCorrectedKwh);
    await setNumIfValid(host, "learning.pv_horizon.days_available", result.daysAvailable);
    await host.setStateAsync("learning.pv_horizon.status", { val: result.status, ack: true });
    await host.setStateAsync("learning.pv_horizon.last_update", {
        val: new Date().toISOString(),
        ack: true,
    });
}
async function runPvHorizon(host) {
    const cfg = (0, config_1.pvHorizonConfigFromAdapter)(host.config);
    if (!cfg.enabled) {
        await host.setStateAsync("learning.pv_horizon.status", { val: "disabled", ack: true });
        return;
    }
    const rawByDay = await resolveRawKwhByDay(host, cfg.rawStateIds);
    const biasPct = await readBiasPct(host);
    const baseConfidence = await (0, history_1.readStateNum)(host, "learning.pv_bias.confidence_pct");
    const result = (0, math_1.computePvHorizon)(rawByDay, biasPct, baseConfidence);
    await writePvHorizonResult(host, result);
    host.log.info(`PV-Horizon: days=${result.daysAvailable}/${constants_1.PV_HORIZON_DAY_COUNT} status=${result.status} total_corr=${result.total7dCorrectedKwh ?? "—"} kWh`);
}
exports.runPvHorizon = runPvHorizon;
