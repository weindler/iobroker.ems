/** Named timing constants — conservative defaults; fake-clock testable. */

/** Quiescence window after the last telemetry change before a job may start. */
export const PLANNER_TRIGGER_DEBOUNCE_MS = 15_000;

/** Minimum interval between automatic (non-force) job requests. */
export const PLANNER_TRIGGER_MIN_INTERVAL_MS = 60_000;

/** Maximum delay from the first coalesced event before a job must fire. */
export const PLANNER_TRIGGER_MAX_DELAY_MS = 120_000;

/** Align schedule checks slightly after the 15-minute boundary. */
export const PLANNER_SCHEDULE_SLOT_ALIGN_MS = 15 * 60 * 1000;

/** Startup trigger delay after trigger system init (bootstrap already complete). */
export const PLANNER_STARTUP_TRIGGER_DELAY_MS = 5_000;
