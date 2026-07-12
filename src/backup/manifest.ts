import { randomUUID } from "node:crypto";
import {
	EXPORT_FORMAT,
	EXPORT_SCHEMA_VERSION,
	SANITIZER_VERSION,
	type ExportArchiveEntry,
	type ExportKind,
	type ExportManifest,
	type ExportManifestFileEntry,
} from "./types";
import { sha256Buffer } from "./checksum";

export function buildManifestFileEntries(entries: ExportArchiveEntry[]): ExportManifestFileEntry[] {
	return entries.map((e) => {
		const buf = typeof e.content === "string" ? Buffer.from(e.content, "utf8") : e.content;
		return {
			path: e.path.replace(/\\/g, "/"),
			size_bytes: buf.length,
			sha256: sha256Buffer(buf),
		};
	});
}

export function buildExportManifest(input: {
	kind: ExportKind;
	adapterVersion: string;
	instance: number;
	namespace: string;
	files: ExportManifestFileEntry[];
	createdAt?: string;
	exportId?: string;
}): ExportManifest {
	return {
		format: EXPORT_FORMAT,
		schema_version: EXPORT_SCHEMA_VERSION,
		kind: input.kind,
		export_id: input.exportId ?? randomUUID(),
		created_at: input.createdAt ?? new Date().toISOString(),
		adapter: {
			name: "ems",
			version: input.adapterVersion,
			instance: input.instance,
		},
		source: {
			namespace: input.namespace,
		},
		compatibility: {
			minimum_restore_schema: 1,
		},
		safety: {
			restore_must_start_dryrun: true,
			automatic_live_resume_allowed: false,
		},
		privacy: {
			sanitizer_version: SANITIZER_VERSION,
			support_bundle_anonymized: input.kind === "support",
		},
		restore: input.kind === "support" ? { supported: false } : undefined,
		files: input.files,
	};
}

export function exportFileName(kind: ExportKind, adapterVersion: string, createdAt: string): string {
	const safeVersion = adapterVersion.replace(/[^0-9.a-zA-Z-]/g, "_");
	const ts = createdAt.replace(/[:.]/g, "").replace("Z", "Z");
	const ext = kind === "backup" ? "emsbackup" : "emssupport";
	return `ems-light-${safeVersion}-${kind}-${ts}.${ext}`;
}
