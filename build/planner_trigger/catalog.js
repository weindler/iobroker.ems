"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchPlannerTriggerState = exports.isDeniedPlannerTriggerState = exports.PLANNER_TRIGGER_DENYLIST_PREFIXES = exports.PLANNER_TRIGGER_ALLOWLIST = void 0;
/** Positive list — only these (and prefixes) may auto-trigger. */
exports.PLANNER_TRIGGER_ALLOWLIST = [
    // Live telemetry
    { id: "live.pv.power_w", match: "exact", class: "telemetry", reasonCode: "telemetry_change", ackPolicy: "any" },
    { id: "live.battery.house_load_w", match: "exact", class: "telemetry", reasonCode: "telemetry_change", ackPolicy: "any" },
    { id: "live.battery.soc_pct", match: "exact", class: "telemetry", reasonCode: "telemetry_change", ackPolicy: "any" },
    { id: "live.thermal.buffer_temp_c", match: "exact", class: "telemetry", reasonCode: "telemetry_change", ackPolicy: "any" },
    { id: "live.price.now_ct_per_kwh", match: "exact", class: "price", reasonCode: "price_change", ackPolicy: "any" },
    { id: "live.grid.", match: "prefix", class: "telemetry", reasonCode: "telemetry_change", ackPolicy: "any" },
    // Global / policy / config surfaces that feed the snapshot
    { id: "global_modes.active", match: "exact", class: "configuration", reasonCode: "config_change", ackPolicy: "any" },
    { id: "global.execution_mode", match: "exact", class: "configuration", reasonCode: "config_change", ackPolicy: "conscious" },
    { id: "policy.global.", match: "prefix", class: "constraint", reasonCode: "constraint_change", ackPolicy: "any" },
    { id: "economics.config.", match: "prefix", class: "price", reasonCode: "price_change", ackPolicy: "conscious" },
    // Learning outputs that feed planner inputs
    { id: "learning.pv_bias.", match: "prefix", class: "learning", reasonCode: "learning_change", ackPolicy: "ack_true" },
    { id: "learning.pv_horizon.", match: "prefix", class: "forecast", reasonCode: "forecast_change", ackPolicy: "ack_true" },
    { id: "learning.house_load.", match: "prefix", class: "learning", reasonCode: "learning_change", ackPolicy: "ack_true" },
    { id: "learning.weather.", match: "prefix", class: "forecast", reasonCode: "forecast_change", ackPolicy: "ack_true" },
    { id: "learning.thermal_runtime.", match: "prefix", class: "learning", reasonCode: "learning_change", ackPolicy: "ack_true" },
    // Battery / wallbox / immersion / AC planning surfaces
    { id: "battery.", match: "prefix", class: "telemetry", reasonCode: "telemetry_change", ackPolicy: "any" },
    { id: "wallbox.", match: "prefix", class: "telemetry", reasonCode: "telemetry_change", ackPolicy: "any" },
    { id: "immersion_heater.", match: "prefix", class: "telemetry", reasonCode: "telemetry_change", ackPolicy: "any" },
    { id: "air_conditioning.", match: "prefix", class: "telemetry", reasonCode: "telemetry_change", ackPolicy: "any" },
    { id: "addons.governance.", match: "prefix", class: "configuration", reasonCode: "config_change", ackPolicy: "conscious" },
    { id: "user_intent.", match: "prefix", class: "configuration", reasonCode: "config_change", ackPolicy: "conscious" },
    // Mapping-related control objects (conscious writes)
    { id: "mapping.", match: "prefix", class: "mapping", reasonCode: "mapping_change", ackPolicy: "conscious" },
];
/**
 * Hard exclude — never auto-trigger, even if an allowlist prefix would match.
 * Prevents self-reinforcing loops from planner outputs / coordinator diagnostics.
 */
exports.PLANNER_TRIGGER_DENYLIST_PREFIXES = [
    "planner.coordinator.",
    "planner.takeover.",
    "planner.authority.",
    "planner.forecast.",
    "planner.daily.",
    "planner.trigger.",
    "operator.forecast.",
    "operator.daily_plan.",
    "operator.supply.grid.",
    "operator.contributions.",
    "forecast_plan",
    "daily_plan",
];
function isDeniedPlannerTriggerState(relativeId) {
    return exports.PLANNER_TRIGGER_DENYLIST_PREFIXES.some((p) => relativeId === p || relativeId.startsWith(p));
}
exports.isDeniedPlannerTriggerState = isDeniedPlannerTriggerState;
function ackMatches(policy, ack) {
    if (policy === "any")
        return true;
    if (policy === "conscious")
        return ack !== true;
    if (policy === "ack_true")
        return ack === true;
    return false;
}
function matchPlannerTriggerState(relativeId, ack) {
    if (isDeniedPlannerTriggerState(relativeId)) {
        return null;
    }
    for (const entry of exports.PLANNER_TRIGGER_ALLOWLIST) {
        const matches = entry.match === "exact" ? relativeId === entry.id : relativeId.startsWith(entry.id);
        if (!matches)
            continue;
        if (!ackMatches(entry.ackPolicy, ack))
            continue;
        return entry;
    }
    return null;
}
exports.matchPlannerTriggerState = matchPlannerTriggerState;
