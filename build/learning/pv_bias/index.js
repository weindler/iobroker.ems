"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopPvBiasLearning = exports.initPvBiasLearning = void 0;
const ensure_states_1 = require("./ensure_states");
const run_1 = require("./run");
const config_1 = require("./config");
const price_learning_1 = require("../price_learning");
const price_forecast_1 = require("../price_forecast");
const house_load_1 = require("../house_load");
const thermal_runtime_1 = require("../thermal_runtime");
const battery_runtime_1 = require("../battery_runtime");
const pv_horizon_1 = require("../pv_horizon");
const data_dir_1 = require("../data_dir");
let pvBiasTimer = null;
async function runLearningTick(host) {
    await (0, run_1.runPvBiasLearning)(host);
    await (0, pv_horizon_1.runPvHorizon)(host);
    await (0, price_learning_1.runPriceLearning)(host);
    // House/Thermal/Battery vor Price Forecast — Forecast-Matching lädt viele History-Tage.
    await (0, house_load_1.runHouseLoadLearning)(host);
    await (0, thermal_runtime_1.runThermalRuntimeLearning)(host);
    await (0, battery_runtime_1.runBatteryRuntimeLearning)(host);
    await (0, price_forecast_1.runPriceForecastLearning)(host);
}
async function initPvBiasLearning(adapter) {
    const host = (0, data_dir_1.withLearningDataPath)(adapter, adapter);
    await (0, ensure_states_1.ensurePvBiasStates)(host);
    await (0, pv_horizon_1.ensurePvHorizonLearningStates)(host);
    await (0, price_learning_1.ensurePriceLearningStates)(host);
    await (0, price_forecast_1.ensurePriceForecastLearningStates)(host);
    await (0, house_load_1.ensureHouseLoadLearningStates)(host);
    await (0, thermal_runtime_1.ensureThermalRuntimeLearningStates)(host);
    await (0, battery_runtime_1.ensureBatteryRuntimeLearningStates)(host);
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
    adapter.log.info(`EMS-Light PV-Bias + PV-Horizon + Price + House-Load + Thermal + Battery-Runtime ready (read-only, interval ${cfg.intervalSec}s)`);
}
exports.initPvBiasLearning = initPvBiasLearning;
function stopPvBiasLearning() {
    if (pvBiasTimer) {
        clearInterval(pvBiasTimer);
        pvBiasTimer = null;
    }
}
exports.stopPvBiasLearning = stopPvBiasLearning;
