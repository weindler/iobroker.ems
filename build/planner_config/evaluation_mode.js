"use strict";
/** Native takeover evaluation mode — durable across restarts. Default: disabled. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.plannerTakeoverEvaluationModeFromConfig = exports.parsePlannerTakeoverEvaluationMode = exports.isPlannerTakeoverEvaluationMode = exports.PLANNER_TAKEOVER_EVALUATION_MODE_DEFAULT = exports.PLANNER_TAKEOVER_EVALUATION_MODE_CONFIG_KEY = exports.PLANNER_TAKEOVER_EVALUATION_MODES = void 0;
exports.PLANNER_TAKEOVER_EVALUATION_MODES = ["disabled", "observe"];
/** Admin / native config key (jsonConfig). */
exports.PLANNER_TAKEOVER_EVALUATION_MODE_CONFIG_KEY = "planner_takeover_evaluation_mode";
exports.PLANNER_TAKEOVER_EVALUATION_MODE_DEFAULT = "disabled";
function isPlannerTakeoverEvaluationMode(value) {
    return (typeof value === "string" &&
        exports.PLANNER_TAKEOVER_EVALUATION_MODES.includes(value));
}
exports.isPlannerTakeoverEvaluationMode = isPlannerTakeoverEvaluationMode;
/**
 * Clamp invalid / missing values to `disabled`.
 */
function parsePlannerTakeoverEvaluationMode(raw) {
    if (raw === undefined || raw === null || raw === "") {
        return { mode: exports.PLANNER_TAKEOVER_EVALUATION_MODE_DEFAULT, clamped: false };
    }
    if (isPlannerTakeoverEvaluationMode(raw)) {
        return { mode: raw, clamped: false };
    }
    return { mode: exports.PLANNER_TAKEOVER_EVALUATION_MODE_DEFAULT, clamped: true };
}
exports.parsePlannerTakeoverEvaluationMode = parsePlannerTakeoverEvaluationMode;
function plannerTakeoverEvaluationModeFromConfig(config) {
    const raw = config && typeof config === "object"
        ? config[exports.PLANNER_TAKEOVER_EVALUATION_MODE_CONFIG_KEY]
        : undefined;
    const parsed = parsePlannerTakeoverEvaluationMode(raw);
    return { ...parsed, raw };
}
exports.plannerTakeoverEvaluationModeFromConfig = plannerTakeoverEvaluationModeFromConfig;
