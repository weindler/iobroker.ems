"use strict";
/**
 * Authorization runtime wiring — lazy service creation on first prepare when eligible.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConfiguredAuthorizationModeForTest = exports.handlePlannerAuthorizationRuntimeStateChange = exports.stopPlannerAuthorizationRuntime = exports.initPlannerAuthorizationRuntime = exports.notifyPlannerAuthorizationExecutionMode = void 0;
const node_crypto_1 = require("node:crypto");
const authorization_mode_1 = require("../planner_config/authorization_mode");
const paths_1 = require("../planner_paths/paths");
const action_bridge_1 = require("./action_bridge");
const runtime_session_1 = require("./runtime_session");
const states_1 = require("./states");
const AUTH_BUTTON_PATTERNS = [
    states_1.PLANNER_AUTHORIZATION_STATE_IDS.prepare,
    states_1.PLANNER_AUTHORIZATION_STATE_IDS.confirm,
    states_1.PLANNER_AUTHORIZATION_STATE_IDS.cancel,
    states_1.PLANNER_AUTHORIZATION_STATE_IDS.confirmChallengeId,
];
let hostRef = null;
let configuredAuthMode = "disabled";
let stopped = false;
async function ensureService() {
    const sess = (0, runtime_session_1.getAuthorizationSession)();
    if (sess.service)
        return sess.service;
    if (configuredAuthMode !== "manual_prepare")
        return null;
    if (sess.runtimeMode !== "shadow_auto" || sess.evaluationMode !== "observe")
        return null;
    const { PlannerAuthorizationService } = await Promise.resolve().then(() => __importStar(require("./service.js")));
    const host = hostRef;
    if (!host)
        return null;
    const layout = (0, paths_1.resolvePlannerPaths)({
        namespace: host.namespace,
        getAbsoluteInstanceDataDir: () => typeof host.getAbsoluteInstanceDataDir === "function"
            ? host.getAbsoluteInstanceDataDir()
            : "/tmp/ems-missing-instance-data",
    });
    const service = new PlannerAuthorizationService({
        now: () => new Date(),
        adapterInstance: host.namespace,
        sessionId: sess.sessionId || (0, node_crypto_1.randomUUID)(),
        auditDir: layout.runtimeTakeoverDir,
        getRuntimeMode: () => (0, runtime_session_1.getAuthorizationSession)().runtimeMode,
        getEvaluationMode: () => (0, runtime_session_1.getAuthorizationSession)().evaluationMode,
        getAuthorizationMode: () => configuredAuthMode,
        getEvidence: () => (0, runtime_session_1.getAuthorizationSession)().evidence,
        getEligibilityExtras: () => {
            const s = (0, runtime_session_1.getAuthorizationSession)();
            return {
                adapterReady: s.adapterReady,
                shuttingDown: s.shuttingDown,
                restoreBarrierActive: s.restoreBarrierActive,
                operationLockActive: s.operationLockActive,
                lastCompareStatus: s.lastCompareStatus,
                authoritativeRevision: s.bound?.authoritativeRevision ?? null,
                candidateRevision: s.bound?.candidateRevision ?? null,
                inputRevision: s.bound?.inputRevision ?? null,
                generationMatches: s.bound != null,
                horizonMatches: s.bound != null,
                candidateValid: s.candidateValid,
                authoritativePublishOk: s.authoritativePublishOk,
                plannerJobActive: s.plannerJobActive,
                pendingRerun: s.pendingRerun,
                executionMode: s.executionMode,
                bound: s.bound,
                dryrunPilotReady: s.dryrunPilotReady === true,
            };
        },
        onStatus: (status) => {
            if (!hostRef || stopped)
                return;
            void (0, states_1.writePlannerAuthorizationStates)(hostRef, status).catch(() => undefined);
        },
    });
    (0, runtime_session_1.configureAuthorizationSession)({ service });
    await service.syncFromConfig();
    return service;
}
async function notifyPlannerAuthorizationExecutionMode(mode) {
    if (stopped)
        return;
    try {
        const { configureAuthorizationSession, getAuthorizationSession } = await Promise.resolve().then(() => __importStar(require("./runtime_session.js")));
        const prev = getAuthorizationSession().executionMode;
        configureAuthorizationSession({ executionMode: mode === "live" ? "live" : "dryrun" });
        if (prev !== mode && getAuthorizationSession().service) {
            await getAuthorizationSession().service.invalidate("execution_mode_change");
        }
    }
    catch {
        // optional
    }
}
exports.notifyPlannerAuthorizationExecutionMode = notifyPlannerAuthorizationExecutionMode;
async function initPlannerAuthorizationRuntime(host) {
    hostRef = host;
    stopped = false;
    const parsed = (0, authorization_mode_1.plannerTakeoverAuthorizationModeFromConfig)(host.config);
    configuredAuthMode = parsed.mode;
    if (parsed.clamped) {
        host.log?.warn?.(`planner_takeover_authorization_mode invalid — clamped to disabled (raw=${String(parsed.raw)})`);
    }
    (0, runtime_session_1.configureAuthorizationSession)({
        authorizationMode: configuredAuthMode,
        sessionId: (0, node_crypto_1.randomUUID)(),
        shuttingDown: false,
        adapterReady: true,
        executionMode: host.config?.global_execution_mode === "live"
            ? "live"
            : "dryrun",
    });
    await setStateIfChangedSafe(host, states_1.PLANNER_AUTHORIZATION_STATE_IDS.configuredMode, configuredAuthMode);
    await setStateIfChangedSafe(host, states_1.PLANNER_AUTHORIZATION_STATE_IDS.effectiveMode, "disabled");
    await setStateIfChangedSafe(host, states_1.PLANNER_AUTHORIZATION_STATE_IDS.activationCapabilityPresent, false);
    await setStateIfChangedSafe(host, states_1.PLANNER_AUTHORIZATION_STATE_IDS.permitMinted, false);
    await setStateIfChangedSafe(host, states_1.PLANNER_AUTHORIZATION_STATE_IDS.canonicalAllowed, false);
    if (configuredAuthMode === "manual_prepare") {
        await (0, states_1.ensurePlannerAuthorizationStates)(host);
        if (typeof host.subscribeStatesAsync === "function") {
            for (const p of AUTH_BUTTON_PATTERNS) {
                await host.subscribeStatesAsync(p);
            }
        }
    }
}
exports.initPlannerAuthorizationRuntime = initPlannerAuthorizationRuntime;
async function stopPlannerAuthorizationRuntime() {
    stopped = true;
    (0, runtime_session_1.configureAuthorizationSession)({ shuttingDown: true });
    const service = (0, runtime_session_1.getAuthorizationSession)().service;
    if (service) {
        await service.shutdown().catch(() => undefined);
    }
    (0, runtime_session_1.configureAuthorizationSession)({ service: null });
    const host = hostRef;
    if (host && typeof host.unsubscribeStatesAsync === "function") {
        for (const p of AUTH_BUTTON_PATTERNS) {
            await host.unsubscribeStatesAsync(p).catch(() => undefined);
        }
    }
    hostRef = null;
}
exports.stopPlannerAuthorizationRuntime = stopPlannerAuthorizationRuntime;
async function handlePlannerAuthorizationRuntimeStateChange(host, relativeId, val, ack) {
    if (!(0, states_1.isPlannerAuthorizationState)(relativeId))
        return false;
    if (stopped)
        return true;
    return (0, action_bridge_1.handlePlannerAuthorizationStateChange)(host, relativeId, val, ack, {
        prepare: async () => {
            const service = await ensureService();
            if (!service)
                return;
            await service.prepare();
        },
        confirm: async (challengeId) => {
            const service = (0, runtime_session_1.getAuthorizationSession)().service;
            if (!service)
                return;
            await service.confirm(challengeId);
        },
        cancel: async () => {
            const service = (0, runtime_session_1.getAuthorizationSession)().service;
            if (!service)
                return;
            await service.cancel();
        },
        getConfirmChallengeId: async () => {
            const st = await host.getStateAsync(states_1.PLANNER_AUTHORIZATION_STATE_IDS.confirmChallengeId);
            return st?.val != null ? String(st.val) : "";
        },
    });
}
exports.handlePlannerAuthorizationRuntimeStateChange = handlePlannerAuthorizationRuntimeStateChange;
async function setStateIfChangedSafe(host, id, val) {
    const cur = await host.getStateAsync(id);
    if (cur?.val === val && cur?.ack === true)
        return;
    await host.setStateAsync(id, { val, ack: true });
}
function getConfiguredAuthorizationModeForTest() {
    return configuredAuthMode;
}
exports.getConfiguredAuthorizationModeForTest = getConfiguredAuthorizationModeForTest;
