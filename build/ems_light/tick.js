"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runEmsLightPhase1Tick = void 0;
const ems_activity_1 = require("../ems_activity");
const tree_paths_1 = require("../tree_paths");
const live_cache_1 = require("./live_cache");
const planner_1 = require("../planner");
const grid_tick_1 = require("../operator/supply/grid_tick");
const tick_1 = require("../operator/contributions/flexible/tick");
const tick_2 = require("../operator/forecast/tick");
const tick_3 = require("../operator/daily_plan/tick");
async function runEmsLightPhase1Tick(host) {
    (0, ems_activity_1.touchEmsActivity)();
    const ts = new Date().toISOString();
    const hints = [];
    let executionMode = "dryrun";
    try {
        const globalMode = await host.getStateAsync(tree_paths_1.GLOBAL.executionMode);
        if (globalMode?.val != null && String(globalMode.val).trim() !== "") {
            executionMode = String(globalMode.val).trim().toLowerCase();
        }
        else {
            hints.push("global.execution_mode nicht gesetzt");
        }
    }
    catch {
        hints.push("global.execution_mode nicht lesbar");
    }
    try {
        await host.setStateAsync("execution.safety.global_execution_mode", {
            val: executionMode,
            ack: true,
        });
    }
    catch (e) {
        hints.push(`execution.safety.global_execution_mode: ${String(e)}`);
    }
    let liveResult = { updated: [], missing: [], errors: [] };
    try {
        liveResult = await (0, live_cache_1.refreshLiveCache)(host);
    }
    catch (e) {
        hints.push(`live_cache: ${String(e)}`);
        liveResult.errors.push(String(e));
    }
    try {
        await (0, planner_1.runPlannerTick)(host);
    }
    catch (e) {
        hints.push(`planner: ${String(e)}`);
    }
    let gridForecast;
    try {
        gridForecast = await (0, grid_tick_1.runGridSupplyTick)(host);
    }
    catch (e) {
        hints.push(`grid_supply: ${String(e)}`);
    }
    let flexibleContributions = [];
    try {
        flexibleContributions = await (0, tick_1.runFlexibleContributionsTick)(host, gridForecast);
    }
    catch (e) {
        hints.push(`flexible_contributions: ${String(e)}`);
    }
    let forecastPlan;
    try {
        forecastPlan = await (0, tick_2.runForecastPlanTick)(host, gridForecast, flexibleContributions);
    }
    catch (e) {
        hints.push(`forecast_plan: ${String(e)}`);
    }
    if (forecastPlan) {
        try {
            await (0, tick_3.runDailyPlanTick)(host, forecastPlan);
        }
        catch (e) {
            hints.push(`daily_plan: ${String(e)}`);
        }
    }
    const health = (0, live_cache_1.deriveHealth)(liveResult, !hints.some((h) => h.includes("global.execution_mode nicht")));
    const summaryParts = [
        `Phase 1 read-only. Modus=${executionMode}.`,
        (0, live_cache_1.formatLiveCacheSummary)(liveResult),
        ...hints,
    ];
    try {
        await host.setStateAsync("system.last_tick_at", { val: ts, ack: true });
        await host.setStateAsync("system.health", { val: health, ack: true });
        await host.setStateAsync("execution.safety.summary_de", {
            val: summaryParts.join(" ").trim().slice(0, 480),
            ack: true,
        });
    }
    catch {
        // kein Throw — Phase 1 soll robust bleiben
    }
}
exports.runEmsLightPhase1Tick = runEmsLightPhase1Tick;
