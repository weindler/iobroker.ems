import { sha256Buffer } from "../backup/checksum";
import { EXPORT_FORMAT, EXPORT_SCHEMA_VERSION, type ExportManifest } from "../backup/types";
import { validateManifest } from "../backup/schema";
import { validateManifestPayloadConsistency, extractManifestFromArchiveEntries } from "../backup/manifest_validate";
import type { ExportArchiveEntry } from "../backup/types";
import { readStoreZipArchive, zipEntriesToMap } from "./zip_reader";
import type { RestorePayloadFile } from "./types";

const REQUIRED_BACKUP_PATHS = [
	"config/adapter.json",
	"config/mappings.json",
	"config/vehicle_profiles.json",
	"config/policies.json",
	"persistence/learning.json",
	"persistence/user_settings.json",
	"persistence/selected_state_data.json",
	"metadata/inventory.json",
] as const;

export interface ValidatedRestoreArchive {
	archiveSha256: string;
	manifest: ExportManifest;
	payload: RestorePayloadFile[];
	payloadMap: Map<string, Buffer>;
}

export function assertRestoreManifest(manifest: ExportManifest): void {
	validateManifest(manifest, "backup");
	if (manifest.format !== EXPORT_FORMAT) {
		throw new Error("invalid manifest format");
	}
	if (manifest.schema_version !== EXPORT_SCHEMA_VERSION) {
		throw new Error("unsupported schema_version");
	}
	if (manifest.kind !== "backup") {
		throw new Error("only backup archives are restorable");
	}
	if (manifest.restore?.supported === false) {
		throw new Error("support packages not restorable");
	}
	if (manifest.adapter.name !== "ems") {
		throw new Error("invalid adapter name");
	}
	if (!manifest.safety.restore_must_start_dryrun || manifest.safety.automatic_live_resume_allowed) {
		throw new Error("invalid safety block");
	}
	for (const req of REQUIRED_BACKUP_PATHS) {
		if (!manifest.files.some((f) => f.path === req)) {
			throw new Error(`missing required file: ${req}`);
		}
	}
}

export function validateRestoreArchiveBuffer(archive: Buffer): ValidatedRestoreArchive {
	const archiveSha256 = sha256Buffer(archive);
	const zipEntries = readStoreZipArchive(archive);
	const payloadMap = zipEntriesToMap(zipEntries);
	if (!payloadMap.has("manifest.json")) {
		throw new Error("manifest.json missing");
	}
	const allEntries: ExportArchiveEntry[] = [...zipEntries.map((e) => ({ path: e.path, content: e.data }))];
	const manifest = extractManifestFromArchiveEntries(allEntries);
	assertRestoreManifest(manifest);

	const payloadPaths = zipEntries.filter((e) => e.path !== "manifest.json").map((e) => e.path);
	const manifestPaths = manifest.files.map((f) => f.path);
	const extra = payloadPaths.filter((p) => !manifestPaths.includes(p));
	if (extra.length > 0) {
		throw new Error(`non-manifest payload files: ${extra.join(",")}`);
	}

	const payloadEntries: ExportArchiveEntry[] = manifest.files.map((f) => {
		const data = payloadMap.get(f.path);
		if (!data) {
			throw new Error(`missing payload: ${f.path}`);
		}
		return { path: f.path, content: data };
	});
	validateManifestPayloadConsistency(manifest, payloadEntries);

	const payload: RestorePayloadFile[] = payloadEntries.map((e) => ({
		path: e.path,
		content: typeof e.content === "string" ? Buffer.from(e.content, "utf8") : e.content,
	}));

	return { archiveSha256, manifest, payload, payloadMap };
}

export { REQUIRED_BACKUP_PATHS };
