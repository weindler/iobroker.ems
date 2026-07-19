import { EXPORT_SCHEMA_VERSION } from "./types";
import { BACKUP_STATES, SUPPORT_STATES, setBackupExportStatus } from "./ensure_states";
import { isOperationRunning } from "./operation_lock";
import type { ExportServiceHost } from "./types";
import {
	DIAGNOSTIC_DEFAULT_DURATION_MIN,
	diagnosticModeStatus,
	recordDiagnosticEvent,
	resetDiagnosticOnStartup,
	startDiagnosticMode,
	stopDiagnosticMode,
	totalSupportLogBytes,
} from "../support/diagnostic_mode";
import { runSupportBundleExport } from "../support";
import { runBackupExport } from "./service";
import { BACKUP_INFO_STATES } from "../backup_integration/ensure_states";

function isConsciousRequest(val: unknown, ack: boolean | undefined): boolean {
	return val === true && ack !== true;
}

async function publishExportRegisterStatus(
	host: ExportServiceHost,
	ok: boolean,
	detail: string,
): Promise<void> {
	try {
		await host.setStateAsync(BACKUP_INFO_STATES.exportRegisterReady, { val: ok, ack: true });
		await host.setStateAsync(BACKUP_INFO_STATES.exportRegisterHint, {
			val: detail,
			ack: true,
		});
	} catch {
		/* backup.* may not exist yet on very early calls */
	}
}

export async function handleBackupExportRequest(
	host: ExportServiceHost,
	val: unknown,
	ack?: boolean,
): Promise<void> {
	if (!isConsciousRequest(val, ack)) return;
	await host.setStateAsync(BACKUP_STATES.exportRequest, { val: false, ack: true });
	try {
		await setBackupExportStatus(host, { status: "exporting", running: true, lastError: "" });
		const result = await runBackupExport(host);
		if (result.ok) {
			await setBackupExportStatus(host, {
				status: "idle",
				lastKind: "backup",
				lastExportAt: result.createdAt,
				lastFileName: result.fileName,
				lastSizeBytes: result.sizeBytes,
				lastSha256: result.sha256,
				lastError: "",
			});
			await publishExportRegisterStatus(
				host,
				true,
				`ems-runtime.%INSTANCE%/exports/backup/${result.fileName}`,
			);
			try {
				const { mirrorHostExportFile } = await import("./admin_files.js");
				await mirrorHostExportFile(host as import("./admin_files").AdapterFilesHost, "backup", result.fileName);
			} catch (e) {
				host.log?.warn?.(
					`backup: Admin-File-Spiegel fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`,
				);
			}
		} else {
			await setBackupExportStatus(host, {
				status: "error",
				lastError: result.error,
			});
			await publishExportRegisterStatus(host, false, result.error);
		}
	} finally {
		await setBackupExportStatus(host, { running: false });
	}
}

export async function handleSupportExportRequest(
	host: ExportServiceHost,
	val: unknown,
	ack?: boolean,
): Promise<void> {
	if (!isConsciousRequest(val, ack)) return;
	await host.setStateAsync(BACKUP_STATES.supportExportRequest, { val: false, ack: true });
	if (isOperationRunning()) {
		await host.setStateAsync(SUPPORT_STATES.lastError, { val: "operation_already_running", ack: true });
		return;
	}
	try {
		await setBackupExportStatus(host, { status: "exporting", running: true, lastError: "" });
		const result = await runSupportBundleExport(host);
		if (result.ok) {
			await setBackupExportStatus(host, {
				status: "idle",
				lastKind: "support",
				lastExportAt: result.createdAt,
				lastFileName: result.fileName,
				lastSizeBytes: result.sizeBytes,
				lastSha256: result.sha256,
				lastError: "",
			});
			await host.setStateAsync(SUPPORT_STATES.lastBundleAt, { val: result.createdAt, ack: true });
			await host.setStateAsync(SUPPORT_STATES.lastError, { val: "", ack: true });
			try {
				const { mirrorHostExportFile } = await import("./admin_files.js");
				await mirrorHostExportFile(host as import("./admin_files").AdapterFilesHost, "support", result.fileName);
			} catch (e) {
				host.log?.warn?.(
					`support: Admin-File-Spiegel fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`,
				);
			}
		} else {
			await setBackupExportStatus(host, { status: "error", lastError: result.error });
			await host.setStateAsync(SUPPORT_STATES.lastError, { val: result.error, ack: true });
		}
	} finally {
		await setBackupExportStatus(host, { running: false });
	}
}

export async function handleDiagnosticModeRequest(
	host: ExportServiceHost,
	val: unknown,
	ack?: boolean,
	durationOverride?: number,
): Promise<{ ok: true; expiresAt: string; durationMin: number } | { ok: false; error: string }> {
	if (!isConsciousRequest(val, ack)) {
		return { ok: false, error: "ignored" };
	}
	await host.setStateAsync(SUPPORT_STATES.diagnosticRequest, { val: false, ack: true });
	let durationMin = DIAGNOSTIC_DEFAULT_DURATION_MIN;
	if (typeof durationOverride === "number" && Number.isFinite(durationOverride)) {
		durationMin = durationOverride;
	} else {
		const durSt = await host.getStateAsync(SUPPORT_STATES.diagnosticDurationMin);
		if (typeof durSt?.val === "number" && Number.isFinite(durSt.val)) {
			durationMin = durSt.val;
		}
	}
	await host.setStateAsync(SUPPORT_STATES.diagnosticDurationMin, { val: durationMin, ack: true });
	const started = startDiagnosticMode(durationMin, () => {
		void (async () => {
			await syncDiagnosticStatus(host);
			host.log?.info?.(
				`Diagnosemodus automatisch beendet nach ${durationMin} Min — Support-Paket ggf. jetzt erstellen`,
			);
		})();
	});
	if (started.ok) {
		await host.setStateAsync(SUPPORT_STATES.diagnosticMode, { val: true, ack: true });
		await host.setStateAsync(SUPPORT_STATES.diagnosticExpiresAt, { val: started.expiresAt, ack: true });
		await host.setStateAsync(SUPPORT_STATES.lastError, { val: "", ack: true });
		try {
			await recordDiagnosticEvent(host, {
				ts: new Date().toISOString(),
				level: "info",
				module: "support",
				event: "diagnostic_mode_started",
				detail: `duration_min=${durationMin};expires_at=${started.expiresAt}`,
			});
			await syncDiagnosticStatus(host);
		} catch {
			/* logging optional */
		}
		host.log?.info?.(
			`Diagnosemodus gestartet für ${durationMin} Min — endet automatisch ${started.expiresAt}`,
		);
		return { ok: true, expiresAt: started.expiresAt, durationMin };
	}
	await host.setStateAsync(SUPPORT_STATES.lastError, { val: started.error, ack: true });
	return { ok: false, error: started.error };
}

export async function handleDiagnosticStopRequest(
	host: ExportServiceHost,
): Promise<{ ok: true; wasActive: boolean }> {
	const wasActive = diagnosticModeStatus().active;
	stopDiagnosticMode();
	await syncDiagnosticStatus(host);
	await host.setStateAsync(SUPPORT_STATES.diagnosticRequest, { val: false, ack: true });
	if (wasActive) {
		host.log?.info?.("Diagnosemodus manuell beendet");
	}
	return { ok: true, wasActive };
}

export async function syncDiagnosticStatus(host: ExportServiceHost): Promise<void> {
	const st = diagnosticModeStatus();
	await host.setStateAsync(SUPPORT_STATES.diagnosticMode, { val: st.active, ack: true });
	await host.setStateAsync(SUPPORT_STATES.diagnosticExpiresAt, { val: st.expiresAt, ack: true });
	const bytes = await totalSupportLogBytes(host);
	await host.setStateAsync(SUPPORT_STATES.logSizeBytes, { val: bytes, ack: true });
}

export async function initBackupExportRuntime(host: ExportServiceHost): Promise<void> {
	resetDiagnosticOnStartup();
	await host.setStateAsync(BACKUP_STATES.exportRequest, { val: false, ack: true });
	await host.setStateAsync(BACKUP_STATES.supportExportRequest, { val: false, ack: true });
	await host.setStateAsync(SUPPORT_STATES.diagnosticMode, { val: false, ack: true });
	await host.setStateAsync(SUPPORT_STATES.diagnosticExpiresAt, { val: "", ack: true });
	await host.setStateAsync(BACKUP_STATES.schemaVersion, { val: EXPORT_SCHEMA_VERSION, ack: true });
	await syncDiagnosticStatus(host);
}

export function isBackupRelatedState(relativeId: string): boolean {
	return (
		relativeId.startsWith("backup.") ||
		relativeId.startsWith("support.") ||
		relativeId === BACKUP_STATES.exportRequest ||
		relativeId === BACKUP_STATES.supportExportRequest ||
		relativeId === SUPPORT_STATES.diagnosticRequest
	);
}

export async function handleBackupStateChange(
	host: ExportServiceHost,
	relativeId: string,
	val: unknown,
	ack?: boolean,
): Promise<void> {
	if (relativeId === BACKUP_STATES.exportRequest) {
		await handleBackupExportRequest(host, val, ack);
		return;
	}
	if (relativeId === BACKUP_STATES.supportExportRequest) {
		await handleSupportExportRequest(host, val, ack);
		return;
	}
	if (relativeId === SUPPORT_STATES.diagnosticRequest) {
		await handleDiagnosticModeRequest(host, val, ack);
	}
}

export { stopDiagnosticMode };
