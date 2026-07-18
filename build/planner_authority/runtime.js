"use strict";
/**
 * Authority runtime wiring — lazy service creation on first conscious activate.
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
exports.getConfiguredAuthoritativeSourceForTest = exports.handlePlannerAuthorityRuntimeStateChange = exports.stopPlannerAuthorityRuntime = exports.initPlannerAuthorityRuntime = exports.recordPlannerAuthorityWorkerMemory = exports.notifyPlannerAuthorityExecutionMode = void 0;
const node_crypto_1 = require("node:crypto");
const authoritative_source_1 = require("../planner_config/authoritative_source");
const paths_1 = require("../planner_paths/paths");
const action_bridge_1 = require("./action_bridge");
const runtime_session_1 = require("./runtime_session");
const states_1 = require("./states");
const AUTHORITY_BUTTON_PATTERNS = [
    states_1.PLANNER_AUTHORITY_STATE_IDS.activateWorkerDryrun,
    states_1.PLANNER_AUTHORITY_STATE_IDS.deactivateWorker,
];
let hostRef = null;
let configuredSource = "legacy";
let stopped = false;
async function requestLegacyRun(reason) {
    try {
        const { getPlannerOnDemandCoordinator } = await Promise.resolve().then(() => __importStar(require("../planner_coordinator/compose.js")));
        const coordinator = getPlannerOnDemandCoordinator();
        if (coordinator) {
            await coordinator.request({ reason: "manual", requestedAt: new Date().toISOString(), force: true });
        }
        hostRef?.log?.debug?.(`planner authority legacy fallback requested (${reason})`);
    }
    catch {
        // optional
    }
}
async function ensureService() {
    const sess = (0, runtime_session_1.getAuthoritySession)();
    if (sess.service)
        return sess.service;
    if (configuredSource !== "worker_dryrun")
        return null;
    const host = hostRef;
    if (!host)
        return null;
    const { PlannerAuthorityService } = await Promise.resolve().then(() => __importStar(require("./service.js")));
    const { policyFingerprint } = await Promise.resolve().then(() => __importStar(require("../planner_takeover/evidence.js")));
    const { DEFAULT_TAKEOVER_READINESS_POLICY } = await Promise.resolve().then(() => __importStar(require("../planner_takeover/constants.js")));
    const { getAuthorizationSession } = await Promise.resolve().then(() => __importStar(require("../planner_authorization/runtime_session.js")));
    const layout = sess.layout ??
        (0, paths_1.resolvePlannerPaths)({
            namespace: host.namespace,
            getAbsoluteInstanceDataDir: () => typeof host.getAbsoluteInstanceDataDir === "function"
                ? host.getAbsoluteInstanceDataDir()
                : "/tmp/ems-missing-instance-data",
        });
    const service = new PlannerAuthorityService({
        now: () => new Date(),
        adapterInstance: host.namespace,
        sessionId: sess.sessionId || (0, node_crypto_1.randomUUID)(),
        layout,
        getConfiguredSource: () => configuredSource,
        getRuntimeMode: () => (0, runtime_session_1.getAuthoritySession)().runtimeMode,
        getEvaluationMode: () => (0, runtime_session_1.getAuthoritySession)().evaluationMode,
        getExecutionMode: () => (0, runtime_session_1.getAuthoritySession)().executionMode,
        getEvidence: () => (0, runtime_session_1.getAuthoritySession)().evidence,
        getExpectedPolicyFingerprint: () => policyFingerprint(DEFAULT_TAKEOVER_READINESS_POLICY),
        getBoundRevisions: () => (0, runtime_session_1.getAuthoritySession)().bound,
        getCandidate: () => (0, runtime_session_1.getAuthoritySession)().candidate,
        peekAuthorizationGrant: () => getAuthorizationSession().service?.peekGrant() ?? null,
        consumeAuthorizationGrant: () => getAuthorizationSession().service?.consumeGrantForActivation() ?? null,
        requestLegacyRun,
        getStateHost: () => hostRef,
        onStatus: (status) => {
            if (!hostRef || stopped)
                return;
            void (0, states_1.writePlannerAuthorityStates)(hostRef, status).catch(() => undefined);
        },
    });
    (0, runtime_session_1.configureAuthoritySession)({ service, layout });
    return service;
}
async function notifyPlannerAuthorityExecutionMode(mode) {
    if (stopped)
        return;
    const normalized = mode === "dryrun" ? "dryrun" : mode === "live" ? "live" : String(mode || "dryrun");
    (0, runtime_session_1.configureAuthoritySession)({ executionMode: normalized });
    const service = (0, runtime_session_1.getAuthoritySession)().service;
    if (service)
        await service.onExecutionModeChange(normalized).catch(() => undefined);
}
exports.notifyPlannerAuthorityExecutionMode = notifyPlannerAuthorityExecutionMode;
async function recordPlannerAuthorityWorkerMemory(memory) {
    if (!hostRef || stopped)
        return;
    const { writePlannerAuthorityMemoryStates } = await Promise.resolve().then(() => __importStar(require("./states.js")));
    await writePlannerAuthorityMemoryStates(hostRef, memory);
}
exports.recordPlannerAuthorityWorkerMemory = recordPlannerAuthorityWorkerMemory;
async function initPlannerAuthorityRuntime(host) {
    hostRef = host;
    stopped = false;
    const parsed = (0, authoritative_source_1.plannerRequestedAuthorityFromConfig)(host.config);
    configuredSource = parsed.mode;
    if (parsed.clamped) {
        host.log?.warn?.(`planner_authoritative_source invalid — clamped to legacy (raw=${String(parsed.raw)})`);
    }
    const layout = (0, paths_1.resolvePlannerPaths)({
        namespace: host.namespace,
        getAbsoluteInstanceDataDir: () => typeof host.getAbsoluteInstanceDataDir === "function"
            ? host.getAbsoluteInstanceDataDir()
            : "/tmp/ems-missing-instance-data",
    });
    (0, runtime_session_1.configureAuthoritySession)({
        configuredSource,
        layout,
        sessionId: (0, node_crypto_1.randomUUID)(),
        shuttingDown: false,
        adapterReady: true,
        executionMode: host.config?.global_execution_mode === "live"
            ? "live"
            : "dryrun",
    });
    // Objects must exist before any state write (cold-start / empty namespace).
    await (0, states_1.ensurePlannerAuthorityStates)(host);
    await setStateIfChangedSafe(host, states_1.PLANNER_AUTHORITY_STATE_IDS.configuredSource, configuredSource);
    // No automatic activation on startup — effective is always legacy or worker_pending.
    await setStateIfChangedSafe(host, states_1.PLANNER_AUTHORITY_STATE_IDS.effectiveAuthority, configuredSource === "worker_dryrun" ? "worker_pending" : "legacy");
    await setStateIfChangedSafe(host, states_1.PLANNER_AUTHORITY_STATE_IDS.workerAuthoritative, false);
    await setStateIfChangedSafe(host, states_1.PLANNER_AUTHORITY_STATE_IDS.canonicalAllowed, false);
    if (configuredSource === "worker_dryrun" && typeof host.subscribeStatesAsync === "function") {
        for (const p of AUTHORITY_BUTTON_PATTERNS) {
            await host.subscribeStatesAsync(p);
        }
    }
}
exports.initPlannerAuthorityRuntime = initPlannerAuthorityRuntime;
async function stopPlannerAuthorityRuntime() {
    stopped = true;
    (0, runtime_session_1.configureAuthoritySession)({ shuttingDown: true });
    const service = (0, runtime_session_1.getAuthoritySession)().service;
    if (service) {
        await service.shutdown().catch(() => undefined);
    }
    (0, runtime_session_1.configureAuthoritySession)({ service: null });
    const host = hostRef;
    if (host && typeof host.unsubscribeStatesAsync === "function") {
        for (const p of AUTHORITY_BUTTON_PATTERNS) {
            await host.unsubscribeStatesAsync(p).catch(() => undefined);
        }
    }
    hostRef = null;
}
exports.stopPlannerAuthorityRuntime = stopPlannerAuthorityRuntime;
async function handlePlannerAuthorityRuntimeStateChange(host, relativeId, val, ack) {
    if (!(0, action_bridge_1.isPlannerAuthorityActionState)(relativeId) && !(0, states_1.isPlannerAuthorityState)(relativeId))
        return false;
    if (stopped)
        return true;
    return (0, action_bridge_1.handlePlannerAuthorityStateChange)(host, relativeId, val, ack, {
        activateWorkerDryrun: async () => {
            const service = await ensureService();
            if (!service)
                return;
            await service.activateWorkerDryrun();
        },
        deactivateWorker: async () => {
            const service = (0, runtime_session_1.getAuthoritySession)().service ?? (await ensureService());
            if (!service)
                return;
            await service.deactivateWorker();
        },
    });
}
exports.handlePlannerAuthorityRuntimeStateChange = handlePlannerAuthorityRuntimeStateChange;
async function setStateIfChangedSafe(host, id, val) {
    const cur = await host.getStateAsync(id);
    if (cur?.val === val && cur?.ack === true)
        return;
    await host.setStateAsync(id, { val, ack: true });
}
function getConfiguredAuthoritativeSourceForTest() {
    return configuredSource;
}
exports.getConfiguredAuthoritativeSourceForTest = getConfiguredAuthoritativeSourceForTest;
