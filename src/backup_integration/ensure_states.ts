import { ensureChannel, ensureStates, type StateHost } from "../ems_light/state_util";

export const BACKUP_INFO_BASE = "info.backup";

export const BACKUP_INFO_STATES = {
	integration: `${BACKUP_INFO_BASE}.integration`,
	dataFolder: `${BACKUP_INFO_BASE}.data_folder`,
	runtimeFolder: `${BACKUP_INFO_BASE}.runtime_folder`,
	formatVersion: `${BACKUP_INFO_BASE}.format_version`,
	persistenceSchemaVersion: `${BACKUP_INFO_BASE}.persistence_schema_version`,
	persistenceValid: `${BACKUP_INFO_BASE}.persistence_valid`,
	lastValidationAt: `${BACKUP_INFO_BASE}.last_validation_at`,
	lastValidationError: `${BACKUP_INFO_BASE}.last_validation_error`,
	restoreDetection: `${BACKUP_INFO_BASE}.restore_detection`,
	checkpointGeneration: `${BACKUP_INFO_BASE}.checkpoint_generation`,
	journalStatus: `${BACKUP_INFO_BASE}.journal_status`,
	migrationStatus: `${BACKUP_INFO_BASE}.migration_status`,
	liveRearmRequired: `${BACKUP_INFO_BASE}.live_rearm_required`,
} as const;

export async function ensureBackupIntegrationInfoStates(host: StateHost): Promise<void> {
	await ensureChannel(host, BACKUP_INFO_BASE, "Backup-Integration (Diagnose)");
	await ensureStates(host, [
		{
			id: BACKUP_INFO_STATES.integration,
			common: { name: "Backup-Integration", type: "string", role: "text", read: true, write: false, def: "iobroker_data_folder" },
		},
		{
			id: BACKUP_INFO_STATES.dataFolder,
			common: { name: "Datenordner (logisch)", type: "string", role: "text", read: true, write: false, def: "ems.%INSTANCE%" },
		},
		{
			id: BACKUP_INFO_STATES.runtimeFolder,
			common: { name: "Runtime-Ordner (logisch)", type: "string", role: "text", read: true, write: false, def: "ems-runtime.%INSTANCE%" },
		},
		{
			id: BACKUP_INFO_STATES.formatVersion,
			common: { name: "Manifest-Formatversion", type: "number", role: "value", read: true, write: false, def: 0 },
		},
		{
			id: BACKUP_INFO_STATES.persistenceSchemaVersion,
			common: { name: "Persistenz-Schemaversion", type: "number", role: "value", read: true, write: false, def: 0 },
		},
		{
			id: BACKUP_INFO_STATES.persistenceValid,
			common: { name: "Persistenz gültig", type: "boolean", role: "indicator", read: true, write: false, def: false },
		},
		{
			id: BACKUP_INFO_STATES.lastValidationAt,
			common: { name: "Letzte Persistenz-Validierung", type: "string", role: "value.time", read: true, write: false, def: "" },
		},
		{
			id: BACKUP_INFO_STATES.lastValidationError,
			common: { name: "Letzter Validierungsfehler", type: "string", role: "text", read: true, write: false, def: "" },
		},
		{
			id: BACKUP_INFO_STATES.restoreDetection,
			common: { name: "Restore-Erkennung (diagnostisch)", type: "string", role: "text", read: true, write: false, def: "none" },
		},
		{
			id: BACKUP_INFO_STATES.checkpointGeneration,
			common: { name: "Checkpoint-Generation", type: "number", role: "value", read: true, write: false, def: 0 },
		},
		{
			id: BACKUP_INFO_STATES.journalStatus,
			common: { name: "Journal-Status", type: "string", role: "text", read: true, write: false, def: "none" },
		},
		{
			id: BACKUP_INFO_STATES.migrationStatus,
			common: { name: "Migrations-Status", type: "string", role: "text", read: true, write: false, def: "pending" },
		},
		{
			id: BACKUP_INFO_STATES.liveRearmRequired,
			common: { name: "Live-Rearm erforderlich", type: "boolean", role: "indicator", read: true, write: false, def: true },
		},
	]);
}

export async function publishBackupIntegrationDiagnostics(
	host: StateHost,
	diag: {
		dataFolder: string;
		runtimeFolder: string;
		formatVersion: number;
		persistenceSchemaVersion: number;
		persistenceValid: boolean;
		lastValidationError: string;
		restoreDetection: string;
		checkpointGeneration: number;
		journalStatus: string;
		migrationStatus: string;
		liveRearmRequired: boolean;
	},
): Promise<void> {
	const now = new Date().toISOString();
	await host.setStateAsync(BACKUP_INFO_STATES.integration, { val: "iobroker_data_folder", ack: true });
	await host.setStateAsync(BACKUP_INFO_STATES.dataFolder, { val: diag.dataFolder, ack: true });
	await host.setStateAsync(BACKUP_INFO_STATES.runtimeFolder, { val: diag.runtimeFolder, ack: true });
	await host.setStateAsync(BACKUP_INFO_STATES.formatVersion, { val: diag.formatVersion, ack: true });
	await host.setStateAsync(BACKUP_INFO_STATES.persistenceSchemaVersion, { val: diag.persistenceSchemaVersion, ack: true });
	await host.setStateAsync(BACKUP_INFO_STATES.persistenceValid, { val: diag.persistenceValid, ack: true });
	await host.setStateAsync(BACKUP_INFO_STATES.lastValidationAt, { val: now, ack: true });
	await host.setStateAsync(BACKUP_INFO_STATES.lastValidationError, { val: diag.lastValidationError, ack: true });
	await host.setStateAsync(BACKUP_INFO_STATES.restoreDetection, { val: diag.restoreDetection, ack: true });
	await host.setStateAsync(BACKUP_INFO_STATES.checkpointGeneration, { val: diag.checkpointGeneration, ack: true });
	await host.setStateAsync(BACKUP_INFO_STATES.journalStatus, { val: diag.journalStatus, ack: true });
	await host.setStateAsync(BACKUP_INFO_STATES.migrationStatus, { val: diag.migrationStatus, ack: true });
	await host.setStateAsync(BACKUP_INFO_STATES.liveRearmRequired, { val: diag.liveRearmRequired, ack: true });
}
