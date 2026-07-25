"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runEmsLightPhase1Tick = void 0;
const ems_activity_1 = require("../ems_activity");
const tree_paths_1 = require("../tree_paths");
const live_cache_1 = require("./live_cache");
const run_1 = require("../planner/run");
/**
 * Operator Forecast → Daily Plan → Allocation.
 * Always on for production control (addons consume these plans).
 * Shadow/Takeover/Authority stay disabled separately.
 */
function operatorForecastPathEnabled(_config) {
    return true;
}
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
        await (0, run_1.runPlannerTick)(host);
    }
    catch (e) {
        hints.push(`planner: ${String(e)}`);
    }
    if (operatorForecastPathEnabled(host.config)) {
        const { runGridSupplyTick } = await Promise.resolve().then(() => __importStar(require("../operator/supply/grid_tick.js")));
        const { runFlexibleContributionsTick } = await Promise.resolve().then(() => __importStar(require("../operator/contributions/flexible/tick.js")));
        const { runForecastPlanTick } = await Promise.resolve().then(() => __importStar(require("../operator/forecast/tick.js")));
        const { runDailyPlanTick } = await Promise.resolve().then(() => __importStar(require("../operator/daily_plan/tick.js")));
        let gridForecast;
        try {
            gridForecast = await runGridSupplyTick(host);
        }
        catch (e) {
            hints.push(`grid_supply: ${String(e)}`);
        }
        let flexibleContributions = [];
        try {
            flexibleContributions = await runFlexibleContributionsTick(host, gridForecast);
        }
        catch (e) {
            hints.push(`flexible_contributions: ${String(e)}`);
        }
        let forecastPlan;
        try {
            forecastPlan = await runForecastPlanTick(host, gridForecast, flexibleContributions);
        }
        catch (e) {
            hints.push(`forecast_plan: ${String(e)}`);
        }
        if (forecastPlan) {
            let plan = null;
            try {
                plan = await runDailyPlanTick(host, forecastPlan);
            }
            catch (e) {
                hints.push(`daily_plan: ${String(e)}`);
            }
            if (plan) {
                try {
                    const { maybeTriggerAiOptimizationOnDailyPlanChange } = await Promise.resolve().then(() => __importStar(require("../ai/index.js")));
                    await maybeTriggerAiOptimizationOnDailyPlanChange(host, plan);
                }
                catch (e) {
                    hints.push(`ai_optimization: ${String(e)}`);
                }
                try {
                    const { maybeUpdatePlanCompareOnDailyPlanChange } = await Promise.resolve().then(() => __importStar(require("../ai/compare/index.js")));
                    await maybeUpdatePlanCompareOnDailyPlanChange(host, plan);
                }
                catch (e) {
                    hints.push(`plan_compare: ${String(e)}`);
                }
            }
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
