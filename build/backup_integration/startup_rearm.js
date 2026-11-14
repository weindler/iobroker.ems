"use strict";
/** Startup live-rearm gate — independent from restore dryrun context. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.setStartupRearmRequired = setStartupRearmRequired;
exports.isStartupRearmRequired = isStartupRearmRequired;
exports.markBootstrapCompletedForRearm = markBootstrapCompletedForRearm;
exports.getBootstrapCompletedAtMs = getBootstrapCompletedAtMs;
exports.recordExecutionModeBaseline = recordExecutionModeBaseline;
exports.clearExecutionModeBaseline = clearExecutionModeBaseline;
exports.getExecutionModeBaselineLc = getExecutionModeBaselineLc;
exports.clearStartupRearmRequired = clearStartupRearmRequired;
exports.confirmStartupLiveRearm = confirmStartupLiveRearm;
exports.isAdapterInternalStateOrigin = isAdapterInternalStateOrigin;
exports.isFreshUserStateChange = isFreshUserStateChange;
exports.isExplicitUserExecutionModeRequest = isExplicitUserExecutionModeRequest;
exports.isExplicitUserLiveRearmRequest = isExplicitUserLiveRearmRequest;
exports.captureExecutionModeBaselineFromHost = captureExecutionModeBaselineFromHost;
exports.resetStartupRearmForTest = resetStartupRearmForTest;
let startupRearmRequired = false;
let bootstrapCompletedAtMs = 0;
const executionModeBaselineLc = new Map();
function setStartupRearmRequired(required) {
    startupRearmRequired = required;
}
function isStartupRearmRequired() {
    return startupRearmRequired;
}
function markBootstrapCompletedForRearm(nowMs = Date.now()) {
    bootstrapCompletedAtMs = nowMs;
}
function getBootstrapCompletedAtMs() {
    return bootstrapCompletedAtMs;
}
function recordExecutionModeBaseline(relativeStateId, lc) {
    executionModeBaselineLc.set(relativeStateId, lc);
}
function clearExecutionModeBaseline() {
    executionModeBaselineLc.clear();
}
function getExecutionModeBaselineLc(relativeStateId) {
    return executionModeBaselineLc.get(relativeStateId);
}
function clearStartupRearmRequired() {
    startupRearmRequired = false;
}
/**
 * Explizite Benutzer-Freigabe für Geräte-Writes nach Adapter-Start.
 * Unabhängig von Mode-Toggle — Admin-Config-Save / Restart blockiert das nicht.
 */
async function confirmStartupLiveRearm(host) {
    const { BACKUP_INFO_STATES } = await import("./ensure_states.js");
    const { GLOBAL } = await import("../tree_paths.js");
    const { parseMode } = await import("../execution_mode.js");
    const alreadyCleared = !isStartupRearmRequired();
    const globalMode = parseMode((await host.getStateAsync(GLOBAL.executionMode))?.val);
    if (globalMode !== "live") {
        await host.setStateAsync(GLOBAL.executionMode, { val: "live", ack: true });
        await host.setStateAsync("execution.safety.global_execution_mode", { val: "live", ack: true });
    }
    clearStartupRearmRequired();
    try {
        await host.setStateAsync(BACKUP_INFO_STATES.liveRearmRequired, { val: false, ack: true });
        await host.setStateAsync(BACKUP_INFO_STATES.confirmLiveRearm, { val: false, ack: true });
    }
    catch {
        /* legacy info.backup states may already be purged */
    }
    host.log.info(alreadyCleared
        ? "Startup-Rearm war bereits aufgehoben — live_rearm_required=false bestätigt"
        : "Startup-Rearm aufgehoben (confirm_live_rearm) — Geräte-Writes freigegeben");
    return { ok: true, alreadyCleared };
}
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
async function captureExecutionModeBaselineFromHost(host, relativeStateIds) {
    clearExecutionModeBaseline();
    for (const id of relativeStateIds) {
        const st = await host.getStateAsync(id);
        recordExecutionModeBaseline(id, st?.lc ?? 0);
    }
}
function resetStartupRearmForTest() {
    startupRearmRequired = false;
    bootstrapCompletedAtMs = 0;
    clearExecutionModeBaseline();
}
