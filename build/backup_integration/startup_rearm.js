"use strict";
/** Startup live-rearm gate — independent from restore dryrun context. */
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
exports.resetStartupRearmForTest = exports.captureExecutionModeBaselineFromHost = exports.isExplicitUserLiveRearmRequest = exports.isExplicitUserExecutionModeRequest = exports.isFreshUserStateChange = exports.isAdapterInternalStateOrigin = exports.confirmStartupLiveRearm = exports.clearStartupRearmRequired = exports.getExecutionModeBaselineLc = exports.clearExecutionModeBaseline = exports.recordExecutionModeBaseline = exports.getBootstrapCompletedAtMs = exports.markBootstrapCompletedForRearm = exports.isStartupRearmRequired = exports.setStartupRearmRequired = void 0;
let startupRearmRequired = false;
let bootstrapCompletedAtMs = 0;
const executionModeBaselineLc = new Map();
function setStartupRearmRequired(required) {
    startupRearmRequired = required;
}
exports.setStartupRearmRequired = setStartupRearmRequired;
function isStartupRearmRequired() {
    return startupRearmRequired;
}
exports.isStartupRearmRequired = isStartupRearmRequired;
function markBootstrapCompletedForRearm(nowMs = Date.now()) {
    bootstrapCompletedAtMs = nowMs;
}
exports.markBootstrapCompletedForRearm = markBootstrapCompletedForRearm;
function getBootstrapCompletedAtMs() {
    return bootstrapCompletedAtMs;
}
exports.getBootstrapCompletedAtMs = getBootstrapCompletedAtMs;
function recordExecutionModeBaseline(relativeStateId, lc) {
    executionModeBaselineLc.set(relativeStateId, lc);
}
exports.recordExecutionModeBaseline = recordExecutionModeBaseline;
function clearExecutionModeBaseline() {
    executionModeBaselineLc.clear();
}
exports.clearExecutionModeBaseline = clearExecutionModeBaseline;
function getExecutionModeBaselineLc(relativeStateId) {
    return executionModeBaselineLc.get(relativeStateId);
}
exports.getExecutionModeBaselineLc = getExecutionModeBaselineLc;
function clearStartupRearmRequired() {
    startupRearmRequired = false;
}
exports.clearStartupRearmRequired = clearStartupRearmRequired;
/**
 * Explizite Benutzer-Freigabe für Geräte-Writes nach Adapter-Start.
 * Unabhängig von Mode-Toggle — Admin-Config-Save / Restart blockiert das nicht.
 */
async function confirmStartupLiveRearm(host) {
    const { BACKUP_INFO_STATES } = await Promise.resolve().then(() => __importStar(require("./ensure_states.js")));
    const { GLOBAL } = await Promise.resolve().then(() => __importStar(require("../tree_paths.js")));
    const { parseMode } = await Promise.resolve().then(() => __importStar(require("../execution_mode.js")));
    const alreadyCleared = !isStartupRearmRequired();
    const globalMode = parseMode((await host.getStateAsync(GLOBAL.executionMode))?.val);
    if (globalMode !== "live") {
        await host.setStateAsync(GLOBAL.executionMode, { val: "live", ack: true });
        await host.setStateAsync("execution.safety.global_execution_mode", { val: "live", ack: true });
    }
    clearStartupRearmRequired();
    await host.setStateAsync(BACKUP_INFO_STATES.liveRearmRequired, { val: false, ack: true });
    await host.setStateAsync(BACKUP_INFO_STATES.confirmLiveRearm, { val: false, ack: true });
    host.log.info(alreadyCleared
        ? "Startup-Rearm war bereits aufgehoben — live_rearm_required=false bestätigt"
        : "Startup-Rearm aufgehoben (confirm_live_rearm) — Geräte-Writes freigegeben");
    return { ok: true, alreadyCleared };
}
exports.confirmStartupLiveRearm = confirmStartupLiveRearm;
/** Adapter-interne Writes (Sync, Reconciliation, Hydration) dürfen Rearm nicht aufheben. */
function isAdapterInternalStateOrigin(from, adapterNamespace) {
    const origin = String(from ?? "").trim();
    if (!origin) {
        return false;
    }
    if (origin === adapterNamespace) {
        return true;
    }
    if (origin.startsWith(`system.adapter.${adapterNamespace}`)) {
        return true;
    }
    return false;
}
exports.isAdapterInternalStateOrigin = isAdapterInternalStateOrigin;
function isFreshUserStateChange(state, bootstrapCompletedAtMsValue) {
    if (!state || state.ack) {
        return false;
    }
    if (bootstrapCompletedAtMsValue <= 0) {
        return false;
    }
    const ts = state.ts ?? 0;
    return ts >= bootstrapCompletedAtMsValue;
}
exports.isFreshUserStateChange = isFreshUserStateChange;
/**
 * Explizite Benutzer-Anforderung auf einem Execution-Mode-State (dryrun oder live).
 * Nicht ausreichend: Hydration, Reconciliation, interne Spiegelung, alter Request.
 */
function isExplicitUserExecutionModeRequest(state, adapterNamespace, relativeStateId, bootstrapCompletedAtMsValue) {
    if (!isFreshUserStateChange(state, bootstrapCompletedAtMsValue)) {
        return false;
    }
    if (isAdapterInternalStateOrigin(state?.from, adapterNamespace)) {
        return false;
    }
    const requested = String(state?.val ?? "").trim().toLowerCase();
    if (requested !== "dryrun" && requested !== "live") {
        return false;
    }
    const baselineLc = executionModeBaselineLc.get(relativeStateId);
    if (baselineLc !== undefined) {
        const currentLc = state?.lc ?? 0;
        if (currentLc <= baselineLc) {
            return false;
        }
    }
    return true;
}
exports.isExplicitUserExecutionModeRequest = isExplicitUserExecutionModeRequest;
/**
 * Startup-Rearm nur durch frischen externen live-Request auf global.execution_mode aufheben.
 * dryrun ist keine Zustimmung zu realen Geräte-Writes und hebt Rearm nicht auf.
 * Add-on-Execution-Mode-Requests allein heben Rearm ebenfalls nicht auf.
 */
function isExplicitUserLiveRearmRequest(state, adapterNamespace, relativeStateId, bootstrapCompletedAtMsValue) {
    if (relativeStateId !== "global.execution_mode") {
        return false;
    }
    if (!isExplicitUserExecutionModeRequest(state, adapterNamespace, relativeStateId, bootstrapCompletedAtMsValue)) {
        return false;
    }
    return String(state?.val ?? "").trim().toLowerCase() === "live";
}
exports.isExplicitUserLiveRearmRequest = isExplicitUserLiveRearmRequest;
async function captureExecutionModeBaselineFromHost(host, relativeStateIds) {
    clearExecutionModeBaseline();
    for (const id of relativeStateIds) {
        const st = await host.getStateAsync(id);
        recordExecutionModeBaseline(id, st?.lc ?? 0);
    }
}
exports.captureExecutionModeBaselineFromHost = captureExecutionModeBaselineFromHost;
function resetStartupRearmForTest() {
    startupRearmRequired = false;
    bootstrapCompletedAtMs = 0;
    clearExecutionModeBaseline();
}
exports.resetStartupRearmForTest = resetStartupRearmForTest;
