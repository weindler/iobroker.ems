"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetAuthoritySessionForTest = exports.getAuthoritySession = exports.configureAuthoritySession = void 0;
const session = {
    service: null,
    layout: null,
    configuredSource: "legacy",
    runtimeMode: "off",
    evaluationMode: "disabled",
    executionMode: "dryrun",
    evidence: null,
    bound: null,
    candidate: null,
    adapterReady: true,
    shuttingDown: false,
    sessionId: `auth-sess-${Date.now().toString(36)}`,
};
function configureAuthoritySession(partial) {
    Object.assign(session, partial);
}
exports.configureAuthoritySession = configureAuthoritySession;
function getAuthoritySession() {
    return session;
}
exports.getAuthoritySession = getAuthoritySession;
function resetAuthoritySessionForTest() {
    session.service = null;
    session.layout = null;
    session.configuredSource = "legacy";
    session.runtimeMode = "off";
    session.evaluationMode = "disabled";
    session.executionMode = "dryrun";
    session.evidence = null;
    session.bound = null;
    session.candidate = null;
    session.adapterReady = true;
    session.shuttingDown = false;
    session.sessionId = `auth-sess-${Date.now().toString(36)}`;
}
exports.resetAuthoritySessionForTest = resetAuthoritySessionForTest;
