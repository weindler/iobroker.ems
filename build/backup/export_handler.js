"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopDiagnosticMode = exports.handleBackupStateChange = exports.isBackupRelatedState = exports.initBackupExportRuntime = exports.syncDiagnosticStatus = exports.handleDiagnosticModeRequest = exports.handleSupportExportRequest = exports.handleBackupExportRequest = void 0;
const types_1 = require("./types");
const ensure_states_1 = require("./ensure_states");
const operation_lock_1 = require("./operation_lock");
const diagnostic_mode_1 = require("../support/diagnostic_mode");
Object.defineProperty(exports, "stopDiagnosticMode", { enumerable: true, get: function () { return diagnostic_mode_1.stopDiagnosticMode; } });
const support_1 = require("../support");
const service_1 = require("./service");
const ensure_states_2 = require("../backup_integration/ensure_states");
function isConsciousRequest(val, ack) {
    return val === true && ack !== true;
}
async function publishExportRegisterStatus(host, ok, detail) {
    try {
        await host.setStateAsync(ensure_states_2.BACKUP_INFO_STATES.exportRegisterReady, { val: ok, ack: true });
        await host.setStateAsync(ensure_states_2.BACKUP_INFO_STATES.exportRegisterHint, {
            val: detail,
            ack: true,
        });
    }
    catch {
        /* backup.* may not exist yet on very early calls */
    }
}
async function handleBackupExportRequest(host, val, ack) {
    if (!isConsciousRequest(val, ack))
        return;
    await host.setStateAsync(ensure_states_1.BACKUP_STATES.exportRequest, { val: false, ack: true });
    try {
        await (0, ensure_states_1.setBackupExportStatus)(host, { status: "exporting", running: true, lastError: "" });
        const result = await (0, service_1.runBackupExport)(host);
        if (result.ok) {
            await (0, ensure_states_1.setBackupExportStatus)(host, {
                status: "idle",
                lastKind: "backup",
                lastExportAt: result.createdAt,
                lastFileName: result.fileName,
                lastSizeBytes: result.sizeBytes,
                lastSha256: result.sha256,
                lastError: "",
            });
            await publishExportRegisterStatus(host, true, `ems-runtime.%INSTANCE%/exports/backup/${result.fileName}`);
        }
        else {
            await (0, ensure_states_1.setBackupExportStatus)(host, {
                status: "error",
                lastError: result.error,
            });
            await publishExportRegisterStatus(host, false, result.error);
        }
    }
    finally {
        await (0, ensure_states_1.setBackupExportStatus)(host, { running: false });
    }
}
exports.handleBackupExportRequest = handleBackupExportRequest;
async function handleSupportExportRequest(host, val, ack) {
    if (!isConsciousRequest(val, ack))
        return;
    await host.setStateAsync(ensure_states_1.BACKUP_STATES.supportExportRequest, { val: false, ack: true });
    if ((0, operation_lock_1.isOperationRunning)()) {
        await host.setStateAsync(ensure_states_1.SUPPORT_STATES.lastError, { val: "operation_already_running", ack: true });
        return;
    }
    try {
        await (0, ensure_states_1.setBackupExportStatus)(host, { status: "exporting", running: true, lastError: "" });
        const result = await (0, support_1.runSupportBundleExport)(host);
        if (result.ok) {
            await (0, ensure_states_1.setBackupExportStatus)(host, {
                status: "idle",
                lastKind: "support",
                lastExportAt: result.createdAt,
                lastFileName: result.fileName,
                lastSizeBytes: result.sizeBytes,
                lastSha256: result.sha256,
                lastError: "",
            });
            await host.setStateAsync(ensure_states_1.SUPPORT_STATES.lastBundleAt, { val: result.createdAt, ack: true });
            await host.setStateAsync(ensure_states_1.SUPPORT_STATES.lastError, { val: "", ack: true });
        }
        else {
            await (0, ensure_states_1.setBackupExportStatus)(host, { status: "error", lastError: result.error });
            await host.setStateAsync(ensure_states_1.SUPPORT_STATES.lastError, { val: result.error, ack: true });
        }
    }
    finally {
        await (0, ensure_states_1.setBackupExportStatus)(host, { running: false });
    }
}
exports.handleSupportExportRequest = handleSupportExportRequest;
async function handleDiagnosticModeRequest(host, val, ack) {
    if (!isConsciousRequest(val, ack))
        return;
    await host.setStateAsync(ensure_states_1.SUPPORT_STATES.diagnosticRequest, { val: false, ack: true });
    const durSt = await host.getStateAsync(ensure_states_1.SUPPORT_STATES.diagnosticDurationMin);
    const durationMin = typeof durSt?.val === "number" && Number.isFinite(durSt.val)
        ? durSt.val
        : diagnostic_mode_1.DIAGNOSTIC_DEFAULT_DURATION_MIN;
    const started = (0, diagnostic_mode_1.startDiagnosticMode)(durationMin, () => {
        void syncDiagnosticStatus(host);
    });
    if (started.ok) {
        await host.setStateAsync(ensure_states_1.SUPPORT_STATES.diagnosticMode, { val: true, ack: true });
        await host.setStateAsync(ensure_states_1.SUPPORT_STATES.diagnosticExpiresAt, { val: started.expiresAt, ack: true });
    }
    else {
        await host.setStateAsync(ensure_states_1.SUPPORT_STATES.lastError, { val: started.error, ack: true });
    }
}
exports.handleDiagnosticModeRequest = handleDiagnosticModeRequest;
async function syncDiagnosticStatus(host) {
    const st = (0, diagnostic_mode_1.diagnosticModeStatus)();
    await host.setStateAsync(ensure_states_1.SUPPORT_STATES.diagnosticMode, { val: st.active, ack: true });
    await host.setStateAsync(ensure_states_1.SUPPORT_STATES.diagnosticExpiresAt, { val: st.expiresAt, ack: true });
    const bytes = await (0, diagnostic_mode_1.totalSupportLogBytes)(host);
    await host.setStateAsync(ensure_states_1.SUPPORT_STATES.logSizeBytes, { val: bytes, ack: true });
}
exports.syncDiagnosticStatus = syncDiagnosticStatus;
async function initBackupExportRuntime(host) {
    (0, diagnostic_mode_1.resetDiagnosticOnStartup)();
    await host.setStateAsync(ensure_states_1.BACKUP_STATES.exportRequest, { val: false, ack: true });
    await host.setStateAsync(ensure_states_1.BACKUP_STATES.supportExportRequest, { val: false, ack: true });
    await host.setStateAsync(ensure_states_1.SUPPORT_STATES.diagnosticMode, { val: false, ack: true });
    await host.setStateAsync(ensure_states_1.SUPPORT_STATES.diagnosticExpiresAt, { val: "", ack: true });
    await host.setStateAsync(ensure_states_1.BACKUP_STATES.schemaVersion, { val: types_1.EXPORT_SCHEMA_VERSION, ack: true });
    await syncDiagnosticStatus(host);
}
exports.initBackupExportRuntime = initBackupExportRuntime;
function isBackupRelatedState(relativeId) {
    return (relativeId.startsWith("backup.") ||
        relativeId.startsWith("support.") ||
        relativeId === ensure_states_1.BACKUP_STATES.exportRequest ||
        relativeId === ensure_states_1.BACKUP_STATES.supportExportRequest ||
        relativeId === ensure_states_1.SUPPORT_STATES.diagnosticRequest);
}
exports.isBackupRelatedState = isBackupRelatedState;
async function handleBackupStateChange(host, relativeId, val, ack) {
    if (relativeId === ensure_states_1.BACKUP_STATES.exportRequest) {
        await handleBackupExportRequest(host, val, ack);
        return;
    }
    if (relativeId === ensure_states_1.BACKUP_STATES.supportExportRequest) {
        await handleSupportExportRequest(host, val, ack);
        return;
    }
    if (relativeId === ensure_states_1.SUPPORT_STATES.diagnosticRequest) {
        await handleDiagnosticModeRequest(host, val, ack);
    }
}
exports.handleBackupStateChange = handleBackupStateChange;
