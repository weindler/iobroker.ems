"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopEmsLightPhase1 = exports.initEmsLightPhase1 = void 0;
const pv_bias_1 = require("../learning/pv_bias");
const ensure_states_1 = require("./ensure_states");
const tick_1 = require("./tick");
const DEFAULT_TICK_SEC = 60;
let tickTimer = null;
function tickIntervalSec(config) {
    if (!config || typeof config !== "object") {
        return DEFAULT_TICK_SEC;
    }
    const raw = config.ems_light_tick_interval_sec;
    const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
    if (!Number.isFinite(n) || n < 15 || n > 600) {
        return DEFAULT_TICK_SEC;
    }
    return Math.round(n);
}
async function initEmsLightPhase1(adapter) {
    const version = String(adapter.common?.version ?? "0.0.0");
    const host = adapter;
    await (0, ensure_states_1.ensureEmsLightStates)(host, version);
    await (0, pv_bias_1.initPvBiasLearning)(adapter);
    await (0, tick_1.runEmsLightPhase1Tick)(host);
    const sec = tickIntervalSec(adapter.config);
    stopEmsLightPhase1();
    tickTimer = setInterval(() => {
        void (0, tick_1.runEmsLightPhase1Tick)(host).catch((e) => {
            adapter.log.error(`EMS-Light tick: ${e}`);
        });
    }, sec * 1000);
    adapter.log.info(`EMS-Light Phase 1 ready (read-only, tick ${sec}s)`);
}
exports.initEmsLightPhase1 = initEmsLightPhase1;
function stopEmsLightPhase1() {
    (0, pv_bias_1.stopPvBiasLearning)();
    if (tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
    }
}
exports.stopEmsLightPhase1 = stopEmsLightPhase1;
