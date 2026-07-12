import type { ExportManifest } from "../backup/types";

export const RESTORE_JOURNAL_SCHEMA_VERSION = 1;
export const RESTORE_JOURNAL_SCHEMA_VERSION_V2 = 2;
export const RESTORE_PLAN_TTL_MS = 15 * 60_000;

export type RestoreStatus =
	| "idle"
	| "validating"
	| "ready"
	| "applying"
	| "success_restart_required"
	| "rolling_back"
	| "rolled_back"
	| "error"
	| "recovery_required"
	| "recovery_failed";

export type RestoreJournalPhase =
	| "prepared"
	| "dryrun_locked"
	| "config_applied"
	| "learning_applied"
	| "runtime_cleared"
	| "committed"
	| "rollback_running"
	| "rolled_back"
	| "failed";

export interface RestoreArchiveIdentity {
	fileName: string;
	rootKind: "backup_dir" | "inbox";
	archiveSha256: string;
	sizeBytes: number;
	mtimeMs: number;
}

export interface RestorePayloadFile {
	path: string;
	content: Buffer;
}

export interface RestoreProjection {
	native: Record<string, unknown>;
	learning: Record<string, unknown>;
	configuredModesAtExport: Record<string, string>;
	warnings: string[];
	skippedClasses: string[];
}

export interface RestorePlanSummary {
	fileName: string;
	backupVersion: string;
	schemaVersion: number;
	exportAt: string;
	changedConfigFields: number;
	vehicleProfileCount: number;
	learningFileCount: number;
	learningFilesToRemove: number;
	skippedClasses: string[];
	warnings: string[];
	configuredModesAtExport: Record<string, string>;
	applyModes: Record<string, "dryrun">;
}

export interface RestorePlan {
	planId: string;
	createdAt: string;
	expiresAt: string;
	used: boolean;
	identity: RestoreArchiveIdentity;
	manifest: ExportManifest;
	projection: RestoreProjection;
	summary: RestorePlanSummary;
}

export interface RestoreJournal {
	schema_version: number;
	transaction_id: string;
	archive_file_name: string;
	archive_sha256: string;
	phase: RestoreJournalPhase;
	created_at: string;
	updated_at: string;
	restore_must_start_dryrun: true;
	data_epoch?: string;
	base_checkpoint_generation?: number;
	base_checkpoint_id?: string;
	transaction_fence_id?: string;
	instance?: number;
	namespace?: string;
}

export interface RestoreHost {
	namespace: string;
	config: unknown;
	common?: { version?: string };
	log: ioBroker.Logger;
	getAbsoluteInstanceDataDir?: () => string;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
	setObjectNotExistsAsync: (id: string, obj: ioBroker.Object) => Promise<unknown>;
	getObjectAsync?: (id: string) => Promise<ioBroker.Object | null | undefined>;
	updateConfig?: (config: Record<string, unknown>) => Promise<unknown>;
}

export type RestoreResult =
	| { ok: true; status: RestoreStatus; planId?: string; transactionId?: string }
	| { ok: false; error: string; status?: RestoreStatus };
