"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetAuthorizationSessionForTest = exports.getAuthorizationSession = exports.configureAuthorizationSession = void 0;
const session = {
    service: null,
    runtimeMode: "off",
    evaluationMode: "disabled",
    authorizationMode: "disabled",
    evidence: null,
    bound: null,
    lastCompareStatus: null,
    authoritativePublishOk: true,
    candidateValid: true,
    plannerJobActive: false,
    pendingRerun: false,
    executionMode: "dryrun",
    adapterReady: true,
    shuttingDown: false,
    restoreBarrierActive: false,
    operationLockActive: false,
    sessionId: `sess-${Date.now().toString(36)}`,
    dryrunPilotReady: false,
};
function configureAuthorizationSession(partial) {
    Object.assign(session, partial);
}
exports.configureAuthorizationSession = configureAuthorizationSession;
function getAuthorizationSession() {
    return session;
}
exports.getAuthorizationSession = getAuthorizationSession;
function resetAuthorizationSessionForTest() {
    session.service = null;
    session.runtimeMode = "off";
    session.evaluationMode = "disabled";
    session.authorizationMode = "disabled";
    session.evidence = null;
    session.bound = null;
    session.lastCompareStatus = null;
    session.authoritativePublishOk = true;
    session.candidateValid = true;
    session.plannerJobActive = false;
    session.pendingRerun = false;
    session.executionMode = "dryrun";
    session.adapterReady = true;
    session.shuttingDown = false;
    session.restoreBarrierActive = false;
    session.operationLockActive = false;
    session.sessionId = `sess-${Date.now().toString(36)}`;
    session.dryrunPilotReady = false;
}
exports.resetAuthorizationSessionForTest = resetAuthorizationSessionForTest;
