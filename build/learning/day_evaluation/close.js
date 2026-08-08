"use strict";
/**
 * Tagesabschluss — genau einmal pro lokalem Tag (idempotent, restart-sicher).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.dayEvaluationDirsFromRoot = exports.closeDayEvaluationOnce = void 0;
const data_dir_1 = require("../data_dir");
const build_1 = require("./build");
const feedback_1 = require("./feedback");
const persist_1 = require("./persist");
async function closeDayEvaluationOnce(input) {
    try {
        let store = await (0, persist_1.loadOrEmptyDayEvaluationStore)(input.dayEvalDir);
        if ((0, persist_1.dayEvaluationExists)(store, input.session.date)) {
            return {
                closed: false,
                alreadyClosed: true,
                record: store.days[input.session.date] ?? null,
                store,
                error: null,
            };
        }
        const record = (0, build_1.buildDayEvaluationRecord)(input.session, input.actuals, input.now);
        const upsert = (0, persist_1.upsertDayEvaluationOnce)(store, record);
        if (!upsert.inserted) {
            return {
                closed: false,
                alreadyClosed: true,
                record: upsert.store.days[input.session.date] ?? null,
                store: upsert.store,
                error: null,
            };
        }
        store = upsert.store;
        const feedback = await (0, feedback_1.applyLearningFeedbackFromEvaluation)({
            pvBiasDir: input.pvBiasDir,
            thermalDir: input.thermalDir,
            evaluation: record,
        });
        const withLearning = {
            ...record,
            learningApplied: feedback.skippedReason !== "already_applied",
        };
        store = {
            ...store,
            days: { ...store.days, [record.plan.date]: withLearning },
            updatedAtIso: input.now.toISOString(),
        };
        await (0, persist_1.writeDayEvaluationPersist)(input.dayEvalDir, store);
        return {
            closed: true,
            alreadyClosed: false,
            record: withLearning,
            store,
            error: null,
        };
    }
    catch (e) {
        return {
            closed: false,
            alreadyClosed: false,
            record: null,
            store: await (0, persist_1.loadOrEmptyDayEvaluationStore)(input.dayEvalDir),
            error: String(e),
        };
    }
}
exports.closeDayEvaluationOnce = closeDayEvaluationOnce;
/** Pfade aus durable root ableiten. */
function dayEvaluationDirsFromRoot(durableRoot) {
    return {
        dayEvalDir: (0, data_dir_1.learningDataPathFromRoot)(durableRoot, "learning/day_evaluation"),
        pvBiasDir: (0, data_dir_1.learningDataPathFromRoot)(durableRoot, "learning/pv_bias"),
        thermalDir: (0, data_dir_1.learningDataPathFromRoot)(durableRoot, "learning/thermal_runtime"),
    };
}
exports.dayEvaluationDirsFromRoot = dayEvaluationDirsFromRoot;
