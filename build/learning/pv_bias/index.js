"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.__isLearningTickInFlightForTest = exports.__hasPvBiasLearningTimerForTest = exports.__resetLearningRuntimeForTest = exports.stopPvBiasLearning = exports.initPvBiasLearning = exports.startPvBiasLearningRuntime = exports.ensureLearningStateTree = void 0;
const ensure_states_1 = require("./ensure_states");
const run_1 = require("./run");
const config_1 = require("./config");
const price_learning_1 = require("../price_learning");
const price_forecast_1 = require("../price_forecast");
const house_load_1 = require("../house_load");
const thermal_runtime_1 = require("../thermal_runtime");
const thermal_boiler_1 = require("../thermal_boiler");
const battery_runtime_1 = require("../battery_runtime");
const energy_daily_rollup_1 = require("../energy_daily_rollup");
const power_rollup_1 = require("../power_rollup");
const pv_horizon_1 = require("../pv_horizon");
const day_telemetry_1 = require("../day_telemetry");
const daily_evaluator_1 = require("../daily_evaluator");
const config_2 = require("../../intent/config");
const data_dir_1 = require("../data_dir");
const history_bridge_1 = require("../history_bridge");
const persistence_mirror_1 = require("../persistence_mirror");
let pvBiasTimer = null;
let learningTickInFlight = false;
/** Phase B — Learning-States ohne Timer oder Persist-Restore. */
async function ensureLearningStateTree(adapter) {
    const host = (0, history_bridge_1.withHistoryBridge)(adapter, (0, data_dir_1.withLearningDataPath)(adapter, adapter));
    await (0, ensure_states_1.ensurePvBiasStates)(host);
    await (0, pv_horizon_1.ensurePvHorizonLearningStates)(host);
    await (0, price_learning_1.ensurePriceLearningStates)(host);
    await (0, price_forecast_1.ensurePriceForecastLearningStates)(host);
    await (0, house_load_1.ensureHouseLoadLearningStates)(host);
    await (0, thermal_runtime_1.ensureThermalRuntimeLearningStates)(host);
    await (0, thermal_boiler_1.ensureThermalBoilerLearningStates)(host);
    await (0, battery_runtime_1.ensureBatteryRuntimeLearningStates)(host);
    await (0, day_telemetry_1.ensureDayTelemetryStates)(host);
    await (0, daily_evaluator_1.ensureDailyEvaluatorStates)(host);
    await (0, persistence_mirror_1.ensureLearningPersistenceStates)(host);
    return host;
}
exports.ensureLearningStateTree = ensureLearningStateTree;
/** Phase D/F — Learning-Timer (Persist-Restore erfolgt in Phase D). */
async function startPvBiasLearningRuntime(adapter, host) {
    const cfg = (0, config_1.pvBiasConfigFromAdapter)(adapter.config);
    stopPvBiasLearning();
    void runLearningTick(host, "startup").catch((e) => {
        adapter.log.error(`PV-Bias/Horizon initial run: ${e}`);
    });
    pvBiasTimer = setInterval(() => {
        void runLearningTick(host, "interval").catch((e) => {
            adapter.log.error(`PV-Bias/Horizon tick: ${e}`);
        });
    }, cfg.intervalSec * 1000);
    adapter.log.debug?.(`EMS-Light PV-Bias + PV-Horizon + Price + House-Load + Thermal + Battery-Runtime ready (read-only, interval ${cfg.intervalSec}s)`);
}
exports.startPvBiasLearningRuntime = startPvBiasLearningRuntime;
async function runLearningTick(host, trigger = "interval") {
    if (learningTickInFlight)
        return;
    learningTickInFlight = true;
    try {
        /*
         * Boiler zuerst: Live-Diagnose darf nicht hinter PV-Bias/House-Load/90-Tage-Puffer-History
         * in der gemeinsamen History-Queue stecken bleiben.
         */
        try {
            await (0, thermal_boiler_1.runThermalBoilerLearning)(host, { trigger: trigger === "startup" ? "startup" : "learning_tick" });
        }
        catch (e) {
            host.log.error(`Boiler-Learning tick: ${e instanceof Error ? e.message : String(e)}`);
        }
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
        /*
         * BLOCK A — Daily Evaluator (rein additiv/diagnostisch). Liest nur day_telemetry,
         * schreibt ausschließlich in sein eigenes findings/scores/learning_state_v1 —
         * nie in die aktiven Learning-Module oberhalb und nie ins reale Planner-/
         * Control-Verhalten. Läuft bewusst im selben (langsamen) Lern-Intervall statt
         * im schnellen EMS-Tick, da day_telemetry-Tage ohnehin nur einmal täglich
         * abschließen.
         */
        try {
            const timezone = (0, config_2.intentAdminConfigFromAdapter)(host.config).timezone || "Europe/Berlin";
            await (0, daily_evaluator_1.runDailyEvaluatorBatch)(host, { timezone });
        }
        catch (e) {
            host.log.error(`daily_evaluator batch: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    finally {
        learningTickInFlight = false;
    }
}
async function initPvBiasLearning(adapter) {
    const host = await ensureLearningStateTree(adapter);
    await startPvBiasLearningRuntime(adapter, host);
}
exports.initPvBiasLearning = initPvBiasLearning;
function stopPvBiasLearning() {
    if (pvBiasTimer) {
        clearInterval(pvBiasTimer);
        pvBiasTimer = null;
    }
}
exports.stopPvBiasLearning = stopPvBiasLearning;
/** Nur für Tests. */
function __resetLearningRuntimeForTest() {
    stopPvBiasLearning();
    learningTickInFlight = false;
}
exports.__resetLearningRuntimeForTest = __resetLearningRuntimeForTest;
function __hasPvBiasLearningTimerForTest() {
    return pvBiasTimer != null;
}
exports.__hasPvBiasLearningTimerForTest = __hasPvBiasLearningTimerForTest;
function __isLearningTickInFlightForTest() {
    return learningTickInFlight;
}
exports.__isLearningTickInFlightForTest = __isLearningTickInFlightForTest;
