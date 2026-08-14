"use strict";
/**
 * Phase 3 takeover decision types (diagnostic only — no writes).
 * Planner/decision code sees only the neutral EV model, never vendor state IDs.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EV_CHARGE_POWER_SOURCES = exports.EV_TAKEOVER_OUTCOMES = void 0;
exports.EV_TAKEOVER_OUTCOMES = [
    "external",
    "ems_takeover_required",
    "ems_takeover_recommended",
    "no_external_control",
    "insufficient_data",
    "not_applicable",
];
exports.EV_CHARGE_POWER_SOURCES = [
    "vehicle_max_ac",
    "evcc_current_phases",
    "evcc_capped_by_vehicle",
    "unknown",
];
