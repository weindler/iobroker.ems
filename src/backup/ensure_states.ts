import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../ems_light/state_util";

export const BACKUP_BASE = "backup";
export const SUPPORT_BASE = "support";

export const BACKUP_STATES = {
	status: `${BACKUP_BASE}.status`,
	running: `${BACKUP_BASE}.running`,
	lastKind: `${BACKUP_BASE}.last_kind`,
	lastExportAt: `${BACKUP_BASE}.last_export_at`,
	lastFileName: `${BACKUP_BASE}.last_file_name`,
	lastSizeBytes: `${BACKUP_BASE}.last_size_bytes`,
	lastSha256: `${BACKUP_BASE}.last_sha256`,
	lastError: `${BACKUP_BASE}.last_error`,
	schemaVersion: `${BACKUP_BASE}.schema_version`,
	exportRequest: `${BACKUP_BASE}.export_request`,
	supportExportRequest: `${BACKUP_BASE}.support_export_request`,
} as const;

export const SUPPORT_STATES = {
	diagnosticMode: `${SUPPORT_BASE}.diagnostic_mode`,
	diagnosticExpiresAt: `${SUPPORT_BASE}.diagnostic_expires_at`,
	logSizeBytes: `${SUPPORT_BASE}.log_size_bytes`,
	lastBundleAt: `${SUPPORT_BASE}.last_bundle_at`,
	lastError: `${SUPPORT_BASE}.last_error`,
	diagnosticRequest: `${SUPPORT_BASE}.diagnostic_request`,
	diagnosticDurationMin: `${SUPPORT_BASE}.diagnostic_duration_min`,
} as const;

export async function ensureBackupStates(host: StateHost): Promise<void> {
	await ensureChannel(host, BACKUP_BASE, "EMS Backup Export");
	await ensureChannel(host, SUPPORT_BASE, "EMS Support Export");

	const defs: StateDef[] = [
		{
			id: BACKUP_STATES.status,
			common: { name: "Backup-Status", type: "string", role: "text", read: true, write: false, def: "idle" },
		},
		{
			id: BACKUP_STATES.running,
			common: { name: "Export läuft", type: "boolean", role: "indicator", read: true, write: false, def: false },
		},
		{
			id: BACKUP_STATES.lastKind,
			common: { name: "Letzter Export-Typ", type: "string", role: "text", read: true, write: false, def: "" },
		},
		{
			id: BACKUP_STATES.lastExportAt,
			common: { name: "Letzter Export", type: "string", role: "date", read: true, write: false, def: "" },
		},
		{
			id: BACKUP_STATES.lastFileName,
			common: { name: "Letzte Export-Datei", type: "string", role: "text", read: true, write: false, def: "" },
		},
		{
			id: BACKUP_STATES.lastSizeBytes,
			common: { name: "Letzte Export-Größe", type: "number", role: "value", read: true, write: false, def: 0 },
		},
		{
			id: BACKUP_STATES.lastSha256,
			common: { name: "Letzte Export-Prüfsumme", type: "string", role: "text", read: true, write: false, def: "" },
		},
		{
			id: BACKUP_STATES.lastError,
			common: { name: "Letzter Export-Fehler", type: "string", role: "text", read: true, write: false, def: "" },
		},
		{
			id: BACKUP_STATES.schemaVersion,
			common: { name: "Backup-Schema", type: "number", role: "value", read: true, write: false, def: 1 },
		},
		{
			id: BACKUP_STATES.exportRequest,
			common: { name: "Backup-Export anfordern", type: "boolean", role: "button", read: true, write: true, def: false },
		},
		{
			id: BACKUP_STATES.supportExportRequest,
			common: { name: "Support-Paket anfordern", type: "boolean", role: "button", read: true, write: true, def: false },
		},
		{
			id: SUPPORT_STATES.diagnosticMode,
			common: { name: "Diagnosemodus aktiv", type: "boolean", role: "indicator", read: true, write: false, def: false },
		},
		{
			id: SUPPORT_STATES.diagnosticExpiresAt,
			common: { name: "Diagnosemodus bis", type: "string", role: "date", read: true, write: false, def: "" },
		},
		{
			id: SUPPORT_STATES.logSizeBytes,
			common: { name: "Support-Log-Größe", type: "number", role: "value", read: true, write: false, def: 0 },
		},
		{
			id: SUPPORT_STATES.lastBundleAt,
			common: { name: "Letztes Support-Paket", type: "string", role: "date", read: true, write: false, def: "" },
		},
		{
			id: SUPPORT_STATES.lastError,
			common: { name: "Letzter Support-Fehler", type: "string", role: "text", read: true, write: false, def: "" },
		},
		{
			id: SUPPORT_STATES.diagnosticRequest,
			common: { name: "Diagnosemodus starten", type: "boolean", role: "button", read: true, write: true, def: false },
		},
		{
			id: SUPPORT_STATES.diagnosticDurationMin,
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
	];
	await ensureStates(host, defs);
}

export async function setBackupExportStatus(
	host: StateHost,
	patch: Partial<{
		status: string;
		running: boolean;
		lastKind: string;
		lastExportAt: string;
		lastFileName: string;
		lastSizeBytes: number;
		lastSha256: string;
		lastError: string;
	}>,
): Promise<void> {
	const map: Array<[string, ioBroker.StateValue]> = [];
	if (patch.status !== undefined) map.push([BACKUP_STATES.status, patch.status]);
	if (patch.running !== undefined) map.push([BACKUP_STATES.running, patch.running]);
	if (patch.lastKind !== undefined) map.push([BACKUP_STATES.lastKind, patch.lastKind]);
	if (patch.lastExportAt !== undefined) map.push([BACKUP_STATES.lastExportAt, patch.lastExportAt]);
	if (patch.lastFileName !== undefined) map.push([BACKUP_STATES.lastFileName, patch.lastFileName]);
	if (patch.lastSizeBytes !== undefined) map.push([BACKUP_STATES.lastSizeBytes, patch.lastSizeBytes]);
	if (patch.lastSha256 !== undefined) map.push([BACKUP_STATES.lastSha256, patch.lastSha256]);
	if (patch.lastError !== undefined) map.push([BACKUP_STATES.lastError, patch.lastError]);
	for (const [id, val] of map) {
		await host.setStateAsync(id, { val, ack: true });
	}
}
