"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopPvBiasLearning = exports.initPvBiasLearning = void 0;
const ensure_states_1 = require("./ensure_states");
const run_1 = require("./run");
const config_1 = require("./config");
let pvBiasTimer = null;
async function initPvBiasLearning(adapter) {
    const host = adapter;
    await (0, ensure_states_1.ensurePvBiasStates)(host);
    await (0, run_1.runPvBiasLearning)(host);
    const cfg = (0, config_1.pvBiasConfigFromAdapter)(adapter.config);
    stopPvBiasLearning();
    pvBiasTimer = setInterval(() => {
        void (0, run_1.runPvBiasLearning)(host).catch((e) => {
            adapter.log.error(`PV-Bias tick: ${e}`);
        });
    }, cfg.intervalSec * 1000);
    adapter.log.info(`EMS-Light PV-Bias Learning ready (read-only, interval ${cfg.intervalSec}s)`);
}
exports.initPvBiasLearning = initPvBiasLearning;
function stopPvBiasLearning() {
    if (pvBiasTimer) {
        clearInterval(pvBiasTimer);
        pvBiasTimer = null;
    }
}
exports.stopPvBiasLearning = stopPvBiasLearning;
