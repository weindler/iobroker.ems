"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setBackupExportStatus = exports.ensureBackupStates = exports.SUPPORT_STATES = exports.RESTORE_STATES = exports.BACKUP_STATES = exports.SUPPORT_BASE = exports.BACKUP_BASE = void 0;
const state_util_1 = require("../ems_light/state_util");
exports.BACKUP_BASE = "backup";
exports.SUPPORT_BASE = "support";
exports.BACKUP_STATES = {
    status: `${exports.BACKUP_BASE}.status`,
    running: `${exports.BACKUP_BASE}.running`,
    lastKind: `${exports.BACKUP_BASE}.last_kind`,
    lastExportAt: `${exports.BACKUP_BASE}.last_export_at`,
    lastFileName: `${exports.BACKUP_BASE}.last_file_name`,
    lastSizeBytes: `${exports.BACKUP_BASE}.last_size_bytes`,
    lastSha256: `${exports.BACKUP_BASE}.last_sha256`,
    lastError: `${exports.BACKUP_BASE}.last_error`,
    schemaVersion: `${exports.BACKUP_BASE}.schema_version`,
    exportRequest: `${exports.BACKUP_BASE}.export_request`,
    supportExportRequest: `${exports.BACKUP_BASE}.support_export_request`,
};
exports.RESTORE_STATES = {
    selectedFile: `${exports.BACKUP_BASE}.restore.selected_file`,
    validateRequest: `${exports.BACKUP_BASE}.restore.validate_request`,
    status: `${exports.BACKUP_BASE}.restore.status`,
    running: `${exports.BACKUP_BASE}.restore.running`,
    planId: `${exports.BACKUP_BASE}.restore.plan_id`,
    planExpiresAt: `${exports.BACKUP_BASE}.restore.plan_expires_at`,
    archiveSha256: `${exports.BACKUP_BASE}.restore.archive_sha256`,
    summaryJson: `${exports.BACKUP_BASE}.restore.summary_json`,
    confirmPlanId: `${exports.BACKUP_BASE}.restore.confirm_plan_id`,
    applyRequest: `${exports.BACKUP_BASE}.restore.apply_request`,
    transactionId: `${exports.BACKUP_BASE}.restore.transaction_id`,
    lastRestoreAt: `${exports.BACKUP_BASE}.restore.last_restore_at`,
    lastFileName: `${exports.BACKUP_BASE}.restore.last_file_name`,
    lastResult: `${exports.BACKUP_BASE}.restore.last_result`,
    lastError: `${exports.BACKUP_BASE}.restore.last_error`,
    restartRequired: `${exports.BACKUP_BASE}.restore.restart_required`,
};
exports.SUPPORT_STATES = {
    diagnosticMode: `${exports.SUPPORT_BASE}.diagnostic_mode`,
    diagnosticExpiresAt: `${exports.SUPPORT_BASE}.diagnostic_expires_at`,
    logSizeBytes: `${exports.SUPPORT_BASE}.log_size_bytes`,
    lastBundleAt: `${exports.SUPPORT_BASE}.last_bundle_at`,
    lastError: `${exports.SUPPORT_BASE}.last_error`,
    diagnosticRequest: `${exports.SUPPORT_BASE}.diagnostic_request`,
    diagnosticDurationMin: `${exports.SUPPORT_BASE}.diagnostic_duration_min`,
};
async function ensureBackupStates(host) {
    await (0, state_util_1.ensureChannel)(host, exports.BACKUP_BASE, "EMS Backup Export");
    await (0, state_util_1.ensureChannel)(host, exports.SUPPORT_BASE, "EMS Support Export");
    const defs = [
        {
            id: exports.BACKUP_STATES.status,
            common: { name: "Backup-Status", type: "string", role: "text", read: true, write: false, def: "idle" },
        },
        {
            id: exports.BACKUP_STATES.running,
            common: { name: "Export läuft", type: "boolean", role: "indicator", read: true, write: false, def: false },
        },
        {
            id: exports.BACKUP_STATES.lastExportAt,
            common: { name: "Letzter Export", type: "string", role: "date", read: true, write: false, def: "" },
        },
        {
            id: exports.BACKUP_STATES.lastFileName,
            common: { name: "Letzte Export-Datei", type: "string", role: "text", read: true, write: false, def: "" },
        },
        {
            id: exports.BACKUP_STATES.lastError,
            common: { name: "Letzter Export-Fehler", type: "string", role: "text", read: true, write: false, def: "" },
        },
        {
            id: exports.BACKUP_STATES.exportRequest,
            common: { name: "Backup-Export anfordern", type: "boolean", role: "button", read: true, write: true, def: false },
        },
        {
            id: exports.BACKUP_STATES.supportExportRequest,
            common: { name: "Support-Paket anfordern", type: "boolean", role: "button", read: true, write: true, def: false },
        },
        {
            id: exports.SUPPORT_STATES.diagnosticMode,
            common: { name: "Diagnosemodus aktiv", type: "boolean", role: "indicator", read: true, write: false, def: false },
        },
        {
            id: exports.SUPPORT_STATES.diagnosticExpiresAt,
            common: { name: "Diagnosemodus bis", type: "string", role: "date", read: true, write: false, def: "" },
        },
        {
            id: exports.SUPPORT_STATES.logSizeBytes,
            common: { name: "Support-Log-Größe", type: "number", role: "value", read: true, write: false, def: 0 },
        },
        {
            id: exports.SUPPORT_STATES.lastBundleAt,
            common: { name: "Letztes Support-Paket", type: "string", role: "date", read: true, write: false, def: "" },
        },
        {
            id: exports.SUPPORT_STATES.lastError,
            common: { name: "Letzter Support-Fehler", type: "string", role: "text", read: true, write: false, def: "" },
        },
        {
            id: exports.SUPPORT_STATES.diagnosticRequest,
            common: { name: "Diagnosemodus starten", type: "boolean", role: "button", read: true, write: true, def: false },
        },
        {
            id: exports.SUPPORT_STATES.diagnosticDurationMin,
            common: {
                name: "Diagnosemodus Dauer (Min.)",
                type: "number",
                role: "value",
                read: true,
                write: true,
                def: 60,
                min: 15,
                max: 120,
            },
        },
        {
            id: exports.RESTORE_STATES.selectedFile,
            common: { name: "Restore-Datei", type: "string", role: "text", read: true, write: true, def: "" },
        },
        {
            id: exports.RESTORE_STATES.validateRequest,
            common: { name: "Restore validieren", type: "boolean", role: "button", read: true, write: true, def: false },
        },
        {
            id: exports.RESTORE_STATES.status,
            common: { name: "Restore-Status", type: "string", role: "text", read: true, write: false, def: "idle" },
        },
        {
            id: exports.RESTORE_STATES.running,
            common: { name: "Restore läuft", type: "boolean", role: "indicator", read: true, write: false, def: false },
        },
        {
            id: exports.RESTORE_STATES.planId,
            common: { name: "Restore-Plan-ID", type: "string", role: "text", read: true, write: false, def: "" },
        },
        {
            id: exports.RESTORE_STATES.summaryJson,
            common: { name: "Restore-Vorschau", type: "string", role: "json", read: true, write: false, def: "{}" },
        },
        {
            id: exports.RESTORE_STATES.confirmPlanId,
            common: { name: "Restore-Plan bestätigen", type: "string", role: "text", read: true, write: true, def: "" },
        },
        {
            id: exports.RESTORE_STATES.applyRequest,
            common: { name: "Restore anwenden", type: "boolean", role: "button", read: true, write: true, def: false },
        },
        {
            id: exports.RESTORE_STATES.lastRestoreAt,
            common: { name: "Letzter Restore", type: "string", role: "date", read: true, write: false, def: "" },
        },
        {
            id: exports.RESTORE_STATES.lastFileName,
            common: { name: "Letzte Restore-Datei", type: "string", role: "text", read: true, write: false, def: "" },
        },
        {
            id: exports.RESTORE_STATES.lastResult,
            common: { name: "Letztes Restore-Ergebnis", type: "string", role: "text", read: true, write: false, def: "" },
        },
        {
            id: exports.RESTORE_STATES.lastError,
            common: { name: "Letzter Restore-Fehler", type: "string", role: "text", read: true, write: false, def: "" },
        },
        {
            id: exports.RESTORE_STATES.restartRequired,
            common: { name: "Neustart erforderlich", type: "boolean", role: "indicator", read: true, write: false, def: false },
        },
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensureBackupStates = ensureBackupStates;
async function setBackupExportStatus(host, patch) {
    const map = [];
    if (patch.status !== undefined)
        map.push([exports.BACKUP_STATES.status, patch.status]);
    if (patch.running !== undefined)
        map.push([exports.BACKUP_STATES.running, patch.running]);
    if (patch.lastExportAt !== undefined)
        map.push([exports.BACKUP_STATES.lastExportAt, patch.lastExportAt]);
    if (patch.lastFileName !== undefined)
        map.push([exports.BACKUP_STATES.lastFileName, patch.lastFileName]);
    if (patch.lastError !== undefined)
        map.push([exports.BACKUP_STATES.lastError, patch.lastError]);
    for (const [id, val] of map) {
        await host.setStateAsync(id, { val, ack: true });
    }
}
exports.setBackupExportStatus = setBackupExportStatus;
