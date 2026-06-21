"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopPvBiasLearning = exports.initPvBiasLearning = void 0;
const ensure_states_1 = require("./ensure_states");
const run_1 = require("./run");
const config_1 = require("./config");
const price_learning_1 = require("../price_learning");
const price_forecast_1 = require("../price_forecast");
const pv_horizon_1 = require("../pv_horizon");
const data_dir_1 = require("../data_dir");
let pvBiasTimer = null;
async function runLearningTick(host) {
    await (0, run_1.runPvBiasLearning)(host);
    await (0, pv_horizon_1.runPvHorizon)(host);
    await (0, price_learning_1.runPriceLearning)(host);
    await (0, price_forecast_1.runPriceForecastLearning)(host);
}
async function initPvBiasLearning(adapter) {
    const host = (0, data_dir_1.withLearningDataPath)(adapter, adapter);
    await (0, ensure_states_1.ensurePvBiasStates)(host);
    await (0, pv_horizon_1.ensurePvHorizonLearningStates)(host);
    await (0, price_learning_1.ensurePriceLearningStates)(host);
    await (0, price_forecast_1.ensurePriceForecastLearningStates)(host);
    const cfg = (0, config_1.pvBiasConfigFromAdapter)(adapter.config);
    stopPvBiasLearning();
    void runLearningTick(host).catch((e) => {
        adapter.log.error(`PV-Bias/Horizon initial run: ${e}`);
    });
    pvBiasTimer = setInterval(() => {
        void runLearningTick(host).catch((e) => {
            adapter.log.error(`PV-Bias/Horizon tick: ${e}`);
        });
    }, cfg.intervalSec * 1000);
    adapter.log.info(`EMS-Light PV-Bias + PV-Horizon + Price-Learning + Price-Forecast ready (read-only, interval ${cfg.intervalSec}s)`);
}
exports.initPvBiasLearning = initPvBiasLearning;
function stopPvBiasLearning() {
    if (pvBiasTimer) {
        clearInterval(pvBiasTimer);
        pvBiasTimer = null;
    }
}
exports.stopPvBiasLearning = stopPvBiasLearning;
