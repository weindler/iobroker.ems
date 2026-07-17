"use strict";
/** Named timing constants — conservative defaults; fake-clock testable. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLANNER_STARTUP_TRIGGER_DELAY_MS = exports.PLANNER_SCHEDULE_SLOT_ALIGN_MS = exports.PLANNER_TRIGGER_MAX_DELAY_MS = exports.PLANNER_TRIGGER_MIN_INTERVAL_MS = exports.PLANNER_TRIGGER_DEBOUNCE_MS = void 0;
/** Quiescence window after the last telemetry change before a job may start. */
exports.PLANNER_TRIGGER_DEBOUNCE_MS = 15_000;
/** Minimum interval between automatic (non-force) job requests. */
exports.PLANNER_TRIGGER_MIN_INTERVAL_MS = 60_000;
/** Maximum delay from the first coalesced event before a job must fire. */
exports.PLANNER_TRIGGER_MAX_DELAY_MS = 120_000;
/** Align schedule checks slightly after the 15-minute boundary. */
exports.PLANNER_SCHEDULE_SLOT_ALIGN_MS = 15 * 60 * 1000;
/** Startup trigger delay after trigger system init (bootstrap already complete). */
exports.PLANNER_STARTUP_TRIGGER_DELAY_MS = 5_000;
