import * as fs from "node:fs/promises";
import * as path from "node:path";
import { learningDataPath } from "../learning/data_dir";
import { resolveEmsPaths } from "../backup_integration/paths";
import { buildZipArchive } from "./archive";
import { sha256Buffer } from "./checksum";
import {
	collectAddonDiagnostics,
	collectBootstrapDiagnostics,
	collectHealthDiagnostics,
	collectMappingDiagnostics,
	collectSelectedStateSnapshot,
	collectSystemSummary,
} from "./collect_diagnostics";
import { assertSupportBundleClean, sanitizeForSupport } from "./sanitize";
import {
	collectAdapterConfigExport,
	collectMappingsExport,
	collectPoliciesExport,
	collectVehicleProfilesExport,
} from "./collect_config";
import {
	collectLearningPersistence,
	collectSelectedStateData,
	collectVehicleSupportPersistence,
	assertBackupRestoreExclusion,
	isTransientStateId,
} from "./collect_persistence";
import { inventoryExportJson } from "./inventory";
import { assertWithinLimit, EXPORT_LIMITS } from "./limits";
import { buildExportManifest, buildManifestFileEntries, exportFileName } from "./manifest";
import { validateManifestPayloadConsistency } from "./manifest_validate";
import {
	backupDir,
	cleanupTempExports,
	enforceRetention,
	resolveExportPath,
	supportDir,
	writeAtomicArchive,
} from "./retention";
import { assertJsonSerializable, stableJsonStringify, validateManifest } from "./schema";
import type { ExportArchiveEntry, ExportKind, ExportResult, ExportServiceHost } from "./types";

import {
	tryAcquireOperationLock,
	releaseOperationLock,
	isOperationRunning,
	resetOperationLockForTest,
} from "./operation_lock";

export function isExportRunning(): boolean {
	return isOperationRunning();
}

export function resetExportMutexForTest(): void {
	resetOperationLockForTest();
}

function instanceDataDir(host: ExportServiceHost): string {
	if (typeof host.getAbsoluteInstanceDataDir === "function") {
		return host.getAbsoluteInstanceDataDir();
	}
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const utils = require("@iobroker/adapter-core") as typeof import("@iobroker/adapter-core");
	return utils.getAbsoluteInstanceDataDir(host as ioBroker.Adapter);
}

function adapterVersion(host: ExportServiceHost): string {
	return String(host.common?.version ?? "0.0.0");
}

function enforcePayloadLimits(entries: ExportArchiveEntry[], kind: ExportKind): void {
	assertWithinLimit(entries.length, EXPORT_LIMITS.MAX_ARCHIVE_PAYLOAD_FILES, "archive file count");
	let total = 0;
	for (const e of entries) {
		const len = typeof e.content === "string" ? Buffer.byteLength(e.content, "utf8") : e.content.length;
		assertWithinLimit(len, EXPORT_LIMITS.MAX_SINGLE_FILE_BYTES, `file ${e.path}`);
		total += len;
	}
	assertWithinLimit(total, EXPORT_LIMITS.MAX_UNCOMPRESSED_ARCHIVE_BYTES, "uncompressed archive size");
}

async function buildBackupEntries(host: ExportServiceHost): Promise<ExportArchiveEntry[]> {
	const adapterJson = collectAdapterConfigExport(host.config);
	const mappingsJson = collectMappingsExport(host.config);
	const vehicleProfilesJson = collectVehicleProfilesExport(host.config);
	const policiesJson = collectPoliciesExport(host.config);
	const learningJson = await collectLearningPersistence(host);
	const selectedStateData = await collectSelectedStateData(host);

	assertJsonSerializable(adapterJson, "config/adapter.json");
	assertJsonSerializable(mappingsJson, "config/mappings.json");
	assertJsonSerializable(vehicleProfilesJson, "config/vehicle_profiles.json");
	assertJsonSerializable(policiesJson, "config/policies.json");
	assertJsonSerializable(learningJson, "persistence/learning.json");
	assertJsonSerializable(selectedStateData, "persistence/selected_state_data.json");

	const entries: ExportArchiveEntry[] = [
		{ path: "config/adapter.json", content: stableJsonStringify(adapterJson) },
		{ path: "config/mappings.json", content: stableJsonStringify(mappingsJson) },
		{ path: "config/vehicle_profiles.json", content: stableJsonStringify(vehicleProfilesJson) },
		{ path: "config/policies.json", content: stableJsonStringify(policiesJson) },
		{ path: "persistence/learning.json", content: stableJsonStringify(learningJson) },
		{ path: "persistence/user_settings.json", content: stableJsonStringify({}) },
		{ path: "persistence/selected_state_data.json", content: stableJsonStringify(selectedStateData) },
		{ path: "metadata/inventory.json", content: stableJsonStringify(inventoryExportJson()) },
	];

	assertBackupRestoreExclusion(
		entries.map((e) => ({
			path: e.path,
			content: typeof e.content === "string" ? e.content : e.content.toString("utf8"),
		})),
	);
	void isTransientStateId;
	return entries;
}

async function buildSupportEntries(
	host: ExportServiceHost,
	collectSupportExtras: (host: ExportServiceHost) => Promise<ExportArchiveEntry[]>,
): Promise<ExportArchiveEntry[]> {
	const system = sanitizeForSupport(collectSystemSummary(host));
	const adapterSummary = sanitizeForSupport(collectAdapterConfigExport(host.config));
	const modules = sanitizeForSupport({
		addons: await collectAddonDiagnostics(host),
	});
	const sanitizedConfig = sanitizeForSupport(collectMappingsExport(host.config));
	const states = sanitizeForSupport(await collectSelectedStateSnapshot(host));
	const health = sanitizeForSupport(await collectHealthDiagnostics(host));
	const mappings = sanitizeForSupport(await collectMappingDiagnostics(host.config));
	const bootstrap = sanitizeForSupport(await collectBootstrapDiagnostics());
	const addons = sanitizeForSupport(await collectAddonDiagnostics(host));
	const vehicleSupport = sanitizeForSupport(await collectVehicleSupportPersistence(host));

	const entries: ExportArchiveEntry[] = [
		{ path: "summary/system.json", content: stableJsonStringify(system) },
		{ path: "summary/adapter.json", content: stableJsonStringify(adapterSummary) },
		{ path: "summary/modules.json", content: stableJsonStringify(modules) },
		{ path: "config/sanitized_config.json", content: stableJsonStringify(sanitizedConfig) },
		{ path: "states/selected_snapshot.json", content: stableJsonStringify(states) },
		{ path: "diagnostics/health.json", content: stableJsonStringify(health) },
		{ path: "diagnostics/mappings.json", content: stableJsonStringify(mappings) },
		{ path: "diagnostics/bootstrap.json", content: stableJsonStringify(bootstrap) },
		{ path: "diagnostics/addons.json", content: stableJsonStringify(addons) },
		{ path: "diagnostics/vehicle_persistence.json", content: stableJsonStringify(vehicleSupport) },
		...(await collectSupportExtras(host)),
	];

	const stringEntries = entries.map((e) => ({
		path: e.path,
		content: typeof e.content === "string" ? e.content : e.content.toString("utf8"),
	}));
	// collect → sanitize → serialize → final secret scan
	assertSupportBundleClean(stringEntries);
	for (const e of stringEntries) {
		assertJsonSerializable(JSON.parse(e.content), e.path);
	}
	return stringEntries.map((e) => ({ path: e.path, content: e.content }));
}

export async function runExport(
	host: ExportServiceHost,
	kind: ExportKind,
	collectSupportExtras?: (host: ExportServiceHost) => Promise<ExportArchiveEntry[]>,
): Promise<ExportResult> {
	if (isOperationRunning()) {
		return { ok: false, error: "operation_already_running" };
	}
	const lock = tryAcquireOperationLock(kind === "backup" ? "backup_export" : "support_export");
	if (!lock.ok) {
		return { ok: false, error: lock.error };
	}
	const layout = resolveEmsPaths(host);
	const workDir = path.join(layout.runtimeTempDir, `.work-${process.pid}`);
	try {
		await cleanupTempExports(host);
		await fs.mkdir(workDir, { recursive: true });

		const createdAt = new Date().toISOString();
		const version = adapterVersion(host);
		const baseEntries =
			kind === "backup"
				? await buildBackupEntries(host)
				: await buildSupportEntries(host, collectSupportExtras ?? (async () => []));

		enforcePayloadLimits(baseEntries, kind);

		const fileEntries = buildManifestFileEntries(baseEntries);
		const manifest = buildExportManifest({
			kind,
			adapterVersion: version,
			instance: parseInstance(host.namespace),
			namespace: host.namespace,
			files: fileEntries,
			createdAt,
		});
		validateManifest(manifest, kind);
		validateManifestPayloadConsistency(manifest, baseEntries);

		const allEntries: ExportArchiveEntry[] = [
			...baseEntries,
			{ path: "manifest.json", content: stableJsonStringify(manifest) },
		];
		const archive = buildZipArchive(allEntries);
		const maxArchive =
			kind === "backup" ? EXPORT_LIMITS.MAX_BACKUP_ARCHIVE_BYTES : EXPORT_LIMITS.MAX_SUPPORT_ARCHIVE_BYTES;
		assertWithinLimit(archive.length, maxArchive, "finished archive size");

		const fileName = exportFileName(kind, version, createdAt);
		const targetDir = kind === "backup" ? backupDir(host) : supportDir(host);
		const targetPath = resolveExportPath(targetDir, fileName);
		await writeAtomicArchive(targetPath, archive);

		await enforceRetention(host);

		const sha256 = sha256Buffer(archive);
		return {
			ok: true,
			kind,
			filePath: targetPath,
			fileName,
			sizeBytes: archive.length,
			sha256,
			exportId: manifest.export_id,
			createdAt,
		};
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		host.log.error(`Export (${kind}) failed: ${msg}`);
		return { ok: false, error: msg };
	} finally {
		releaseOperationLock();
		await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
	}
}

function parseInstance(namespace: string): number {
	const m = namespace.match(/\.(\d+)$/);
	return m ? Number(m[1]) : 0;
}

export async function runBackupExport(host: ExportServiceHost): Promise<ExportResult> {
	return runExport(host, "backup");
}

export async function runSupportExport(
	host: ExportServiceHost,
	collectSupportExtras: (host: ExportServiceHost) => Promise<ExportArchiveEntry[]>,
): Promise<ExportResult> {
	return runExport(host, "support", collectSupportExtras);
}

export function getExportDataDir(host: ExportServiceHost): string {
	return learningDataPath(host as ioBroker.Adapter);
}
