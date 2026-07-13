"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeSourceRevision = exports.utf8ByteLength = exports.computeInputRevision = exports.canonicalSnapshotJson = exports.canonicalSnapshotPayload = exports.sortKeysDeep = void 0;
const node_crypto_1 = require("node:crypto");
const constants_1 = require("./constants");
function isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
/** Deterministic key order for JSON serialization. */
function sortKeysDeep(value) {
    if (Array.isArray(value)) {
        return value.map(sortKeysDeep);
    }
    if (!isPlainObject(value)) {
        return value;
    }
    const out = {};
    for (const key of Object.keys(value).sort()) {
        if (constants_1.INPUT_REVISION_EXCLUDED_KEYS.includes(key)) {
            continue;
        }
        out[key] = sortKeysDeep(value[key]);
    }
    return out;
}
exports.sortKeysDeep = sortKeysDeep;
function canonicalSnapshotPayload(snapshot) {
    const clone = JSON.parse(JSON.stringify(snapshot));
    for (const key of constants_1.INPUT_REVISION_EXCLUDED_KEYS) {
        delete clone[key];
    }
    return sortKeysDeep(clone);
}
exports.canonicalSnapshotPayload = canonicalSnapshotPayload;
function canonicalSnapshotJson(snapshot) {
    return JSON.stringify(canonicalSnapshotPayload(snapshot));
}
exports.canonicalSnapshotJson = canonicalSnapshotJson;
function computeInputRevision(snapshot) {
    return (0, node_crypto_1.createHash)("sha256").update(canonicalSnapshotJson(snapshot)).digest("hex");
}
exports.computeInputRevision = computeInputRevision;
function utf8ByteLength(text) {
    return Buffer.byteLength(text, "utf8");
}
exports.utf8ByteLength = utf8ByteLength;
/** Optional aggregate fingerprint of upstream source revisions (policy, learning timestamps). */
function computeSourceRevision(parts) {
    const payload = parts.filter((p) => p != null && String(p).trim() !== "").join("|");
    if (!payload)
        return "";
    return (0, node_crypto_1.createHash)("sha256").update(payload).digest("hex").slice(0, 16);
}
exports.computeSourceRevision = computeSourceRevision;
