"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RESTORE_STATES = exports.handleRestoreStateChange = exports.isRestoreRelatedState = exports.handleRestoreApplyRequest = exports.handleRestoreValidateRequest = exports.initRestoreRuntime = void 0;
const ensure_states_1 = require("../backup/ensure_states");
Object.defineProperty(exports, "RESTORE_STATES", { enumerable: true, get: function () { return ensure_states_1.RESTORE_STATES; } });
const plan_1 = require("./plan");
const apply_1 = require("./apply");
const apply_hooks_1 = require("./apply_hooks");
const barrier_1 = require("./barrier");
function isConsciousRequest(val, ack) {
    return val === true && ack !== true;
}
async function setRestoreStatus(host, patch) {
    const map = [];
    if (patch.status !== undefined)
        map.push([ensure_states_1.RESTORE_STATES.status, patch.status]);
    if (patch.running !== undefined)
        map.push([ensure_states_1.RESTORE_STATES.running, patch.running]);
    if (patch.planId !== undefined)
        map.push([ensure_states_1.RESTORE_STATES.planId, patch.planId]);
    if (patch.planExpiresAt !== undefined)
        map.push([ensure_states_1.RESTORE_STATES.planExpiresAt, patch.planExpiresAt]);
    if (patch.archiveSha256 !== undefined)
        map.push([ensure_states_1.RESTORE_STATES.archiveSha256, patch.archiveSha256]);
    if (patch.summaryJson !== undefined)
        map.push([ensure_states_1.RESTORE_STATES.summaryJson, patch.summaryJson]);
    if (patch.lastError !== undefined)
        map.push([ensure_states_1.RESTORE_STATES.lastError, patch.lastError]);
    if (patch.lastResult !== undefined)
        map.push([ensure_states_1.RESTORE_STATES.lastResult, patch.lastResult]);
    if (patch.lastRestoreAt !== undefined)
        map.push([ensure_states_1.RESTORE_STATES.lastRestoreAt, patch.lastRestoreAt]);
    if (patch.lastFileName !== undefined)
        map.push([ensure_states_1.RESTORE_STATES.lastFileName, patch.lastFileName]);
    if (patch.transactionId !== undefined)
        map.push([ensure_states_1.RESTORE_STATES.transactionId, patch.transactionId]);
    if (patch.restartRequired !== undefined)
        map.push([ensure_states_1.RESTORE_STATES.restartRequired, patch.restartRequired]);
    for (const [id, val] of map) {
        await host.setStateAsync(id, { val, ack: true });
    }
}
async function initRestoreRuntime(host) {
    (0, plan_1.invalidateRestorePlan)();
    await host.setStateAsync(ensure_states_1.RESTORE_STATES.validateRequest, { val: false, ack: true });
    await host.setStateAsync(ensure_states_1.RESTORE_STATES.applyRequest, { val: false, ack: true });
    await host.setStateAsync(ensure_states_1.RESTORE_STATES.confirmPlanId, { val: "", ack: true });
    await setRestoreStatus(host, {
        status: "idle",
        running: false,
        planId: "",
        planExpiresAt: "",
        archiveSha256: "",
        summaryJson: "{}",
        lastError: "",
        restartRequired: (0, barrier_1.isRestoreRestartRequired)(),
    });
}
exports.initRestoreRuntime = initRestoreRuntime;
async function handleRestoreValidateRequest(host, val, ack) {
    if (!isConsciousRequest(val, ack))
        return;
    await host.setStateAsync(ensure_states_1.RESTORE_STATES.validateRequest, { val: false, ack: true });
    const fileSt = await host.getStateAsync(ensure_states_1.RESTORE_STATES.selectedFile);
    const fileName = typeof fileSt?.val === "string" ? fileSt.val.trim() : "";
    if (!fileName) {
        await setRestoreStatus(host, { status: "error", lastError: "no_file_selected" });
        return;
    }
    try {
        await setRestoreStatus(host, { status: "validating", running: true, lastError: "" });
        const result = await (0, apply_1.runRestoreValidate)(host, fileName);
        if (result.ok) {
            const plan = (0, plan_1.getActiveRestorePlan)();
            await setRestoreStatus(host, {
                status: "ready",
                running: false,
                planId: plan?.planId ?? "",
                planExpiresAt: plan?.expiresAt ?? "",
                archiveSha256: plan?.identity.archiveSha256 ?? "",
                summaryJson: plan ? (0, apply_1.planSummaryJson)(plan) : "{}",
                lastError: "",
            });
        }
        else {
            (0, plan_1.invalidateRestorePlan)();
            await setRestoreStatus(host, {
                status: "error",
                running: false,
                planId: "",
                planExpiresAt: "",
                summaryJson: "{}",
                lastError: result.error,
            });
        }
    }
    finally {
        await setRestoreStatus(host, { running: false });
    }
}
exports.handleRestoreValidateRequest = handleRestoreValidateRequest;
async function handleRestoreApplyRequest(host, val, ack) {
    if (!isConsciousRequest(val, ack))
        return;
    await host.setStateAsync(ensure_states_1.RESTORE_STATES.applyRequest, { val: false, ack: true });
    const fileSt = await host.getStateAsync(ensure_states_1.RESTORE_STATES.selectedFile);
    const fileName = typeof fileSt?.val === "string" ? fileSt.val.trim() : "";
    const confirmSt = await host.getStateAsync(ensure_states_1.RESTORE_STATES.confirmPlanId);
    const confirmPlanId = typeof confirmSt?.val === "string" ? confirmSt.val.trim() : "";
    if (!fileName || !confirmPlanId) {
        await setRestoreStatus(host, { status: "error", lastError: "missing_confirm_plan_id" });
        return;
    }
    try {
        await setRestoreStatus(host, { status: "applying", running: true, lastError: "" });
        const result = await (0, apply_1.runRestoreApply)(host, fileName, confirmPlanId);
        if (result.ok) {
            (0, apply_hooks_1.maybeInjectRestoreHandlerAfterCommitted)();
            await setRestoreStatus(host, {
                status: "success_restart_required",
                running: false,
                lastResult: "success_restart_required",
                lastRestoreAt: new Date().toISOString(),
                lastFileName: fileName,
                transactionId: result.transactionId ?? "",
                restartRequired: true,
                lastError: "",
                planId: "",
                planExpiresAt: "",
                summaryJson: "{}",
            });
            await host.setStateAsync(ensure_states_1.RESTORE_STATES.confirmPlanId, { val: "", ack: true });
        }
        else if (result.status === "rolled_back") {
            await setRestoreStatus(host, {
                status: "rolled_back",
                running: false,
                lastError: result.error,
                lastResult: "rolled_back",
            });
        }
        else if (result.status === "recovery_failed") {
            await setRestoreStatus(host, {
                status: "recovery_failed",
                running: false,
                lastError: result.error,
                lastResult: "failed",
            });
        }
        else {
            await setRestoreStatus(host, {
                status: "error",
                running: false,
                lastError: result.error,
                lastResult: "error",
            });
        }
    }
    finally {
        await setRestoreStatus(host, { running: false });
    }
}
exports.handleRestoreApplyRequest = handleRestoreApplyRequest;
function isRestoreRelatedState(relativeId) {
    return (relativeId === ensure_states_1.RESTORE_STATES.validateRequest ||
        relativeId === ensure_states_1.RESTORE_STATES.applyRequest ||
        relativeId === ensure_states_1.RESTORE_STATES.selectedFile ||
        relativeId.startsWith("backup.restore."));
}
exports.isRestoreRelatedState = isRestoreRelatedState;
async function handleRestoreStateChange(host, relativeId, val, ack) {
    if (relativeId === ensure_states_1.RESTORE_STATES.validateRequest) {
        await handleRestoreValidateRequest(host, val, ack);
        return;
    }
    if (relativeId === ensure_states_1.RESTORE_STATES.applyRequest) {
        await handleRestoreApplyRequest(host, val, ack);
    }
}
exports.handleRestoreStateChange = handleRestoreStateChange;
