"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetDualRunSessionForTest = exports.getDualRunBridgeContext = exports.configureDualRunSession = void 0;
const session = {
    layout: null,
    plannerRuntimeMode: "off",
    configuredEvaluationMode: "disabled",
    stateHost: null,
    shuttingDown: false,
    protectedJobIds: [],
};
function configureDualRunSession(partial) {
    Object.assign(session, partial);
}
exports.configureDualRunSession = configureDualRunSession;
function getDualRunBridgeContext() {
    if (!session.layout)
        return null;
    return {
        layout: session.layout,
        getPlannerRuntimeMode: () => session.plannerRuntimeMode,
        getConfiguredEvaluationMode: () => session.configuredEvaluationMode,
        getStateHost: () => session.stateHost,
        isShuttingDown: () => session.shuttingDown,
        getProtectedJobIds: () => session.protectedJobIds,
    };
}
exports.getDualRunBridgeContext = getDualRunBridgeContext;
function resetDualRunSessionForTest() {
    session.layout = null;
    session.plannerRuntimeMode = "off";
    session.configuredEvaluationMode = "disabled";
    session.stateHost = null;
    session.shuttingDown = false;
    session.protectedJobIds = [];
}
exports.resetDualRunSessionForTest = resetDualRunSessionForTest;
