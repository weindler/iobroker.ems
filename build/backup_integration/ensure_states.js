"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishBackupIntegrationDiagnostics = exports.ensureBackupIntegrationInfoStates = exports.BACKUP_INFO_STATES = exports.BACKUP_INFO_BASE = void 0;
const state_util_1 = require("../ems_light/state_util");
const ensure_states_1 = require("../backup/ensure_states");
/**
 * Lean backup diagnostics live under `backup.*` (single tree).
 * Legacy `info.backup.*` is purged by surface cleanup.
 */
exports.BACKUP_INFO_BASE = ensure_states_1.BACKUP_BASE;
exports.BACKUP_INFO_STATES = {
    runtimeFolder: `${ensure_states_1.BACKUP_BASE}.runtime_folder`,
    persistenceValid: `${ensure_states_1.BACKUP_BASE}.persistence_valid`,
    journalStatus: `${ensure_states_1.BACKUP_BASE}.journal_status`,
    migrationStatus: `${ensure_states_1.BACKUP_BASE}.migration_status`,
    exportRegisterReady: `${ensure_states_1.BACKUP_BASE}.export_register_ready`,
    exportRegisterHint: `${ensure_states_1.BACKUP_BASE}.export_register_hint`,
    /** @deprecated removed — kept as id for cleanup/compat reads */
    liveRearmRequired: "info.backup.live_rearm_required",
    /** @deprecated removed */
    confirmLiveRearm: "info.backup.confirm_live_rearm",
};
/** Only user-relevant status under backup.* — no second info.backup tree. */
async function ensureBackupIntegrationInfoStates(host) {
    await (0, state_util_1.ensureChannel)(host, ensure_states_1.BACKUP_BASE, "EMS Backup Export");
    await (0, state_util_1.ensureStates)(host, [
        {
            id: exports.BACKUP_INFO_STATES.runtimeFolder,
            common: {
                name: "Runtime-Ordner (Backup/Learning)",
                type: "string",
                role: "text",
                read: true,
                write: false,
                def: "ems-runtime.%INSTANCE%",
            },
        },
        {
            id: exports.BACKUP_INFO_STATES.persistenceValid,
            common: {
                name: "Persistenz gültig",
                type: "boolean",
                role: "indicator",
                read: true,
                write: false,
                def: false,
            },
        },
        {
            id: exports.BACKUP_INFO_STATES.journalStatus,
            common: { name: "Restore-Journal Status", type: "string", role: "text", read: true, write: false, def: "none" },
        },
        {
            id: exports.BACKUP_INFO_STATES.migrationStatus,
            common: { name: "Runtime-Migration Status", type: "string", role: "text", read: true, write: false, def: "pending" },
        },
        {
            id: exports.BACKUP_INFO_STATES.exportRegisterReady,
            common: {
                name: "Export-Register bereit (letzter Export ok)",
                type: "boolean",
                role: "indicator",
                read: true,
                write: false,
                def: false,
            },
        },
        {
            id: exports.BACKUP_INFO_STATES.exportRegisterHint,
            common: {
                name: "Export-Pfad Hinweis",
                type: "string",
                role: "text",
                read: true,
                write: false,
                def: "ems-runtime.%INSTANCE%/exports/backup/",
            },
        },
    ]);
}
exports.ensureBackupIntegrationInfoStates = ensureBackupIntegrationInfoStates;
async function publishBackupIntegrationDiagnostics(host, diag) {
    await host.setStateAsync(exports.BACKUP_INFO_STATES.runtimeFolder, { val: diag.runtimeFolder, ack: true });
    await host.setStateAsync(exports.BACKUP_INFO_STATES.persistenceValid, { val: diag.persistenceValid, ack: true });
    await host.setStateAsync(exports.BACKUP_INFO_STATES.journalStatus, { val: diag.journalStatus, ack: true });
    await host.setStateAsync(exports.BACKUP_INFO_STATES.migrationStatus, { val: diag.migrationStatus, ack: true });
}
exports.publishBackupIntegrationDiagnostics = publishBackupIntegrationDiagnostics;
