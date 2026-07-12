"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REQUIRED_BACKUP_PATHS = exports.validateRestoreArchiveBuffer = exports.assertRestoreManifest = void 0;
const checksum_1 = require("../backup/checksum");
const types_1 = require("../backup/types");
const schema_1 = require("../backup/schema");
const manifest_validate_1 = require("../backup/manifest_validate");
const zip_reader_1 = require("./zip_reader");
const REQUIRED_BACKUP_PATHS = [
    "config/adapter.json",
    "config/mappings.json",
    "config/vehicle_profiles.json",
    "config/policies.json",
    "persistence/learning.json",
    "persistence/user_settings.json",
    "persistence/selected_state_data.json",
    "metadata/inventory.json",
];
exports.REQUIRED_BACKUP_PATHS = REQUIRED_BACKUP_PATHS;
function assertRestoreManifest(manifest) {
    (0, schema_1.validateManifest)(manifest, "backup");
    if (manifest.format !== types_1.EXPORT_FORMAT) {
        throw new Error("invalid manifest format");
    }
    if (manifest.schema_version !== types_1.EXPORT_SCHEMA_VERSION) {
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
exports.assertRestoreManifest = assertRestoreManifest;
function validateRestoreArchiveBuffer(archive) {
    const archiveSha256 = (0, checksum_1.sha256Buffer)(archive);
    const zipEntries = (0, zip_reader_1.readStoreZipArchive)(archive);
    const payloadMap = (0, zip_reader_1.zipEntriesToMap)(zipEntries);
    if (!payloadMap.has("manifest.json")) {
        throw new Error("manifest.json missing");
    }
    const allEntries = [...zipEntries.map((e) => ({ path: e.path, content: e.data }))];
    const manifest = (0, manifest_validate_1.extractManifestFromArchiveEntries)(allEntries);
    assertRestoreManifest(manifest);
    const payloadPaths = zipEntries.filter((e) => e.path !== "manifest.json").map((e) => e.path);
    const manifestPaths = manifest.files.map((f) => f.path);
    const extra = payloadPaths.filter((p) => !manifestPaths.includes(p));
    if (extra.length > 0) {
        throw new Error(`non-manifest payload files: ${extra.join(",")}`);
    }
    const payloadEntries = manifest.files.map((f) => {
        const data = payloadMap.get(f.path);
        if (!data) {
            throw new Error(`missing payload: ${f.path}`);
        }
        return { path: f.path, content: data };
    });
    (0, manifest_validate_1.validateManifestPayloadConsistency)(manifest, payloadEntries);
    const payload = payloadEntries.map((e) => ({
        path: e.path,
        content: typeof e.content === "string" ? Buffer.from(e.content, "utf8") : e.content,
    }));
    return { archiveSha256, manifest, payload, payloadMap };
}
exports.validateRestoreArchiveBuffer = validateRestoreArchiveBuffer;
