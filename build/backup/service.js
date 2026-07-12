"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getExportDataDir = exports.runSupportExport = exports.runBackupExport = exports.runExport = exports.resetExportMutexForTest = exports.isExportRunning = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const data_dir_1 = require("../learning/data_dir");
const paths_1 = require("../backup_integration/paths");
const archive_1 = require("./archive");
const checksum_1 = require("./checksum");
const collect_diagnostics_1 = require("./collect_diagnostics");
const sanitize_1 = require("./sanitize");
const collect_config_1 = require("./collect_config");
const collect_persistence_1 = require("./collect_persistence");
const inventory_1 = require("./inventory");
const limits_1 = require("./limits");
const manifest_1 = require("./manifest");
const manifest_validate_1 = require("./manifest_validate");
const retention_1 = require("./retention");
const schema_1 = require("./schema");
const operation_lock_1 = require("./operation_lock");
function isExportRunning() {
    return (0, operation_lock_1.isOperationRunning)();
}
exports.isExportRunning = isExportRunning;
function resetExportMutexForTest() {
    (0, operation_lock_1.resetOperationLockForTest)();
}
exports.resetExportMutexForTest = resetExportMutexForTest;
function instanceDataDir(host) {
    if (typeof host.getAbsoluteInstanceDataDir === "function") {
        return host.getAbsoluteInstanceDataDir();
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const utils = require("@iobroker/adapter-core");
    return utils.getAbsoluteInstanceDataDir(host);
}
function adapterVersion(host) {
    return String(host.common?.version ?? "0.0.0");
}
function enforcePayloadLimits(entries, kind) {
    (0, limits_1.assertWithinLimit)(entries.length, limits_1.EXPORT_LIMITS.MAX_ARCHIVE_PAYLOAD_FILES, "archive file count");
    let total = 0;
    for (const e of entries) {
        const len = typeof e.content === "string" ? Buffer.byteLength(e.content, "utf8") : e.content.length;
        (0, limits_1.assertWithinLimit)(len, limits_1.EXPORT_LIMITS.MAX_SINGLE_FILE_BYTES, `file ${e.path}`);
        total += len;
    }
    (0, limits_1.assertWithinLimit)(total, limits_1.EXPORT_LIMITS.MAX_UNCOMPRESSED_ARCHIVE_BYTES, "uncompressed archive size");
}
async function buildBackupEntries(host) {
    const adapterJson = (0, collect_config_1.collectAdapterConfigExport)(host.config);
    const mappingsJson = (0, collect_config_1.collectMappingsExport)(host.config);
    const vehicleProfilesJson = (0, collect_config_1.collectVehicleProfilesExport)(host.config);
    const policiesJson = (0, collect_config_1.collectPoliciesExport)(host.config);
    const learningJson = await (0, collect_persistence_1.collectLearningPersistence)(host);
    const selectedStateData = await (0, collect_persistence_1.collectSelectedStateData)(host);
    (0, schema_1.assertJsonSerializable)(adapterJson, "config/adapter.json");
    (0, schema_1.assertJsonSerializable)(mappingsJson, "config/mappings.json");
    (0, schema_1.assertJsonSerializable)(vehicleProfilesJson, "config/vehicle_profiles.json");
    (0, schema_1.assertJsonSerializable)(policiesJson, "config/policies.json");
    (0, schema_1.assertJsonSerializable)(learningJson, "persistence/learning.json");
    (0, schema_1.assertJsonSerializable)(selectedStateData, "persistence/selected_state_data.json");
    const entries = [
        { path: "config/adapter.json", content: (0, schema_1.stableJsonStringify)(adapterJson) },
        { path: "config/mappings.json", content: (0, schema_1.stableJsonStringify)(mappingsJson) },
        { path: "config/vehicle_profiles.json", content: (0, schema_1.stableJsonStringify)(vehicleProfilesJson) },
        { path: "config/policies.json", content: (0, schema_1.stableJsonStringify)(policiesJson) },
        { path: "persistence/learning.json", content: (0, schema_1.stableJsonStringify)(learningJson) },
        { path: "persistence/user_settings.json", content: (0, schema_1.stableJsonStringify)({}) },
        { path: "persistence/selected_state_data.json", content: (0, schema_1.stableJsonStringify)(selectedStateData) },
        { path: "metadata/inventory.json", content: (0, schema_1.stableJsonStringify)((0, inventory_1.inventoryExportJson)()) },
    ];
    (0, collect_persistence_1.assertBackupRestoreExclusion)(entries.map((e) => ({
        path: e.path,
        content: typeof e.content === "string" ? e.content : e.content.toString("utf8"),
    })));
    void collect_persistence_1.isTransientStateId;
    return entries;
}
async function buildSupportEntries(host, collectSupportExtras) {
    const system = (0, sanitize_1.sanitizeForSupport)((0, collect_diagnostics_1.collectSystemSummary)(host));
    const adapterSummary = (0, sanitize_1.sanitizeForSupport)((0, collect_config_1.collectAdapterConfigExport)(host.config));
    const modules = (0, sanitize_1.sanitizeForSupport)({
        addons: await (0, collect_diagnostics_1.collectAddonDiagnostics)(host),
    });
    const sanitizedConfig = (0, sanitize_1.sanitizeForSupport)((0, collect_config_1.collectMappingsExport)(host.config));
    const states = (0, sanitize_1.sanitizeForSupport)(await (0, collect_diagnostics_1.collectSelectedStateSnapshot)(host));
    const health = (0, sanitize_1.sanitizeForSupport)(await (0, collect_diagnostics_1.collectHealthDiagnostics)(host));
    const mappings = (0, sanitize_1.sanitizeForSupport)(await (0, collect_diagnostics_1.collectMappingDiagnostics)(host.config));
    const bootstrap = (0, sanitize_1.sanitizeForSupport)(await (0, collect_diagnostics_1.collectBootstrapDiagnostics)());
    const addons = (0, sanitize_1.sanitizeForSupport)(await (0, collect_diagnostics_1.collectAddonDiagnostics)(host));
    const vehicleSupport = (0, sanitize_1.sanitizeForSupport)(await (0, collect_persistence_1.collectVehicleSupportPersistence)(host));
    const entries = [
        { path: "summary/system.json", content: (0, schema_1.stableJsonStringify)(system) },
        { path: "summary/adapter.json", content: (0, schema_1.stableJsonStringify)(adapterSummary) },
        { path: "summary/modules.json", content: (0, schema_1.stableJsonStringify)(modules) },
        { path: "config/sanitized_config.json", content: (0, schema_1.stableJsonStringify)(sanitizedConfig) },
        { path: "states/selected_snapshot.json", content: (0, schema_1.stableJsonStringify)(states) },
        { path: "diagnostics/health.json", content: (0, schema_1.stableJsonStringify)(health) },
        { path: "diagnostics/mappings.json", content: (0, schema_1.stableJsonStringify)(mappings) },
        { path: "diagnostics/bootstrap.json", content: (0, schema_1.stableJsonStringify)(bootstrap) },
        { path: "diagnostics/addons.json", content: (0, schema_1.stableJsonStringify)(addons) },
        { path: "diagnostics/vehicle_persistence.json", content: (0, schema_1.stableJsonStringify)(vehicleSupport) },
        ...(await collectSupportExtras(host)),
    ];
    const stringEntries = entries.map((e) => ({
        path: e.path,
        content: typeof e.content === "string" ? e.content : e.content.toString("utf8"),
    }));
    // collect → sanitize → serialize → final secret scan
    (0, sanitize_1.assertSupportBundleClean)(stringEntries);
    for (const e of stringEntries) {
        (0, schema_1.assertJsonSerializable)(JSON.parse(e.content), e.path);
    }
    return stringEntries.map((e) => ({ path: e.path, content: e.content }));
}
async function runExport(host, kind, collectSupportExtras) {
    if ((0, operation_lock_1.isOperationRunning)()) {
        return { ok: false, error: "operation_already_running" };
    }
    const lock = (0, operation_lock_1.tryAcquireOperationLock)(kind === "backup" ? "backup_export" : "support_export");
    if (!lock.ok) {
        return { ok: false, error: lock.error };
    }
    const layout = (0, paths_1.resolveEmsPaths)(host);
    const workDir = path.join(layout.runtimeTempDir, `.work-${process.pid}`);
    try {
        await (0, retention_1.cleanupTempExports)(host);
        await fs.mkdir(workDir, { recursive: true });
        const createdAt = new Date().toISOString();
        const version = adapterVersion(host);
        const baseEntries = kind === "backup"
            ? await buildBackupEntries(host)
            : await buildSupportEntries(host, collectSupportExtras ?? (async () => []));
        enforcePayloadLimits(baseEntries, kind);
        const fileEntries = (0, manifest_1.buildManifestFileEntries)(baseEntries);
        const manifest = (0, manifest_1.buildExportManifest)({
            kind,
            adapterVersion: version,
            instance: parseInstance(host.namespace),
            namespace: host.namespace,
            files: fileEntries,
            createdAt,
        });
        (0, schema_1.validateManifest)(manifest, kind);
        (0, manifest_validate_1.validateManifestPayloadConsistency)(manifest, baseEntries);
        const allEntries = [
            ...baseEntries,
            { path: "manifest.json", content: (0, schema_1.stableJsonStringify)(manifest) },
        ];
        const archive = (0, archive_1.buildZipArchive)(allEntries);
        const maxArchive = kind === "backup" ? limits_1.EXPORT_LIMITS.MAX_BACKUP_ARCHIVE_BYTES : limits_1.EXPORT_LIMITS.MAX_SUPPORT_ARCHIVE_BYTES;
        (0, limits_1.assertWithinLimit)(archive.length, maxArchive, "finished archive size");
        const fileName = (0, manifest_1.exportFileName)(kind, version, createdAt);
        const targetDir = kind === "backup" ? (0, retention_1.backupDir)(host) : (0, retention_1.supportDir)(host);
        const targetPath = (0, retention_1.resolveExportPath)(targetDir, fileName);
        await (0, retention_1.writeAtomicArchive)(targetPath, archive);
        await (0, retention_1.enforceRetention)(host);
        const sha256 = (0, checksum_1.sha256Buffer)(archive);
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
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        host.log.error(`Export (${kind}) failed: ${msg}`);
        return { ok: false, error: msg };
    }
    finally {
        (0, operation_lock_1.releaseOperationLock)();
        await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
}
exports.runExport = runExport;
function parseInstance(namespace) {
    const m = namespace.match(/\.(\d+)$/);
    return m ? Number(m[1]) : 0;
}
async function runBackupExport(host) {
    return runExport(host, "backup");
}
exports.runBackupExport = runBackupExport;
async function runSupportExport(host, collectSupportExtras) {
    return runExport(host, "support", collectSupportExtras);
}
exports.runSupportExport = runSupportExport;
function getExportDataDir(host) {
    return (0, data_dir_1.learningDataPath)(host);
}
exports.getExportDataDir = getExportDataDir;
