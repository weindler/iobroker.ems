"use strict";
/** Native requested planner authority source — durable across restarts. Default: legacy. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.plannerRequestedAuthorityFromConfig = exports.parsePlannerRequestedAuthority = exports.isPlannerRequestedAuthority = exports.PLANNER_AUTHORITATIVE_SOURCE_DEFAULT = exports.PLANNER_AUTHORITATIVE_SOURCE_CONFIG_KEY = exports.PLANNER_REQUESTED_AUTHORITIES = void 0;
exports.PLANNER_REQUESTED_AUTHORITIES = ["legacy", "worker_dryrun"];
exports.PLANNER_AUTHORITATIVE_SOURCE_CONFIG_KEY = "planner_authoritative_source";
exports.PLANNER_AUTHORITATIVE_SOURCE_DEFAULT = "legacy";
function isPlannerRequestedAuthority(value) {
    return (typeof value === "string" &&
        exports.PLANNER_REQUESTED_AUTHORITIES.includes(value));
}
exports.isPlannerRequestedAuthority = isPlannerRequestedAuthority;
function parsePlannerRequestedAuthority(raw) {
    if (raw === undefined || raw === null || raw === "") {
        return { mode: exports.PLANNER_AUTHORITATIVE_SOURCE_DEFAULT, clamped: false };
    }
    if (isPlannerRequestedAuthority(raw)) {
        return { mode: raw, clamped: false };
    }
    return { mode: exports.PLANNER_AUTHORITATIVE_SOURCE_DEFAULT, clamped: true };
}
exports.parsePlannerRequestedAuthority = parsePlannerRequestedAuthority;
function plannerRequestedAuthorityFromConfig(config) {
    const raw = config && typeof config === "object"
        ? config[exports.PLANNER_AUTHORITATIVE_SOURCE_CONFIG_KEY]
        : undefined;
    const parsed = parsePlannerRequestedAuthority(raw);
    return { ...parsed, raw };
}
exports.plannerRequestedAuthorityFromConfig = plannerRequestedAuthorityFromConfig;
