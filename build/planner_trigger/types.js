"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPlannerTriggerClass = exports.PLANNER_TRIGGER_REASON_CODES = exports.PLANNER_TRIGGER_CLASSES = void 0;
exports.PLANNER_TRIGGER_CLASSES = [
    "configuration",
    "mapping",
    "forecast",
    "price",
    "telemetry",
    "constraint",
    "learning",
    "schedule",
    "startup",
    "manual",
    "manual_force",
];
/** Compact, stable, machine-readable reason codes. */
exports.PLANNER_TRIGGER_REASON_CODES = [
    "manual",
    "manual_force",
    "startup",
    "schedule_slot",
    "schedule_day",
    "schedule_renewal",
    "config_change",
    "mapping_change",
    "forecast_change",
    "price_change",
    "telemetry_change",
    "constraint_change",
    "learning_change",
    "relevant_change",
];
function isPlannerTriggerClass(value) {
    return typeof value === "string" && exports.PLANNER_TRIGGER_CLASSES.includes(value);
}
exports.isPlannerTriggerClass = isPlannerTriggerClass;
