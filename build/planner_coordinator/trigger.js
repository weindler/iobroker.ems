"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.triggerToJobTrigger = exports.mergeTriggerRequests = void 0;
const constants_1 = require("./constants");
function mergeTriggerRequests(current, incoming) {
    if (!current) {
        return { ...incoming };
    }
    const currentPriority = constants_1.PLANNER_TRIGGER_PRIORITY[current.reason];
    const incomingPriority = constants_1.PLANNER_TRIGGER_PRIORITY[incoming.reason];
    const winner = incomingPriority >= currentPriority ? incoming : current;
    return {
        reason: winner.reason,
        requestedAt: incoming.requestedAt,
        correlationId: incoming.correlationId ?? current.correlationId,
        force: Boolean(current.force || incoming.force),
    };
}
exports.mergeTriggerRequests = mergeTriggerRequests;
function triggerToJobTrigger(reason) {
    switch (reason) {
        case "manual":
            return "manual";
        case "scheduled":
            return "scheduled";
        case "ai_request":
            return "ai";
        case "startup_recovery":
            return "startup_missing_plan";
        case "relevant_change":
            return "state_change";
        default:
            return "manual";
    }
}
exports.triggerToJobTrigger = triggerToJobTrigger;
