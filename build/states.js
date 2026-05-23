"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.instanceState = exports.STATE = void 0;
/** State IDs under this adapter instance (ems.0 = default instance id 0). */
exports.STATE = {
    config: {
        executionEnabled: "config.execution_enabled",
    },
    command: {
        inbox: "command.inbox",
        lastResult: "command.last_result",
    },
    audit: {
        lastEvent: "audit.last_event",
    },
};
function instanceState(instanceId, relativeId) {
    return `ems.${instanceId}.${relativeId}`;
}
exports.instanceState = instanceState;
