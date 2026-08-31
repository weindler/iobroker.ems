"use strict";
/**
 * BLOCK A — Batch-Trigger + Top-Level-Orchestrierung.
 *
 * Arbeitet beim Lauf ALLE vollständigen, noch nicht evaluierten Day-Telemetry-Tage
 * innerhalb der Retention chronologisch ab (Korrektur #11) — nicht nur „gestern“. Ein
 * Adapter-Ausfall über Mitternacht/mehrere Tage wird so sauber aufgeholt.
 *
 * Schreibt NIE nach day_telemetry oder in aktive Learning-Module. Kein Ergebnis ändert
 * reales Planner-/Control-Verhalten.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.readDailyEvaluatorScores = exports.runDailyEvaluatorBatch = void 0;
const constants_1 = require("../day_telemetry/constants");
const persist_1 = require("../day_telemetry/persist");
const time_1 = require("../../operator/time");
const constants_2 = require("./constants");
const evaluate_1 = require("./evaluate");
const learning_1 = require("./learning");
const persist_2 = require("./persist");
async function publishStatus(host, id, val) {
    if (!host.setStateAsync)
        return;
    try {
        await host.setStateAsync(id, { val, ack: true });
    }
    catch {
        /* Status-States sind best-effort */
    }
}
/**
 * Arbeitet den Backlog chronologisch ab. `force`: erlaubt Re-Evaluation bereits
 * evaluierter Tage (z. B. nach Evaluator-Logik-Update) — überschreibt findings/scores,
 * lässt den Learning-State aber idempotent (lastProcessedDateKey-Gate) unverändert für
 * bereits verarbeitete Tage, außer explizit angefordert.
 */
async function runDailyEvaluatorBatch(host, opts = {}) {
    const now = opts.now ?? new Date();
    const timezone = opts.timezone ?? "Europe/Berlin";
    const todayKey = (0, time_1.localDateKeyInTimezone)(now, timezone);
    const result = {
        processedDateKeys: [],
        skippedAlreadyEvaluated: [],
        skippedIncomplete: [],
        errors: [],
    };
    try {
        const telemetryDir = host.getAbsolutePath(constants_1.DAY_TELEMETRY_CATEGORY);
        const findingsDir = host.getAbsolutePath(constants_2.DAILY_EVALUATOR_FINDINGS_CATEGORY);
        const scoresDir = host.getAbsolutePath(constants_2.DAILY_EVALUATOR_SCORES_CATEGORY);
        const stateDir = host.getAbsolutePath(constants_2.DAILY_EVALUATOR_STATE_CATEGORY);
        const cutoffKey = (0, time_1.addDaysToDateKey)(todayKey, -(constants_1.DAY_TELEMETRY_RETENTION_DAYS - 1));
        const allKeys = (await (0, persist_1.listDayTelemetryDateKeys)(telemetryDir)).filter((k) => k >= cutoffKey);
        const evaluatedKeys = await (0, persist_2.listEvaluatedDateKeys)(scoresDir);
        let learningState = await (0, persist_2.loadDailyEvaluatorLearningState)(stateDir);
        for (const dateKey of allKeys.sort()) {
            if (dateKey >= todayKey)
                continue; /* heutiger/zukünftiger Tag ist per Definition nicht complete */
            if (!opts.force && evaluatedKeys.has(dateKey)) {
                result.skippedAlreadyEvaluated.push(dateKey);
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
                const nextKey = (0, time_1.addDaysToDateKey)(dateKey, 1);
                const nextDay = await (0, persist_1.readDayTelemetryDay)(telemetryDir, nextKey);
                const { record, findings } = (0, evaluate_1.evaluateDay)({
                    day,
                    nextDay,
                    sourceUpdatedAtIso: day.lastSampleIso ?? now.toISOString(),
                    sourceTelemetrySchemaVersion: 2,
                    evaluatedAtIso: now.toISOString(),
                });
                await (0, persist_2.writeFindingsDay)(findingsDir, dateKey, findings);
                await (0, persist_2.writeScoresDay)(scoresDir, record);
                if (!opts.force || opts.reapplyLearningOnForce) {
                    learningState = (0, learning_1.applyDayToLearningState)(learningState, record, findings, now.toISOString());
                    await (0, persist_2.writeDailyEvaluatorLearningState)(stateDir, learningState);
                }
                result.processedDateKeys.push(dateKey);
                await publishStatus(host, constants_2.DAILY_EVALUATOR_STATES.lastEvaluatedDateKey, dateKey);
                await publishStatus(host, constants_2.DAILY_EVALUATOR_STATES.lastDayEvaluable, day.evaluable);
                await publishStatus(host, constants_2.DAILY_EVALUATOR_STATES.lastDayGlobalScore, record.globalScore);
                await publishStatus(host, constants_2.DAILY_EVALUATOR_STATES.lastDayFindingsCount, record.findingsCount);
                const topFinding = findings.find((f) => !f.insufficientData && !f.notApplicable && f.explanationDe);
                await publishStatus(host, constants_2.DAILY_EVALUATOR_STATES.lastDayTopFindingDe, topFinding?.explanationDe.slice(0, 240) ?? "");
            }
            catch (e) {
                result.errors.push({ dateKey, error: e instanceof Error ? e.message : String(e) });
            }
        }
        await (0, persist_2.pruneDailyEvaluatorFiles)(findingsDir, scoresDir, todayKey);
        await publishStatus(host, constants_2.DAILY_EVALUATOR_STATES.status, result.errors.length > 0 ? "error" : "ok");
        await publishStatus(host, constants_2.DAILY_EVALUATOR_STATES.lastRunAtIso, now.toISOString());
        await publishStatus(host, constants_2.DAILY_EVALUATOR_STATES.pendingBacklogCount, Math.max(0, allKeys.length - evaluatedKeys.size - result.processedDateKeys.length));
    }
    catch (e) {
        result.errors.push({ dateKey: "batch", error: e instanceof Error ? e.message : String(e) });
        host.log?.warn?.(`daily_evaluator batch: ${e instanceof Error ? e.message : String(e)}`);
        await publishStatus(host, constants_2.DAILY_EVALUATOR_STATES.status, "error");
        await publishStatus(host, constants_2.DAILY_EVALUATOR_STATES.lastError, e instanceof Error ? e.message : String(e));
    }
    return result;
}
exports.runDailyEvaluatorBatch = runDailyEvaluatorBatch;
async function readDailyEvaluatorScores(host, dateKey) {
    const scoresDir = host.getAbsolutePath(constants_2.DAILY_EVALUATOR_SCORES_CATEGORY);
    return (0, persist_2.readScoresDay)(scoresDir, dateKey);
}
exports.readDailyEvaluatorScores = readDailyEvaluatorScores;
