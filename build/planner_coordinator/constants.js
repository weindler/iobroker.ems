"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLANNER_COORDINATOR_SHUTDOWN_TIMEOUT_MS = exports.PLANNER_COORDINATOR_DEFAULT_TIMEOUT_MS = exports.PLANNER_TRIGGER_PRIORITY = void 0;
/** Higher number wins when coalescing concurrent trigger requests. */
exports.PLANNER_TRIGGER_PRIORITY = {
    manual: 50,
    ai_request: 50,
    startup_recovery: 40,
    scheduled: 30,
    relevant_change: 20,
    test: 10,
};
exports.PLANNER_COORDINATOR_DEFAULT_TIMEOUT_MS = 120_000;
exports.PLANNER_COORDINATOR_SHUTDOWN_TIMEOUT_MS = 10_000;
