"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopEmsLightPhase1 = exports.initEmsLightPhase1 = exports.startEmsLightPhase1Runtime = exports.ensureEmsLightStateTree = exports.getLearningStateTreeHost = void 0;
const pv_bias_1 = require("../learning/pv_bias");
const weather_1 = require("../learning/weather");
const data_dir_1 = require("../learning/data_dir");
const energy_daily_rollup_1 = require("../learning/energy_daily_rollup");
const statistics_1 = require("../statistics");
const power_rollup_1 = require("../learning/power_rollup");
const day_telemetry_1 = require("../learning/day_telemetry");
const policy_1 = require("../policy");
const intent_1 = require("../intent");
const planner_1 = require("../planner");
const global_modes_1 = require("../global_modes");
const execution_mode_1 = require("../execution_mode");
const tick_1 = require("../operator/daily_plan/tick");
const ensure_states_1 = require("./ensure_states");
const runtime_subscriptions_1 = require("./runtime_subscriptions");
const tick_2 = require("./tick");
const DEFAULT_TICK_SEC = 60;
const POLICY_STARTUP_TIMEOUT_MS = 8000;
let tickTimer = null;
let policyAdapter = null;
let powerRollupHost = null;
let energyDailyRollupHost = null;
let statisticsHost = null;
function buildRollupHost(adapter) {
    const adapterAny = adapter;
    const base = (0, data_dir_1.withLearningDataPath)(adapter, adapter);
    Object.assign(base, {
        namespace: adapter.namespace,
        config: adapter.config,
        log: adapter.log,
        getHistoryAsync: adapter.getHistoryAsync.bind(adapter),
        getStateAsync: adapter.getStateAsync.bind(adapter),
        setStateAsync: adapter.setStateAsync.bind(adapter),
        getForeignStateAsync: adapter.getForeignStateAsync.bind(adapter),
        getObjectAsync: adapter.getObjectAsync.bind(adapter),
        subscribeForeignStatesAsync: typeof adapterAny.subscribeForeignStatesAsync === "function"
            ? adapterAny.subscribeForeignStatesAsync.bind(adapter)
            : undefined,
        unsubscribeForeignStatesAsync: typeof adapterAny.unsubscribeForeignStatesAsync === "function"
            ? adapterAny.unsubscribeForeignStatesAsync.bind(adapter)
            : undefined,
    });
    return base;
}
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
async function waitWithStartupTimeout(promise, timeoutMs, onTimeout) {
    let timer = null;
    try {
        await Promise.race([
            promise,
            new Promise((resolve) => {
                timer = setTimeout(() => {
                    onTimeout();
                    resolve();
                }, timeoutMs);
            }),
        ]);
    }
    finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}
let learningHost = null;
function buildIntentHost(adapter) {
    const adapterAny = adapter;
    const base = (0, data_dir_1.withLearningDataPath)(adapter, adapter);
    Object.assign(base, {
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
        subscribeForeignStatesAsync: typeof adapterAny.subscribeForeignStatesAsync === "function"
            ? adapterAny.subscribeForeignStatesAsync.bind(adapter)
            : undefined,
        unsubscribeForeignStatesAsync: typeof adapterAny.unsubscribeForeignStatesAsync === "function"
            ? adapterAny.unsubscribeForeignStatesAsync.bind(adapter)
            : undefined,
    });
    return base;
}
/** Referenz auf den in Phase B erzeugten Learning-Host (für Phase D). */
function getLearningStateTreeHost() {
    return learningHost;
}
exports.getLearningStateTreeHost = getLearningStateTreeHost;
/** Phase B — EMS-Light-, Planner-, Policy-, Intent- und Learning-Objekte. */
async function ensureEmsLightStateTree(adapter) {
    const version = String(adapter.common?.version ?? "0.0.0");
    const host = adapter;
    await (0, ensure_states_1.ensureEmsLightStates)(host, version);
    const { ensureStatisticsStateTree } = await import("../statistics/index.js");
    await ensureStatisticsStateTree(host);
    await (0, planner_1.ensurePlannerStateTree)(host);
    const policyHost = (0, data_dir_1.withLearningDataPath)(adapter, adapter);
    await (0, policy_1.ensurePolicyStateTree)(policyHost);
    await (0, intent_1.ensureIntentStates)(buildIntentHost(adapter));
    const { ensureAiStateTree } = await import("../ai/index.js");
    await ensureAiStateTree(host);
    const { ensureCompareStateTree } = await import("../ai/compare/index.js");
    await ensureCompareStateTree(host);
    learningHost = await (0, pv_bias_1.ensureLearningStateTree)(adapter);
}
exports.ensureEmsLightStateTree = ensureEmsLightStateTree;
/** Phase F — Runtime, Ticks und initiale Auswertung (nach Bootstrap-Barriere). */
async function startEmsLightPhase1Runtime(adapter) {
    (0, execution_mode_1.setAddonModeReplanHook)((info) => {
        const reason = `replan_addon_execution_mode:${info.addonId}:${info.previous ?? "?"}→${info.next}`;
        if (info.next === "off" && info.addonId !== "global") {
            // Zuerst publizierte Plan-Darstellung leeren, dann Cache für frischen Replan verwerfen.
            void (0, tick_1.invalidatePublishedPlanForAddonOff)(adapter, info.addonId)
                .then(() => (0, tick_1.requestForcedUnifiedReplan)(reason))
                .catch((e) => {
                adapter.log.warn(`invalidate plan on addon off: ${e}`);
                (0, tick_1.requestForcedUnifiedReplan)(reason);
            });
            return;
        }
        (0, tick_1.requestForcedUnifiedReplan)(reason);
    });
    const host = (0, data_dir_1.withLearningDataPath)(adapter, adapter);
    energyDailyRollupHost = buildRollupHost(adapter);
    powerRollupHost = energyDailyRollupHost;
    statisticsHost = energyDailyRollupHost;
    await (0, energy_daily_rollup_1.initEnergyDailyRollup)(energyDailyRollupHost);
    await (0, power_rollup_1.initPowerRollup)(powerRollupHost);
    if (learningHost) {
        await (0, pv_bias_1.startPvBiasLearningRuntime)(adapter, learningHost);
    }
    else {
        learningHost = await (0, pv_bias_1.ensureLearningStateTree)(adapter);
        await (0, pv_bias_1.startPvBiasLearningRuntime)(adapter, learningHost);
    }
    await (0, weather_1.initWeatherLearning)(adapter);
    const policyHost = (0, data_dir_1.withLearningDataPath)(adapter, adapter);
    let policyInitTimedOut = false;
    const policyInitStartedMs = Date.now();
    const policyInit = (0, policy_1.initPolicyEngine)(policyHost)
        .then(() => {
        const ms = Date.now() - policyInitStartedMs;
        if (policyInitTimedOut) {
            adapter.log.info(`Policy Engine init completed after ${ms}ms (startup continued asynchronously)`);
        }
        else {
            adapter.log.debug?.(`Policy Engine init completed in ${ms}ms`);
        }
    })
        .catch((e) => {
        adapter.log.error(`Policy Engine init failed: ${e instanceof Error ? e.stack ?? e.message : e}`);
    });
    await waitWithStartupTimeout(policyInit, POLICY_STARTUP_TIMEOUT_MS, () => {
        policyInitTimedOut = true;
        /*
         * Init läuft bewusst im Hintergrund weiter (Phase-B ensure ist bereits durch).
         * Kein Fehler — nur Hinweis, damit Adapter-Ready nicht blockiert wird.
         */
        adapter.log.info(`Policy Engine init still running after ${POLICY_STARTUP_TIMEOUT_MS}ms; continuing adapter startup (completion will be logged)`);
    });
    const intentHost = buildIntentHost(adapter);
    try {
        await (0, intent_1.initIntentEngine)(intentHost);
    }
    catch (e) {
        adapter.log.error(`User Intent Engine init failed: ${e instanceof Error ? e.stack ?? e.message : e}`);
    }
    policyAdapter = adapter;
    try {
        for (const id of runtime_subscriptions_1.EMS_LIGHT_OWN_STATE_SUBSCRIPTIONS) {
            await adapter.subscribeStatesAsync(id);
        }
    }
    catch (e) {
        adapter.log.warn(`EMS-Light state subscribe: ${e}`);
    }
    await (0, tick_2.runEmsLightPhase1Tick)(host);
    if (energyDailyRollupHost) {
        await (0, energy_daily_rollup_1.tickEnergyDailyRollup)(energyDailyRollupHost);
    }
    if (powerRollupHost) {
        await (0, power_rollup_1.tickPowerRollup)(powerRollupHost);
    }
    if (statisticsHost) {
        await (0, statistics_1.tickStatistics)(statisticsHost).catch((e) => {
            adapter.log.warn(`statistics tick: ${e}`);
        });
    }
    if (energyDailyRollupHost) {
        await (0, day_telemetry_1.tickDayTelemetry)(energyDailyRollupHost).catch((e) => {
            adapter.log.warn(`day_telemetry tick: ${e}`);
        });
    }
    const sec = tickIntervalSec(adapter.config);
    stopEmsLightTick();
    const dailyHostForTick = energyDailyRollupHost;
    const powerHostForTick = powerRollupHost;
    const statisticsHostForTick = statisticsHost;
    tickTimer = setInterval(() => {
        void (0, tick_2.runEmsLightPhase1Tick)(host).catch((e) => {
            adapter.log.error(`EMS-Light tick: ${e}`);
        });
        if (dailyHostForTick) {
            void (0, energy_daily_rollup_1.tickEnergyDailyRollup)(dailyHostForTick).catch((e) => {
                adapter.log.error(`Energy-Daily-Rollup tick: ${e}`);
            });
        }
        if (powerHostForTick) {
            void (0, power_rollup_1.tickPowerRollup)(powerHostForTick).catch((e) => {
                adapter.log.error(`Power-Rollup tick: ${e}`);
            });
        }
        if (statisticsHostForTick) {
            void (0, statistics_1.tickStatistics)(statisticsHostForTick).catch((e) => {
                adapter.log.error(`Statistics tick: ${e}`);
            });
        }
        if (dailyHostForTick) {
            void (0, day_telemetry_1.tickDayTelemetry)(dailyHostForTick).catch((e) => {
                adapter.log.error(`day_telemetry tick: ${e}`);
            });
        }
    }, sec * 1000);
    adapter.log.debug(`EMS-Light Phase 1 ready (read-only, tick ${sec}s)`);
}
exports.startEmsLightPhase1Runtime = startEmsLightPhase1Runtime;
async function initEmsLightPhase1(adapter) {
    await ensureEmsLightStateTree(adapter);
    await startEmsLightPhase1Runtime(adapter);
}
exports.initEmsLightPhase1 = initEmsLightPhase1;
/** Nur Live-Tick-Timer stoppen (Learning-Intervalle laufen weiter). */
function stopEmsLightTick() {
    if (tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
    }
}
async function stopEmsLightPhase1() {
    if (policyAdapter) {
        const adapter = policyAdapter;
        policyAdapter = null;
        for (const id of runtime_subscriptions_1.EMS_LIGHT_OWN_STATE_SUBSCRIPTIONS) {
            void Promise.resolve(adapter.unsubscribeStatesAsync(id)).catch((e) => adapter.log.debug?.(`unsubscribe ${id}: ${e}`));
        }
    }
    (0, intent_1.stopIntentEngine)();
    (0, policy_1.stopPolicyEngine)();
    (0, global_modes_1.resetGlobalModesRuntime)();
    (0, pv_bias_1.stopPvBiasLearning)();
    (0, weather_1.stopWeatherLearning)();
    (0, power_rollup_1.stopPowerRollup)();
    (0, energy_daily_rollup_1.stopEnergyDailyRollup)();
    (0, planner_1.stopPlanner)();
    powerRollupHost = null;
    energyDailyRollupHost = null;
    statisticsHost = null;
    learningHost = null;
    stopEmsLightTick();
}
exports.stopEmsLightPhase1 = stopEmsLightPhase1;
