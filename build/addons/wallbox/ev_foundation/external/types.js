"use strict";
/**
 * Neutral external EV control / smart-plan types (Phase 2, read-only).
 * Source adapters map HA/Tibber/other payloads here — Unified Planner never sees vendor state IDs.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptySmartPlanEval = exports.SMART_PLAN_SLOT_QUALITIES = exports.EXTERNAL_SOURCE_QUALITIES = void 0;
exports.EXTERNAL_SOURCE_QUALITIES = [
    "unconfigured",
    "unknown",
    "ok",
    "degraded",
    "stale",
    "invalid",
];
exports.SMART_PLAN_SLOT_QUALITIES = ["ok", "degraded"];
function emptySmartPlanEval() {
    return {
        mappingConfigured: false,
        stateReadable: false,
        payloadParseable: false,
        validPlanPresent: false,
        slots: [],
        parsedSlotCount: 0,
        ignoredSlotCount: 0,
        nextStart: null,
        lastEnd: null,
        remainingEnergyKWh: null,
        remainingMinutes: null,
        remainingEnergyEstimated: false,
        deadlineUsed: false,
        deadlineIso: null,
        rawPreview: null,
        parseError: null,
    };
}
exports.emptySmartPlanEval = emptySmartPlanEval;
