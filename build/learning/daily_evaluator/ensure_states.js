"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DAILY_EVALUATOR_STATE_IDS = exports.ensureDailyEvaluatorStates = void 0;
/**
 * BLOCK A — Admin-/Visibility-States. Rein additiv, keine Steuer-States (read-only).
 */
const state_util_1 = require("../../ems_light/state_util");
const constants_1 = require("./constants");
function strState(id, name, def) {
    return {
        id,
        common: { name, type: "string", role: "text", read: true, write: false, def },
        defaultVal: def,
        setDefaultIfEmpty: true,
    };
}
function numState(id, name, unit) {
    return {
        id,
        common: { name, type: "number", role: "value", unit, read: true, write: false, def: null },
        defaultVal: null,
        setDefaultIfEmpty: true,
    };
}
function boolState(id, name, def = false) {
    return {
        id,
        common: { name, type: "boolean", role: "indicator", read: true, write: false, def },
        defaultVal: def,
        setDefaultIfEmpty: true,
    };
}
async function ensureDailyEvaluatorStates(host) {
    await (0, state_util_1.ensureChannel)(host, "learning.daily_evaluator", "EMS-Light Daily Evaluator");
    const defs = [
        strState(constants_1.DAILY_EVALUATOR_STATES.status, "Daily Evaluator Status", "idle"),
        strState(constants_1.DAILY_EVALUATOR_STATES.lastEvaluatedDateKey, "Letzter evaluierter Tag (YYYY-MM-DD)"),
        strState(constants_1.DAILY_EVALUATOR_STATES.lastRunAtIso, "Letzter Lauf (ISO)"),
        strState(constants_1.DAILY_EVALUATOR_STATES.lastError, "Letzter Fehler"),
        numState(constants_1.DAILY_EVALUATOR_STATES.pendingBacklogCount, "Noch nicht evaluierte Tage im Backlog"),
        boolState(constants_1.DAILY_EVALUATOR_STATES.lastDayEvaluable, "Letzter Tag global evaluable"),
        numState(constants_1.DAILY_EVALUATOR_STATES.lastDayGlobalScore, "Letzter Tag GlobalScore", "%"),
        numState(constants_1.DAILY_EVALUATOR_STATES.lastDayFindingsCount, "Letzter Tag Findings-Anzahl"),
        strState(constants_1.DAILY_EVALUATOR_STATES.lastDayTopFindingDe, "Letzter Tag wichtigstes Finding", ""),
        strState(constants_1.DAILY_EVALUATOR_STATES.learningSampleCountJson, "Diagnostisches Learning Sample-Counts (JSON)"),
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensureDailyEvaluatorStates = ensureDailyEvaluatorStates;
exports.DAILY_EVALUATOR_STATE_IDS = Object.values(constants_1.DAILY_EVALUATOR_STATES);
