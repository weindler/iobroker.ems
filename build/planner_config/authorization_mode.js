"use strict";
/** Native takeover authorization mode — durable across restarts. Default: disabled. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.plannerTakeoverAuthorizationModeFromConfig = exports.parsePlannerTakeoverAuthorizationMode = exports.isPlannerTakeoverAuthorizationMode = exports.PLANNER_TAKEOVER_AUTHORIZATION_MODE_DEFAULT = exports.PLANNER_TAKEOVER_AUTHORIZATION_MODE_CONFIG_KEY = exports.PLANNER_TAKEOVER_AUTHORIZATION_MODES = void 0;
exports.PLANNER_TAKEOVER_AUTHORIZATION_MODES = ["disabled", "manual_prepare"];
exports.PLANNER_TAKEOVER_AUTHORIZATION_MODE_CONFIG_KEY = "planner_takeover_authorization_mode";
exports.PLANNER_TAKEOVER_AUTHORIZATION_MODE_DEFAULT = "disabled";
function isPlannerTakeoverAuthorizationMode(value) {
    return (typeof value === "string" &&
        exports.PLANNER_TAKEOVER_AUTHORIZATION_MODES.includes(value));
}
exports.isPlannerTakeoverAuthorizationMode = isPlannerTakeoverAuthorizationMode;
function parsePlannerTakeoverAuthorizationMode(raw) {
    if (raw === undefined || raw === null || raw === "") {
        return { mode: exports.PLANNER_TAKEOVER_AUTHORIZATION_MODE_DEFAULT, clamped: false };
    }
    if (isPlannerTakeoverAuthorizationMode(raw)) {
        return { mode: raw, clamped: false };
    }
    return { mode: exports.PLANNER_TAKEOVER_AUTHORIZATION_MODE_DEFAULT, clamped: true };
}
exports.parsePlannerTakeoverAuthorizationMode = parsePlannerTakeoverAuthorizationMode;
function plannerTakeoverAuthorizationModeFromConfig(config) {
    const raw = config && typeof config === "object"
        ? config[exports.PLANNER_TAKEOVER_AUTHORIZATION_MODE_CONFIG_KEY]
        : undefined;
    const parsed = parsePlannerTakeoverAuthorizationMode(raw);
    return { ...parsed, raw };
}
exports.plannerTakeoverAuthorizationModeFromConfig = plannerTakeoverAuthorizationModeFromConfig;
