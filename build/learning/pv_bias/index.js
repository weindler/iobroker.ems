"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopPvBiasLearning = exports.initPvBiasLearning = void 0;
const ensure_states_1 = require("./ensure_states");
const run_1 = require("./run");
const config_1 = require("./config");
const price_learning_1 = require("../price_learning");
const pv_horizon_1 = require("../pv_horizon");
let pvBiasTimer = null;
async function runLearningTick(host) {
    await (0, run_1.runPvBiasLearning)(host);
    await (0, pv_horizon_1.runPvHorizon)(host);
    await (0, price_learning_1.runPriceLearning)(host);
}
async function initPvBiasLearning(adapter) {
    const host = adapter;
    await (0, ensure_states_1.ensurePvBiasStates)(host);
    await (0, pv_horizon_1.ensurePvHorizonLearningStates)(host);
    await (0, price_learning_1.ensurePriceLearningStates)(host);
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
    adapter.log.info(`EMS-Light PV-Bias + PV-Horizon + Price-Learning ready (read-only, interval ${cfg.intervalSec}s)`);
}
exports.initPvBiasLearning = initPvBiasLearning;
function stopPvBiasLearning() {
    if (pvBiasTimer) {
        clearInterval(pvBiasTimer);
        pvBiasTimer = null;
    }
}
exports.stopPvBiasLearning = stopPvBiasLearning;
