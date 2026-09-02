"use strict";
/**
 * PHASE 5 — Batch-Orchestrierung der Shadow-/Counterfactual-Engine.
 *
 * Arbeitet wie der Daily Evaluator (siehe learning/daily_evaluator/run.ts) den Backlog
 * abgeschlossener, noch nicht simulierter day_telemetry-Tage chronologisch ab. Schreibt
 * NIE nach day_telemetry und beeinflusst nie reales Planner-/Control-Verhalten — reines
 * Reporting/Nachweis.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHADOW_ENGINE_STATE_CATEGORY = exports.readShadowDayResult = exports.runShadowEngineBatch = exports.buildShadowDayRecord = void 0;
const constants_1 = require("../day_telemetry/constants");
const persist_1 = require("../day_telemetry/persist");
const time_1 = require("../../operator/time");
const limits_1 = require("../../addons/battery/core/limits");
const ensure_states_1 = require("../../addons/battery/ensure_states");
const config_1 = require("../../statistics/config");
const state_util_1 = require("../../ems_light/state_util");
const constants_2 = require("./constants");
Object.defineProperty(exports, "SHADOW_ENGINE_STATE_CATEGORY", { enumerable: true, get: function () { return constants_2.SHADOW_ENGINE_STATE_CATEGORY; } });
const persist_2 = require("./persist");
const simulate_1 = require("./simulate");
const persist_3 = require("../grid_balance_economics/persist");
const override_ledger_1 = require("../../ai/override_ledger");
async function publish(host, id, val) {
    if (!host.setStateAsync)
        return;
    try {
        await host.setStateAsync(id, { val, ack: true });
    }
    catch {
        /* best-effort */
    }
}
/** Für einen einzelnen Tag: reale + simulierte Welten berechnen (reine Funktion, kein I/O). */
function buildShadowDayRecord(dateKey, day, previousDay, batteryParams, feedInCtPerKwh, aiOverrideActiveForDay, generatedAtIso, economicsLearning) {
    const real = (0, simulate_1.computeRealDayResult)(day, feedInCtPerKwh);
    const startSocPct = lastNonNull(previousDay?.buckets.batterySocEndPct ?? []) ?? real.socStartPct ?? null;
    const referenceNoEms = (0, simulate_1.simulateReferenceNoEms)(day, { ...batteryParams, startSocPct }, feedInCtPerKwh);
    const referenceSonnenNative = (0, simulate_1.simulateReferenceSonnenNative)(real, day, economicsLearning ?? { usable: false, alpha: null, beta: null }, feedInCtPerKwh);
    const emsWithoutAi = (0, simulate_1.simulateEmsWithoutAi)(real, aiOverrideActiveForDay);
    return {
        module: constants_2.SHADOW_ENGINE_MODULE,
        schemaVersion: constants_2.SHADOW_ENGINE_SCHEMA_VERSION,
        dateKey,
        timezone: day.timezone,
        generatedAtIso,
        sourceTelemetryLastSampleIso: day.lastSampleIso,
        dayEvaluable: day.evaluable,
        real,
        strategies: {
            reference_no_ems: referenceNoEms,
            reference_sonnen_native: referenceSonnenNative,
            ems_without_ai: emsWithoutAi,
        },
    };
}
exports.buildShadowDayRecord = buildShadowDayRecord;
function lastNonNull(arr) {
    for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i] !== null)
            return arr[i];
    }
    return null;
}
async function runShadowEngineBatch(host, opts = {}) {
    const now = opts.now ?? new Date();
    const timezone = opts.timezone ?? "Europe/Berlin";
    const todayKey = (0, time_1.localDateKeyInTimezone)(now, timezone);
    const result = {
        processedDateKeys: [],
        skippedAlreadyProcessed: [],
        skippedIncomplete: [],
        errors: [],
    };
    try {
        const telemetryDir = host.getAbsolutePath(constants_1.DAY_TELEMETRY_CATEGORY);
        const resultsDir = host.getAbsolutePath(constants_2.SHADOW_ENGINE_RESULTS_CATEGORY);
        const cutoffKey = (0, time_1.addDaysToDateKey)(todayKey, -(constants_1.DAY_TELEMETRY_RETENTION_DAYS - 1));
        const allKeys = (await (0, persist_1.listDayTelemetryDateKeys)(telemetryDir)).filter((k) => k >= cutoffKey);
        const processedKeys = await (0, persist_2.listShadowEvaluatedDateKeys)(resultsDir);
        const limits = (0, limits_1.hardwareLimitsFromConfig)(host.config);
        const usableCapacityKwh = host.getStateAsync
            ? (0, state_util_1.asNum)((await host.getStateAsync(ensure_states_1.BAT.telemetry.capacityEffectiveKwh))?.val)
            : null;
        const feedInCtPerKwh = (0, config_1.statisticsConfigFromAdapter)(host.config).feedInCtPerKwh;
        const batteryParams = {
            usableCapacityKwh,
            minSocPct: limits.minSocPct,
            maxSocPct: limits.maxSocPct,
            maxChargeW: limits.maxChargeW,
            maxDischargeW: limits.maxDischargeW,
        };
        const ecoPersist = await (0, persist_3.readGridBalanceEconomicsPersist)((0, persist_3.gridBalanceEconomicsDirFromHost)(host.getAbsolutePath));
        const economicsLearning = ecoPersist
            ? {
                usable: ecoPersist.alphaBeta.usable,
                alpha: ecoPersist.alphaBeta.alpha,
                beta: ecoPersist.alphaBeta.beta,
            }
            : null;
        let lastEvaluated = null;
        for (const dateKey of allKeys.sort()) {
            if (dateKey >= todayKey)
                continue;
            if (processedKeys.has(dateKey)) {
                result.skippedAlreadyProcessed.push(dateKey);
                continue;
            }
            try {
                const day = await (0, persist_1.readDayTelemetryDay)(telemetryDir, dateKey);
                if (!day) {
                    result.errors.push({ dateKey, error: "telemetry_day_not_readable" });
                    continue;
                }
                if (!day.complete) {
                    result.skippedIncomplete.push(dateKey);
                    continue;
                }
                const prevKey = (0, time_1.addDaysToDateKey)(dateKey, -1);
                const previousDay = await (0, persist_1.readDayTelemetryDay)(telemetryDir, prevKey);
                const aiOverrideActive = await (0, override_ledger_1.wasAiOverrideActiveOnDate)(host, dateKey);
                const record = buildShadowDayRecord(dateKey, day, previousDay, batteryParams, feedInCtPerKwh, aiOverrideActive, now.toISOString(), economicsLearning);
                await (0, persist_2.writeShadowDayRecord)(resultsDir, record);
                result.processedDateKeys.push(dateKey);
                lastEvaluated = dateKey;
            }
            catch (e) {
                result.errors.push({ dateKey, error: e instanceof Error ? e.message : String(e) });
            }
        }
        await (0, persist_2.pruneShadowEngineFiles)(resultsDir, todayKey);
        if (lastEvaluated) {
            await publish(host, "learning.shadow_engine.last_evaluated_date_key", lastEvaluated);
            const rec = await (0, persist_2.readShadowDayRecord)(resultsDir, lastEvaluated);
            if (rec) {
                await publish(host, "learning.shadow_engine.yesterday_real_net_cost_eur", rec.real.netCostEur);
                await publish(host, "learning.shadow_engine.yesterday_reference_no_ems_net_cost_eur", rec.strategies.reference_no_ems?.netCostEur ?? null);
                await publish(host, "learning.shadow_engine.yesterday_reference_sonnen_native_net_cost_eur", rec.strategies.reference_sonnen_native?.netCostEur ?? null);
                await publish(host, "learning.shadow_engine.yesterday_ems_without_ai_net_cost_eur", rec.strategies.ems_without_ai?.netCostEur ?? null);
            }
        }
        const evaluatedCount = (await (0, persist_2.listShadowEvaluatedDateKeys)(resultsDir)).size;
        await publish(host, "learning.shadow_engine.evaluated_days_count", evaluatedCount);
        await publish(host, "learning.shadow_engine.pending_backlog_count", Math.max(0, allKeys.length - evaluatedCount));
        await publish(host, "learning.shadow_engine.status", result.errors.length > 0 ? "error" : "ok");
        await publish(host, "learning.shadow_engine.last_run_at", now.toISOString());
        await publish(host, "learning.shadow_engine.last_error", result.errors[0]?.error ?? "");
    }
    catch (e) {
        result.errors.push({ dateKey: "batch", error: e instanceof Error ? e.message : String(e) });
        host.log?.warn?.(`shadow_engine batch: ${e instanceof Error ? e.message : String(e)}`);
        await publish(host, "learning.shadow_engine.status", "error");
        await publish(host, "learning.shadow_engine.last_error", e instanceof Error ? e.message : String(e));
    }
    return result;
}
exports.runShadowEngineBatch = runShadowEngineBatch;
async function readShadowDayResult(host, dateKey) {
    const resultsDir = host.getAbsolutePath(constants_2.SHADOW_ENGINE_RESULTS_CATEGORY);
    return (0, persist_2.readShadowDayRecord)(resultsDir, dateKey);
}
exports.readShadowDayResult = readShadowDayResult;
