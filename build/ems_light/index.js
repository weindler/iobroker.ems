"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopEmsLightPhase1 = exports.initEmsLightPhase1 = void 0;
const pv_bias_1 = require("../learning/pv_bias");
const weather_1 = require("../learning/weather");
const data_dir_1 = require("../learning/data_dir");
const policy_1 = require("../policy");
const intent_1 = require("../intent");
const global_modes_1 = require("../global_modes");
const ensure_states_1 = require("./ensure_states");
const tick_1 = require("./tick");
const DEFAULT_TICK_SEC = 60;
const GLOBAL_MODES_REQUESTED_STATE = "global_modes.requested";
const INTENT_WALLBOX_REQUEST_STATE = "user_intent.inputs.iobroker.wallbox.request_json";
let tickTimer = null;
let policyAdapter = null;
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
    await (0, weather_1.initWeatherLearning)(adapter);
    const policyHost = (0, data_dir_1.withLearningDataPath)(adapter, adapter);
    await (0, policy_1.initPolicyEngine)(policyHost);
    const intentHost = {
        ...(0, data_dir_1.withLearningDataPath)(adapter, adapter),
        namespace: adapter.namespace,
        config: adapter.config,
        log: adapter.log,
        setObjectNotExistsAsync: adapter.setObjectNotExistsAsync.bind(adapter),
        getStateAsync: adapter.getStateAsync.bind(adapter),
        setStateAsync: adapter.setStateAsync.bind(adapter),
        extendObjectAsync: adapter.extendObjectAsync?.bind(adapter),
        getForeignStateAsync: adapter.getForeignStateAsync.bind(adapter),
        subscribeStatesAsync: adapter.subscribeStatesAsync.bind(adapter),
        unsubscribeStatesAsync: adapter.unsubscribeStatesAsync.bind(adapter),
        subscribeForeignStatesAsync: adapter.subscribeForeignStatesAsync.bind(adapter),
        unsubscribeForeignStatesAsync: adapter.unsubscribeForeignStatesAsync.bind(adapter),
    };
    await (0, intent_1.initIntentEngine)(intentHost);
    // Verbindliche ioBroker-Subscription auf dem echten Adapter (stateChange-Routing
    // erfolgt in main.ts onStateChange -> handleGlobalModesStateChange).
    policyAdapter = adapter;
    try {
        await adapter.subscribeStatesAsync(GLOBAL_MODES_REQUESTED_STATE);
        await adapter.subscribeStatesAsync(INTENT_WALLBOX_REQUEST_STATE);
    }
    catch (e) {
        adapter.log.warn(`EMS-Light state subscribe: ${e}`);
    }
    await (0, tick_1.runEmsLightPhase1Tick)(host);
    const sec = tickIntervalSec(adapter.config);
    stopEmsLightTick();
    tickTimer = setInterval(() => {
        void (0, tick_1.runEmsLightPhase1Tick)(host).catch((e) => {
            adapter.log.error(`EMS-Light tick: ${e}`);
        });
    }, sec * 1000);
    adapter.log.info(`EMS-Light Phase 1 ready (read-only, tick ${sec}s)`);
}
exports.initEmsLightPhase1 = initEmsLightPhase1;
/** Nur Live-Tick-Timer stoppen (Learning-Intervalle laufen weiter). */
function stopEmsLightTick() {
    if (tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
    }
}
function stopEmsLightPhase1() {
    if (policyAdapter) {
        const adapter = policyAdapter;
        policyAdapter = null;
        void Promise.resolve(adapter.unsubscribeStatesAsync(GLOBAL_MODES_REQUESTED_STATE)).catch((e) => adapter.log.debug?.(`global_modes.requested unsubscribe: ${e}`));
        void Promise.resolve(adapter.unsubscribeStatesAsync(INTENT_WALLBOX_REQUEST_STATE)).catch((e) => adapter.log.debug?.(`intent wallbox request unsubscribe: ${e}`));
    }
    (0, intent_1.stopIntentEngine)();
    (0, policy_1.stopPolicyEngine)();
    (0, global_modes_1.resetGlobalModesRuntime)();
    (0, pv_bias_1.stopPvBiasLearning)();
    (0, weather_1.stopWeatherLearning)();
    stopEmsLightTick();
}
exports.stopEmsLightPhase1 = stopEmsLightPhase1;
