"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPriceLearning = void 0;
const config_1 = require("./config");
const history_1 = require("./history");
const math_1 = require("./math");
const persist_1 = require("./persist");
async function setNumIfValid(host, id, value) {
    if (value !== null && Number.isFinite(value)) {
        await host.setStateAsync(id, { val: Math.round(value * 10000) / 10000, ack: true });
    }
}
async function writePriceLearningResult(host, result, lastRun) {
    await setNumIfValid(host, "learning.price_learning.confidence", result.confidence);
    await setNumIfValid(host, "learning.price_learning.sample_days", result.sampleDays);
    await setNumIfValid(host, "learning.price_learning.coverage_pct", result.coveragePct);
    await setNumIfValid(host, "learning.price_learning.missing_days", result.missingDays);
    await setNumIfValid(host, "learning.price_learning.avg_price_7d", result.avgPrice7d);
    await setNumIfValid(host, "learning.price_learning.avg_price_30d", result.avgPrice30d);
    await setNumIfValid(host, "learning.price_learning.avg_price_90d", result.avgPrice90d);
    await setNumIfValid(host, "learning.price_learning.volatility_30d", result.volatility30d);
    await host.setStateAsync("learning.price_learning.status", { val: result.status, ack: true });
    await host.setStateAsync("learning.price_learning.health", { val: result.health, ack: true });
    await host.setStateAsync("learning.price_learning.cheap_hours", {
        val: JSON.stringify(result.cheapHours),
        ack: true,
    });
    await host.setStateAsync("learning.price_learning.expensive_hours", {
        val: JSON.stringify(result.expensiveHours),
        ack: true,
    });
    await host.setStateAsync("learning.price_learning.price_source", { val: result.priceSource, ack: true });
    await host.setStateAsync("learning.price_learning.error", { val: result.error, ack: true });
    await host.setStateAsync("learning.price_learning.last_run", { val: lastRun, ack: true });
}
async function runPriceLearning(host) {
    const cfg = (0, config_1.priceLearningConfigFromAdapter)(host.config);
    const lastRun = new Date().toISOString();
    if (!cfg.enabled) {
        const result = (0, math_1.disabledResult)();
        await writePriceLearningResult(host, result, lastRun);
        return;
    }
    if (!(0, config_1.priceLearningConfigReady)(cfg)) {
        const result = (0, math_1.missingMappingResult)();
        await writePriceLearningResult(host, result, lastRun);
        return;
    }
    const priceSource = (0, config_1.sourceLabelFromStateId)(cfg.priceStateId);
    try {
        const { samples } = await (0, history_1.fetchPriceSamples)(host, cfg.priceStateId, cfg.lookbackDays);
        const daySummaries = (0, history_1.summarizeDays)(samples, cfg.lookbackDays);
        const result = (0, math_1.computePriceLearning)(samples, daySummaries, cfg.lookbackDays, priceSource);
        await writePriceLearningResult(host, result, lastRun);
        if (host.getAbsolutePath) {
            const baseDir = host.getAbsolutePath("learning/price_learning");
            await (0, persist_1.writePriceLearningPersist)(baseDir, result, lastRun);
        }
        host.log.info(`Price Learning completed: status=${result.status} confidence=${result.confidence}`);
        if (host.log.debug) {
            host.log.debug(`Price Learning: samples=${samples.length} avg7d=${result.avgPrice7d} avg30d=${result.avgPrice30d} volatility30d=${result.volatility30d}`);
        }
        if (result.status === "insufficient_data") {
            host.log.warn(`Price Learning: ungenügende Historie (sample_days=${result.sampleDays}, coverage=${result.coveragePct}%)`);
        }
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        host.log.error(`Price Learning: ${msg}`);
        const result = (0, math_1.errorResult)(priceSource, msg);
        await writePriceLearningResult(host, result, lastRun);
    }
}
exports.runPriceLearning = runPriceLearning;
