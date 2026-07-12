/** EMS-Light Export v0.1.141 — gemeinsame Typen für Backup und Support. */

import type { StateHost } from "../ems_light/state_util";

export const EXPORT_FORMAT = "ems-light-export" as const;
export const EXPORT_SCHEMA_VERSION = 1;
export const SANITIZER_VERSION = 1;

export type ExportKind = "backup" | "support";

export type PersistenceClass = "restorable" | "support_only" | "transient" | "excluded";

export interface ExportManifestFileEntry {
	path: string;
	size_bytes: number;
	sha256: string;
}

export interface ExportManifestSafety {
	restore_must_start_dryrun: true;
	automatic_live_resume_allowed: false;
}

export interface ExportManifestPrivacy {
	sanitizer_version: number;
	support_bundle_anonymized: boolean;
}

export interface ExportManifestRestore {
	supported: boolean;
}

export interface ExportManifest {
	format: typeof EXPORT_FORMAT;
	schema_version: number;
	kind: ExportKind;
	export_id: string;
	created_at: string;
	adapter: {
		name: string;
		version: string;
		instance: number;
	};
	source: {
		namespace: string;
	};
	compatibility: {
		minimum_restore_schema: number;
	};
	safety: ExportManifestSafety;
	privacy: ExportManifestPrivacy;
	restore?: ExportManifestRestore;
	files: ExportManifestFileEntry[];
}

export interface ExportArchiveEntry {
	path: string;
	content: Buffer | string;
}

export interface ExportBuildResult {
	ok: true;
	kind: ExportKind;
	filePath: string;
	fileName: string;
	sizeBytes: number;
	sha256: string;
	exportId: string;
	createdAt: string;
}

export interface ExportBuildFailure {
	ok: false;
	error: string;
}

export type ExportResult = ExportBuildResult | ExportBuildFailure;

export interface ConfiguredExecutionModesSnapshot {
	global: string;
	wallbox: string;
	battery: string;
	immersion_heater: string;
	air_conditioning: string;
}

export interface AdapterConfigExport {
	allowed_native: Record<string, unknown>;
	configured_modes_at_export: ConfiguredExecutionModesSnapshot;
	restore_policy: {
		apply_as: "dryrun";
	};
}

export interface StateSnapshotEntry {
	id: string;
	value: ioBroker.StateValue;
	ack: boolean;
	ts: number;
	lc: number;
	quality?: string;
}

export interface ExportServiceHost extends StateHost {
	namespace: string;
	config: unknown;
	common?: { version?: string };
	log: ioBroker.Logger;
	getAbsoluteInstanceDataDir?: () => string;
	getObjectAsync?: (id: string) => Promise<ioBroker.Object | null | undefined>;
}
