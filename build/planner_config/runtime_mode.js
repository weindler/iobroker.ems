"use strict";
/** Native planner runtime mode — durable across adapter restarts. Default: off. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.plannerRuntimeModeAllowsAuto = exports.plannerRuntimeModeAllowsManual = exports.plannerRuntimeModeFromConfig = exports.parsePlannerRuntimeMode = exports.isPlannerRuntimeMode = exports.PLANNER_RUNTIME_MODE_DEFAULT = exports.PLANNER_RUNTIME_MODE_CONFIG_KEY = exports.PLANNER_RUNTIME_MODES = void 0;
exports.PLANNER_RUNTIME_MODES = ["off", "shadow_manual", "shadow_auto"];
/** Admin / native config key (jsonConfig). */
exports.PLANNER_RUNTIME_MODE_CONFIG_KEY = "planner_runtime_mode";
exports.PLANNER_RUNTIME_MODE_DEFAULT = "off";
function isPlannerRuntimeMode(value) {
    return typeof value === "string" && exports.PLANNER_RUNTIME_MODES.includes(value);
}
exports.isPlannerRuntimeMode = isPlannerRuntimeMode;
/**
 * Clamp invalid / missing values to `off`.
 * Returns `{ mode, clamped }` where `clamped` is true when the raw value was invalid.
 */
function parsePlannerRuntimeMode(raw) {
    if (raw === undefined || raw === null || raw === "") {
        return { mode: exports.PLANNER_RUNTIME_MODE_DEFAULT, clamped: false };
    }
    if (isPlannerRuntimeMode(raw)) {
        return { mode: raw, clamped: false };
    }
    return { mode: exports.PLANNER_RUNTIME_MODE_DEFAULT, clamped: true };
}
exports.parsePlannerRuntimeMode = parsePlannerRuntimeMode;
function plannerRuntimeModeFromConfig(config) {
    const raw = config && typeof config === "object"
        ? config[exports.PLANNER_RUNTIME_MODE_CONFIG_KEY]
        : undefined;
    const parsed = parsePlannerRuntimeMode(raw);
    return { ...parsed, raw };
}
exports.plannerRuntimeModeFromConfig = plannerRuntimeModeFromConfig;
function plannerRuntimeModeAllowsManual(mode) {
    return mode === "shadow_manual" || mode === "shadow_auto";
}
exports.plannerRuntimeModeAllowsManual = plannerRuntimeModeAllowsManual;
function plannerRuntimeModeAllowsAuto(mode) {
    return mode === "shadow_auto";
}
exports.plannerRuntimeModeAllowsAuto = plannerRuntimeModeAllowsAuto;
