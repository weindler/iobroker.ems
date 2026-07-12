"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractManifestFromArchiveEntries = exports.validateManifestPayloadConsistency = exports.assertUniqueArchivePaths = exports.assertSafeArchivePath = void 0;
const checksum_1 = require("./checksum");
/** Archivpfad muss relativ, ohne Traversal und ohne Nullbyte sein. */
function assertSafeArchivePath(archivePath) {
    if (archivePath.includes("\\")) {
        throw new Error("backslash in archive path");
    }
    const p = archivePath.replace(/\\/g, "/");
    if (!p || p.includes("\0")) {
        throw new Error("invalid archive path");
    }
    if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) {
        throw new Error("absolute archive path forbidden");
    }
    if (p.includes("../") || p.startsWith("../") || p.endsWith("/..") || p.includes("/../")) {
        throw new Error("path traversal in archive path");
    }
}
exports.assertSafeArchivePath = assertSafeArchivePath;
function assertUniqueArchivePaths(entries) {
    const seen = new Set();
    for (const e of entries) {
        assertSafeArchivePath(e.path);
        const p = e.path.replace(/\\/g, "/");
        if (seen.has(p)) {
            throw new Error(`duplicate archive path: ${p}`);
        }
        seen.add(p);
    }
}
exports.assertUniqueArchivePaths = assertUniqueArchivePaths;
/**
 * Manifest-Regeln:
 * - manifest.json steht nicht in files[]
 * - files[] listet exakt alle Payload-Dateien (ohne manifest.json)
 * - Pfad, Größe und SHA-256 stimmen mit den Payload-Einträgen überein
 */
function validateManifestPayloadConsistency(manifest, payloadEntries) {
    if (manifest.files.some((f) => f.path === "manifest.json")) {
        throw new Error("manifest.json must not appear in files[]");
    }
    const payloadPaths = payloadEntries.map((e) => {
        assertSafeArchivePath(e.path);
        return e.path.replace(/\\/g, "/");
    });
    const manifestPaths = manifest.files.map((f) => f.path);
    if (payloadPaths.length !== manifestPaths.length) {
        throw new Error("manifest file count mismatch");
    }
    const sortedPayload = [...payloadPaths].sort();
    const sortedManifest = [...manifestPaths].sort();
    for (let i = 0; i < sortedPayload.length; i++) {
        if (sortedPayload[i] !== sortedManifest[i]) {
            throw new Error(`manifest path mismatch: ${sortedManifest[i]} vs ${sortedPayload[i]}`);
        }
    }
    for (const entry of payloadEntries) {
        const p = entry.path.replace(/\\/g, "/");
        const buf = typeof entry.content === "string" ? Buffer.from(entry.content, "utf8") : entry.content;
        const mf = manifest.files.find((f) => f.path === p);
        if (!mf) {
            throw new Error(`manifest missing entry for ${p}`);
        }
        if (mf.size_bytes !== buf.length) {
            throw new Error(`size mismatch for ${p}`);
        }
        if (mf.sha256 !== (0, checksum_1.sha256Buffer)(buf)) {
            throw new Error(`sha256 mismatch for ${p}`);
        }
    }
}
exports.validateManifestPayloadConsistency = validateManifestPayloadConsistency;
function extractManifestFromArchiveEntries(allEntries) {
    const manifestEntry = allEntries.find((e) => e.path.replace(/\\/g, "/") === "manifest.json");
    if (!manifestEntry) {
        throw new Error("manifest.json missing from archive");
    }
    const text = typeof manifestEntry.content === "string" ? manifestEntry.content : manifestEntry.content.toString("utf8");
    return JSON.parse(text);
}
exports.extractManifestFromArchiveEntries = extractManifestFromArchiveEntries;
