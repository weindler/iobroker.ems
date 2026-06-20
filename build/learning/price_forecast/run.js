"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPriceForecastLearning = void 0;
const config_1 = require("./config");
const compare_1 = require("./compare");
const math_1 = require("./math");
const persist_1 = require("./persist");
async function setNumIfValid(host, id, value) {
    if (value !== null && Number.isFinite(value)) {
        await host.setStateAsync(id, { val: Math.round(value * 1000) / 1000, ack: true });
    }
}
async function writeResult(host, result, lastRun, freezeTime) {
    await setNumIfValid(host, "learning.price_forecast.forecast_confidence", result.forecastConfidence);
    await setNumIfValid(host, "learning.price_forecast.sample_days", result.sampleDays);
    await setNumIfValid(host, "learning.price_forecast.coverage_pct", result.coveragePct);
    await setNumIfValid(host, "learning.price_forecast.missing_days", result.missingDays);
    await setNumIfValid(host, "learning.price_forecast.forecast_accuracy_7d", result.forecastAccuracy7d);
    await setNumIfValid(host, "learning.price_forecast.forecast_accuracy_30d", result.forecastAccuracy30d);
    await setNumIfValid(host, "learning.price_forecast.forecast_accuracy_90d", result.forecastAccuracy90d);
    await setNumIfValid(host, "learning.price_forecast.avg_error_ct_7d", result.avgErrorCt7d);
    await setNumIfValid(host, "learning.price_forecast.avg_error_ct_30d", result.avgErrorCt30d);
    await setNumIfValid(host, "learning.price_forecast.avg_error_ct_90d", result.avgErrorCt90d);
    await host.setStateAsync("learning.price_forecast.status", { val: result.status, ack: true });
    await host.setStateAsync("learning.price_forecast.health", { val: result.health, ack: true });
    await host.setStateAsync("learning.price_forecast.stability", { val: result.stability, ack: true });
    await host.setStateAsync("learning.price_forecast.forecast_source", {
        val: result.forecastSource,
        ack: true,
    });
    await host.setStateAsync("learning.price_forecast.actual_source", { val: result.actualSource, ack: true });
    await host.setStateAsync("learning.price_forecast.error", { val: result.error, ack: true });
    await host.setStateAsync("learning.price_forecast.last_run", { val: lastRun, ack: true });
    await host.setStateAsync("learning.price_forecast.freeze_time", { val: freezeTime, ack: true });
}
async function runPriceForecastLearning(host) {
    const cfg = (0, config_1.priceForecastConfigFromAdapter)(host.config);
    const lastRun = new Date().toISOString();
    if (!cfg.enabled) {
        await writeResult(host, (0, math_1.disabledResult)(), lastRun, cfg.freezeTime);
        return;
    }
    if (!(0, config_1.priceForecastConfigReady)(cfg)) {
        await writeResult(host, (0, math_1.missingForecastResult)(), lastRun, cfg.freezeTime);
        return;
    }
    const forecastSource = (0, config_1.sourceLabelFromStateId)(cfg.tomorrowJsonStateId);
    const actualSource = (0, config_1.sourceLabelFromStateId)(cfg.actualStateId);
    try {
        await (0, compare_1.runPriceForecastFreeze)(host, cfg);
        const pairs = await (0, compare_1.buildMatchedPairs)(host, cfg);
        const result = (0, math_1.computePriceForecastLearning)(pairs, cfg.lookbackDays, forecastSource, actualSource, new Date());
        await writeResult(host, result, lastRun, cfg.freezeTime);
        if (host.getAbsolutePath) {
            const baseDir = host.getAbsolutePath("learning/price_forecast");
            await (0, persist_1.writePriceForecastPersist)(baseDir, result, lastRun);
        }
        host.log.info(`Price Forecast Learning completed: status=${result.status} confidence=${result.forecastConfidence}`);
        if (host.log.debug) {
            host.log.debug(`Price Forecast: pairs=${pairs.length} accuracy7d=${result.forecastAccuracy7d} avgError7d=${result.avgErrorCt7d}`);
        }
        if (result.status === "insufficient_data") {
            host.log.warn(`Price Forecast Learning: ungenügende Daten (sample_days=${result.sampleDays}, coverage=${result.coveragePct}%)`);
        }
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        host.log.error(`Price Forecast Learning: ${msg}`);
        await writeResult(host, (0, math_1.errorResult)(forecastSource, actualSource, msg), lastRun, cfg.freezeTime);
    }
}
exports.runPriceForecastLearning = runPriceForecastLearning;
