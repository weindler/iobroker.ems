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
const grid_balance_economics_1 = require("../grid_balance_economics");
const energy_daily_rollup_1 = require("../energy_daily_rollup");
const power_rollup_1 = require("../power_rollup");
const pv_horizon_1 = require("../pv_horizon");
const day_telemetry_1 = require("../day_telemetry");
const daily_evaluator_1 = require("../daily_evaluator");
const climate_shared_power_1 = require("../climate_shared_power");
const ensure_states_2 = require("../climate_shared_power/ensure_states");
const climate_thermal_1 = require("../climate_thermal");
const ensure_states_3 = require("../climate_thermal/ensure_states");
const shadow_engine_1 = require("../shadow_engine");
const economics_1 = require("../../economics");
const ensure_states_4 = require("../../ai/override/ensure_states");
const tick_1 = require("../../ai/override/tick");
const ensure_states_5 = require("../../ai/daily_analyst/ensure_states");
const run_2 = require("../../ai/daily_analyst/run");
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
    await (0, grid_balance_economics_1.ensureGridBalanceEconomicsStates)(host);
    await (0, day_telemetry_1.ensureDayTelemetryStates)(host);
    await (0, daily_evaluator_1.ensureDailyEvaluatorStates)(host);
    await (0, ensure_states_2.ensureClimateSharedPowerRootStates)(host);
    await (0, ensure_states_3.ensureClimateThermalRootStates)(host);
    await (0, shadow_engine_1.ensureShadowEngineStates)(host);
    await (0, economics_1.ensureEconomicsStates)(host);
    await (0, ensure_states_4.ensureAiValidatorStates)(host);
    await (0, ensure_states_5.ensureAiDailyAnalystStates)(host);
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
        try {
            const timezone = (0, config_2.intentAdminConfigFromAdapter)(host.config).timezone || "Europe/Berlin";
            await (0, grid_balance_economics_1.runGridBalanceEconomicsLearning)(host, { timezone });
        }
        catch (e) {
            host.log.error(`grid_balance_economics: ${e instanceof Error ? e.message : String(e)}`);
        }
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
        /*
         * PHASE 3 — Shared-Power/Climate Learning. Liest nur day_telemetry (ClimateRunSegments),
         * schreibt ausschließlich in seine eigene Persistenz/States — keine Fremd-Writes, kein
         * Einfluss auf andere Learning-Module. Läuft im selben langsamen Lern-Intervall.
         */
        try {
            await (0, climate_shared_power_1.runClimateSharedPowerLearning)(host);
        }
        catch (e) {
            host.log.error(`climate_shared_power learning: ${e instanceof Error ? e.message : String(e)}`);
        }
        /*
         * Predictive Climate Foundation — Thermal Learning. Liest nur day_telemetry,
         * schreibt ausschließlich eigene Persistenz/States. Kein Einfluss auf
         * planCooling / Runtime / Unified / Shared-Power-Steuerung.
         */
        try {
            await (0, climate_thermal_1.runClimateThermalLearning)(host);
        }
        catch (e) {
            host.log.error(`climate_thermal learning: ${e instanceof Error ? e.message : String(e)}`);
        }
        /*
         * PHASE 5 — Shadow/Counterfactual-Engine. Rein additiv/diagnostisch, liest nur
         * day_telemetry + Config, schreibt ausschließlich in seine eigene Persistenz. Läuft
         * batch-weise (wie Daily Evaluator) im selben langsamen Lern-Intervall — kein
         * täglicher 90-Tage-Replay, nur der jeweils neue Backlog.
         */
        try {
            const timezone = (0, config_2.intentAdminConfigFromAdapter)(host.config).timezone || "Europe/Berlin";
            await (0, shadow_engine_1.runShadowEngineBatch)(host, { timezone });
        }
        catch (e) {
            host.log.error(`shadow_engine batch: ${e instanceof Error ? e.message : String(e)}`);
        }
        /*
         * PHASE 7 — Wirtschaftlichkeit. Bucht abgeschlossene Tage einmalig (Tarifvorteil aus
         * Statistik, EMS-Vorteil/KI-Mehrwert aus der Shadow-Engine oben), aktualisiert die
         * Zeitraum-Aggregation. Kein Fremd-Write, reines Reporting.
         */
        try {
            await (0, economics_1.tickEconomics)(host);
        }
        catch (e) {
            host.log.error(`economics tick: ${e instanceof Error ? e.message : String(e)}`);
        }
        /*
         * PHASE 6 — KI-Validator TTL-Sweep (rein deterministisch, kein LLM-Aufruf). Läuft
         * unabhängig davon, ob aktuell überhaupt Overrides existieren.
         */
        try {
            await (0, tick_1.syncAiValidatorStates)(host);
        }
        catch (e) {
            host.log.error(`ai validator sweep: ${e instanceof Error ? e.message : String(e)}`);
        }
        /*
         * PHASE 4 — KI Daily Analyst. Höchstens ein LLM-Aufruf pro Kalendertag (idempotent
         * über die persistierte Findings-Datei des Vortags) — kein Hot-Path-Aufruf. Ohne
         * konfiguriertes Token/Mode bleibt dies ein reiner No-Op (status "disabled"/"no_token"),
         * das EMS läuft unverändert weiter.
         */
        try {
            await (0, run_2.maybeRunDailyAnalystAutomatically)(host);
        }
        catch (e) {
            host.log.error(`ai_daily_analyst auto run: ${e instanceof Error ? e.message : String(e)}`);
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
