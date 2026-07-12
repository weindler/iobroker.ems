"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stableJsonStringify = exports.validateManifest = exports.assertJsonSerializable = exports.isSecretKey = void 0;
const types_1 = require("./types");
const SECRET_KEY_RE = /(password|passwd|token|access_token|refresh_token|secret|api_key|authorization|cookie|private_key|client_secret)/i;
function isSecretKey(key) {
    return SECRET_KEY_RE.test(key);
}
exports.isSecretKey = isSecretKey;
function assertJsonSerializable(value, path = "root") {
    if (value === undefined) {
        throw new Error(`undefined not allowed at ${path}`);
    }
    if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
        if (typeof value === "string" && value.length > 512_000) {
            throw new Error(`string too long at ${path}`);
        }
        return;
    }
    if (Array.isArray(value)) {
        if (value.length > 10_000) {
            throw new Error(`array too long at ${path}`);
        }
        value.forEach((v, i) => assertJsonSerializable(v, `${path}[${i}]`));
        return;
    }
    if (typeof value === "object") {
        const seen = new Set();
        const walk = (obj, p) => {
            if (seen.has(obj)) {
                throw new Error(`cycle at ${p}`);
            }
            seen.add(obj);
            for (const [k, v] of Object.entries(obj)) {
                if (isSecretKey(k)) {
                    throw new Error(`forbidden secret key at ${p}.${k}`);
                }
                assertJsonSerializable(v, `${p}.${k}`);
            }
        };
        walk(value, path);
        return;
    }
    throw new Error(`non-serializable type at ${path}`);
}
exports.assertJsonSerializable = assertJsonSerializable;
function validateManifest(manifest, kind) {
    if (manifest.format !== types_1.EXPORT_FORMAT) {
        throw new Error("invalid manifest format");
    }
    if (manifest.schema_version !== types_1.EXPORT_SCHEMA_VERSION) {
        throw new Error("unsupported schema_version");
    }
    if (manifest.kind !== kind) {
        throw new Error("manifest kind mismatch");
    }
    if (!manifest.export_id || !manifest.created_at) {
        throw new Error("manifest missing export_id or created_at");
    }
    if (!manifest.safety.restore_must_start_dryrun || manifest.safety.automatic_live_resume_allowed) {
        throw new Error("invalid safety block");
    }
    if (manifest.privacy.sanitizer_version !== types_1.SANITIZER_VERSION) {
        throw new Error("unsupported sanitizer_version");
    }
    if (kind === "support" && !manifest.privacy.support_bundle_anonymized) {
        throw new Error("support manifest must be anonymized");
    }
    if (kind === "support") {
        if (manifest.restore?.supported !== false) {
            throw new Error("support manifest must declare restore.supported=false");
        }
    }
    if (kind === "backup" && manifest.restore?.supported === true) {
        throw new Error("backup manifest must not claim restore via support kind");
    }
    if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
        throw new Error("manifest files empty");
    }
    for (const f of manifest.files) {
        if (!f.path || !f.sha256 || f.size_bytes < 0) {
            throw new Error(`invalid manifest file entry: ${f.path}`);
        }
    }
}
exports.validateManifest = validateManifest;
function stableJsonStringify(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
}
exports.stableJsonStringify = stableJsonStringify;
