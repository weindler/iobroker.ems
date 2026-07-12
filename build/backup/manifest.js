"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportFileName = exports.buildExportManifest = exports.buildManifestFileEntries = void 0;
const node_crypto_1 = require("node:crypto");
const types_1 = require("./types");
const checksum_1 = require("./checksum");
function buildManifestFileEntries(entries) {
    return entries.map((e) => {
        const buf = typeof e.content === "string" ? Buffer.from(e.content, "utf8") : e.content;
        return {
            path: e.path.replace(/\\/g, "/"),
            size_bytes: buf.length,
            sha256: (0, checksum_1.sha256Buffer)(buf),
        };
    });
}
exports.buildManifestFileEntries = buildManifestFileEntries;
function buildExportManifest(input) {
    return {
        format: types_1.EXPORT_FORMAT,
        schema_version: types_1.EXPORT_SCHEMA_VERSION,
        kind: input.kind,
        export_id: input.exportId ?? (0, node_crypto_1.randomUUID)(),
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
            sanitizer_version: types_1.SANITIZER_VERSION,
            support_bundle_anonymized: input.kind === "support",
        },
        restore: input.kind === "support" ? { supported: false } : undefined,
        files: input.files,
    };
}
exports.buildExportManifest = buildExportManifest;
function exportFileName(kind, adapterVersion, createdAt) {
    const safeVersion = adapterVersion.replace(/[^0-9.a-zA-Z-]/g, "_");
    const ts = createdAt.replace(/[:.]/g, "").replace("Z", "Z");
    const ext = kind === "backup" ? "emsbackup" : "emssupport";
    return `ems-light-${safeVersion}-${kind}-${ts}.${ext}`;
}
exports.exportFileName = exportFileName;
