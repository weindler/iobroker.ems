"use strict";
/**
 * Persistierte Tagesbewertung (Schritt 7) — kompakt, keine State-Flut.
 * Unknown bleibt null — keine Fake-0.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.pctError = exports.absError = exports.emptyDayEvaluationStore = exports.DAY_EVAL_PERSIST_FILE = exports.DAY_EVAL_RETENTION_DAYS = exports.DAY_EVAL_SCHEMA = exports.DAY_EVAL_MODULE = void 0;
exports.DAY_EVAL_MODULE = "day_evaluation";
exports.DAY_EVAL_SCHEMA = 1;
exports.DAY_EVAL_RETENTION_DAYS = 120;
exports.DAY_EVAL_PERSIST_FILE = "day_evaluation_v1.json";
function emptyDayEvaluationStore() {
    return {
        module: exports.DAY_EVAL_MODULE,
        schemaVersion: exports.DAY_EVAL_SCHEMA,
        updatedAtIso: new Date(0).toISOString(),
        days: {},
    };
}
exports.emptyDayEvaluationStore = emptyDayEvaluationStore;
function absError(expected, actual) {
    if (expected === null || actual === null)
        return null;
    if (!Number.isFinite(expected) || !Number.isFinite(actual))
        return null;
    return Math.round(Math.abs(actual - expected) * 1000) / 1000;
}
exports.absError = absError;
function pctError(expected, actual) {
    if (expected === null || actual === null || !Number.isFinite(expected) || expected === 0)
        return null;
    if (!Number.isFinite(actual))
        return null;
    return Math.round(((actual - expected) / expected) * 1000) / 10;
}
exports.pctError = pctError;
