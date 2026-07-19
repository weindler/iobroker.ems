import { ensureChannel, ensureStates, type StateHost } from "../ems_light/state_util";
import { BACKUP_BASE } from "../backup/ensure_states";

/**
 * Lean backup diagnostics live under `backup.*` (single tree).
 * Legacy `info.backup.*` is purged by surface cleanup.
 */
export const BACKUP_INFO_BASE = BACKUP_BASE;

export const BACKUP_INFO_STATES = {
	runtimeFolder: `${BACKUP_BASE}.runtime_folder`,
	persistenceValid: `${BACKUP_BASE}.persistence_valid`,
	journalStatus: `${BACKUP_BASE}.journal_status`,
	migrationStatus: `${BACKUP_BASE}.migration_status`,
	exportRegisterReady: `${BACKUP_BASE}.export_register_ready`,
	exportRegisterHint: `${BACKUP_BASE}.export_register_hint`,
	/** @deprecated removed — kept as id for cleanup/compat reads */
	liveRearmRequired: "info.backup.live_rearm_required",
	/** @deprecated removed */
	confirmLiveRearm: "info.backup.confirm_live_rearm",
} as const;

/** Only user-relevant status under backup.* — no second info.backup tree. */
export async function ensureBackupIntegrationInfoStates(host: StateHost): Promise<void> {
	await ensureChannel(host, BACKUP_BASE, "EMS Backup Export");
	await ensureStates(host, [
		{
			id: BACKUP_INFO_STATES.runtimeFolder,
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
			id: BACKUP_INFO_STATES.persistenceValid,
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
			id: BACKUP_INFO_STATES.journalStatus,
			common: { name: "Restore-Journal Status", type: "string", role: "text", read: true, write: false, def: "none" },
		},
		{
			id: BACKUP_INFO_STATES.migrationStatus,
			common: { name: "Runtime-Migration Status", type: "string", role: "text", read: true, write: false, def: "pending" },
		},
		{
			id: BACKUP_INFO_STATES.exportRegisterReady,
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
			id: BACKUP_INFO_STATES.exportRegisterHint,
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
	await host.setStateAsync(BACKUP_INFO_STATES.runtimeFolder, { val: diag.runtimeFolder, ack: true });
	await host.setStateAsync(BACKUP_INFO_STATES.persistenceValid, { val: diag.persistenceValid, ack: true });
	await host.setStateAsync(BACKUP_INFO_STATES.journalStatus, { val: diag.journalStatus, ack: true });
	await host.setStateAsync(BACKUP_INFO_STATES.migrationStatus, { val: diag.migrationStatus, ack: true });
}
