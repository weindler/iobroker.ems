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
const energy_daily_rollup_1 = require("../energy_daily_rollup");
const power_rollup_1 = require("../power_rollup");
const pv_horizon_1 = require("../pv_horizon");
const data_dir_1 = require("../data_dir");
const history_bridge_1 = require("../history_bridge");
const persistence_mirror_1 = require("../persistence_mirror");
let pvBiasTimer = null;
async function runLearningTick(host) {
    await (0, energy_daily_rollup_1.ensureEnergyDailyRollupForLearning)(host);
    await (0, run_1.runPvBiasLearning)(host);
    await (0, pv_horizon_1.runPvHorizon)(host);
    await (0, price_learning_1.runPriceLearning)(host);
    // Rollup-Backfill vor House-Load/Battery — sonst fällt der erste Lauf auf history.0 zurück.
    await (0, power_rollup_1.ensurePowerRollupForLearning)(host);
    // House/Thermal/Battery vor Price Forecast — Forecast-Matching lädt viele History-Tage.
    await (0, house_load_1.runHouseLoadLearning)(host);
    await (0, thermal_runtime_1.runThermalRuntimeLearning)(host);
    await (0, battery_runtime_1.runBatteryRuntimeLearning)(host);
    await (0, price_forecast_1.runPriceForecastLearning)(host);
    await (0, persistence_mirror_1.mirrorLearningPersistenceToStates)(host);
}
async function initPvBiasLearning(adapter) {
    const host = (0, history_bridge_1.withHistoryBridge)(adapter, (0, data_dir_1.withLearningDataPath)(adapter, adapter));
    await (0, ensure_states_1.ensurePvBiasStates)(host);
    await (0, pv_horizon_1.ensurePvHorizonLearningStates)(host);
    await (0, price_learning_1.ensurePriceLearningStates)(host);
    await (0, price_forecast_1.ensurePriceForecastLearningStates)(host);
    await (0, house_load_1.ensureHouseLoadLearningStates)(host);
    await (0, thermal_runtime_1.ensureThermalRuntimeLearningStates)(host);
    await (0, battery_runtime_1.ensureBatteryRuntimeLearningStates)(host);
    await (0, persistence_mirror_1.ensureLearningPersistenceStates)(host);
    // Vor dem ersten Lauf: fehlende Persist-Dateien aus den Backup-States wiederherstellen.
    await (0, persistence_mirror_1.restoreLearningPersistenceFromStates)(host);
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
