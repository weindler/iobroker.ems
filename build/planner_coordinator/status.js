"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTerminalCoordinatorState = exports.copyCoordinatorStatus = exports.createInitialCoordinatorStatus = void 0;
function createInitialCoordinatorStatus(enabled) {
    return {
        state: enabled ? "idle" : "disabled",
        enabled,
        generation: 0,
        rerunPending: false,
        comparisonStatus: "not_available",
        comparisonMismatchCount: 0,
    };
}
exports.createInitialCoordinatorStatus = createInitialCoordinatorStatus;
function copyCoordinatorStatus(status) {
    return structuredClone(status);
}
exports.copyCoordinatorStatus = copyCoordinatorStatus;
function isTerminalCoordinatorState(state) {
    return state === "stopped";
}
exports.isTerminalCoordinatorState = isTerminalCoordinatorState;
