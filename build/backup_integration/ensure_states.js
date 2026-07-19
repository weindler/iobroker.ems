"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishBackupIntegrationDiagnostics = exports.ensureBackupIntegrationInfoStates = exports.BACKUP_INFO_STATES = exports.BACKUP_INFO_BASE = void 0;
const state_util_1 = require("../ems_light/state_util");
exports.BACKUP_INFO_BASE = "info.backup";
exports.BACKUP_INFO_STATES = {
    integration: `${exports.BACKUP_INFO_BASE}.integration`,
    dataFolder: `${exports.BACKUP_INFO_BASE}.data_folder`,
    runtimeFolder: `${exports.BACKUP_INFO_BASE}.runtime_folder`,
    formatVersion: `${exports.BACKUP_INFO_BASE}.format_version`,
    persistenceSchemaVersion: `${exports.BACKUP_INFO_BASE}.persistence_schema_version`,
    persistenceValid: `${exports.BACKUP_INFO_BASE}.persistence_valid`,
    lastValidationAt: `${exports.BACKUP_INFO_BASE}.last_validation_at`,
    lastValidationError: `${exports.BACKUP_INFO_BASE}.last_validation_error`,
    restoreDetection: `${exports.BACKUP_INFO_BASE}.restore_detection`,
    checkpointGeneration: `${exports.BACKUP_INFO_BASE}.checkpoint_generation`,
    journalStatus: `${exports.BACKUP_INFO_BASE}.journal_status`,
    migrationStatus: `${exports.BACKUP_INFO_BASE}.migration_status`,
    liveRearmRequired: `${exports.BACKUP_INFO_BASE}.live_rearm_required`,
    /** Button: explicit user confirm to allow live device writes after startup. */
    confirmLiveRearm: `${exports.BACKUP_INFO_BASE}.confirm_live_rearm`,
    /** True after at least one successful full backup export this process (Export-Register). */
    exportRegisterReady: `${exports.BACKUP_INFO_BASE}.export_register_ready`,
    exportRegisterHint: `${exports.BACKUP_INFO_BASE}.export_register_hint`,
};
async function ensureBackupIntegrationInfoStates(host) {
    await (0, state_util_1.ensureChannel)(host, exports.BACKUP_INFO_BASE, "Backup-Integration (Diagnose)");
    await (0, state_util_1.ensureStates)(host, [
        {
            id: exports.BACKUP_INFO_STATES.integration,
            common: { name: "Backup-Integration", type: "string", role: "text", read: true, write: false, def: "iobroker_data_folder" },
        },
        {
            id: exports.BACKUP_INFO_STATES.dataFolder,
            common: { name: "Datenordner (logisch)", type: "string", role: "text", read: true, write: false, def: "ems.%INSTANCE%" },
        },
        {
            id: exports.BACKUP_INFO_STATES.runtimeFolder,
            common: { name: "Runtime-Ordner (logisch)", type: "string", role: "text", read: true, write: false, def: "ems-runtime.%INSTANCE%" },
        },
        {
            id: exports.BACKUP_INFO_STATES.formatVersion,
            common: { name: "Manifest-Formatversion", type: "number", role: "value", read: true, write: false, def: 0 },
        },
        {
            id: exports.BACKUP_INFO_STATES.persistenceSchemaVersion,
            common: { name: "Persistenz-Schemaversion", type: "number", role: "value", read: true, write: false, def: 0 },
        },
        {
            id: exports.BACKUP_INFO_STATES.persistenceValid,
            common: { name: "Persistenz gültig", type: "boolean", role: "indicator", read: true, write: false, def: false },
        },
        {
            id: exports.BACKUP_INFO_STATES.lastValidationAt,
            common: { name: "Letzte Persistenz-Validierung", type: "string", role: "value.time", read: true, write: false, def: "" },
        },
        {
            id: exports.BACKUP_INFO_STATES.lastValidationError,
            common: { name: "Letzter Validierungsfehler", type: "string", role: "text", read: true, write: false, def: "" },
        },
        {
            id: exports.BACKUP_INFO_STATES.restoreDetection,
            common: { name: "Restore-Erkennung (diagnostisch)", type: "string", role: "text", read: true, write: false, def: "none" },
        },
        {
            id: exports.BACKUP_INFO_STATES.checkpointGeneration,
            common: { name: "Checkpoint-Generation", type: "number", role: "value", read: true, write: false, def: 0 },
        },
        {
            id: exports.BACKUP_INFO_STATES.journalStatus,
            common: { name: "Journal-Status", type: "string", role: "text", read: true, write: false, def: "none" },
        },
        {
            id: exports.BACKUP_INFO_STATES.migrationStatus,
            common: { name: "Migrations-Status", type: "string", role: "text", read: true, write: false, def: "pending" },
        },
        {
            id: exports.BACKUP_INFO_STATES.liveRearmRequired,
            common: { name: "Live-Rearm erforderlich (obsolet)", type: "boolean", role: "indicator", read: true, write: false, def: false },
        },
        {
            id: exports.BACKUP_INFO_STATES.confirmLiveRearm,
            common: {
                name: "Live-Writes freigeben (obsolet, ungenutzt)",
                type: "boolean",
                role: "button",
                read: true,
                write: true,
                def: false,
            },
            defaultVal: false,
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
                name: "Export-Register Hinweis",
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
    const now = new Date().toISOString();
    await host.setStateAsync(exports.BACKUP_INFO_STATES.integration, { val: "iobroker_data_folder", ack: true });
    await host.setStateAsync(exports.BACKUP_INFO_STATES.dataFolder, { val: diag.dataFolder, ack: true });
    await host.setStateAsync(exports.BACKUP_INFO_STATES.runtimeFolder, { val: diag.runtimeFolder, ack: true });
    await host.setStateAsync(exports.BACKUP_INFO_STATES.formatVersion, { val: diag.formatVersion, ack: true });
    await host.setStateAsync(exports.BACKUP_INFO_STATES.persistenceSchemaVersion, { val: diag.persistenceSchemaVersion, ack: true });
    await host.setStateAsync(exports.BACKUP_INFO_STATES.persistenceValid, { val: diag.persistenceValid, ack: true });
    await host.setStateAsync(exports.BACKUP_INFO_STATES.lastValidationAt, { val: now, ack: true });
    await host.setStateAsync(exports.BACKUP_INFO_STATES.lastValidationError, { val: diag.lastValidationError, ack: true });
    await host.setStateAsync(exports.BACKUP_INFO_STATES.restoreDetection, { val: diag.restoreDetection, ack: true });
    await host.setStateAsync(exports.BACKUP_INFO_STATES.checkpointGeneration, { val: diag.checkpointGeneration, ack: true });
    await host.setStateAsync(exports.BACKUP_INFO_STATES.journalStatus, { val: diag.journalStatus, ack: true });
    await host.setStateAsync(exports.BACKUP_INFO_STATES.migrationStatus, { val: diag.migrationStatus, ack: true });
    await host.setStateAsync(exports.BACKUP_INFO_STATES.liveRearmRequired, { val: diag.liveRearmRequired, ack: true });
}
exports.publishBackupIntegrationDiagnostics = publishBackupIntegrationDiagnostics;
