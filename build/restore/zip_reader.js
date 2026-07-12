"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.zipCrc32 = exports.zipEntriesToMap = exports.readStoreZipArchive = void 0;
const manifest_validate_1 = require("../backup/manifest_validate");
const limits_1 = require("../backup/limits");
const limits_2 = require("../backup/limits");
const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOC = 0x06054b50;
const METHOD_STORE = 0;
function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        crc ^= buf[i];
        for (let j = 0; j < 8; j++) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}
exports.zipCrc32 = crc32;
function findEocd(archive) {
    for (let i = archive.length - 22; i >= Math.max(0, archive.length - 65557); i--) {
        if (archive.readUInt32LE(i) === SIG_EOC) {
            return i;
        }
    }
    return -1;
}
/**
 * Streng begrenzter Store-ZIP-Reader (kein ZIP64, kein unzip-Shell).
 */
function readStoreZipArchive(archive) {
    (0, limits_2.assertWithinLimit)(archive.length, limits_1.EXPORT_LIMITS.MAX_BACKUP_ARCHIVE_BYTES, "archive size");
    const eocdPos = findEocd(archive);
    if (eocdPos < 0) {
        throw new Error("invalid end of central directory");
    }
    const totalEntries = archive.readUInt16LE(eocdPos + 10);
    const centralSize = archive.readUInt32LE(eocdPos + 12);
    const centralOffset = archive.readUInt32LE(eocdPos + 16);
    if (archive.readUInt16LE(eocdPos + 4) !== 0 || archive.readUInt16LE(eocdPos + 6) !== 0) {
        throw new Error("zip64 not supported");
    }
    (0, limits_2.assertWithinLimit)(totalEntries, limits_1.EXPORT_LIMITS.MAX_ARCHIVE_PAYLOAD_FILES + 1, "zip entry count");
    if (centralOffset + centralSize > archive.length) {
        throw new Error("central directory out of bounds");
    }
    const entries = [];
    const seen = new Set();
    let pos = centralOffset;
    for (let i = 0; i < totalEntries; i++) {
        if (pos + 46 > archive.length || archive.readUInt32LE(pos) !== SIG_CENTRAL) {
            throw new Error("invalid central directory");
        }
        const method = archive.readUInt16LE(pos + 10);
        const nameLen = archive.readUInt16LE(pos + 28);
        const extraLen = archive.readUInt16LE(pos + 30);
        const commentLen = archive.readUInt16LE(pos + 32);
        const crc = archive.readUInt32LE(pos + 16);
        const compSize = archive.readUInt32LE(pos + 20);
        const uncompSize = archive.readUInt32LE(pos + 24);
        const localOffset = archive.readUInt32LE(pos + 42);
        if (method !== METHOD_STORE) {
            throw new Error("unsupported compression method");
        }
        if (compSize !== uncompSize || compSize > 0xffffffff || uncompSize > 0xffffffff) {
            throw new Error("zip64 size fields not supported");
        }
        const name = archive.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");
        (0, manifest_validate_1.assertSafeArchivePath)(name);
        if (name.endsWith("/")) {
            pos += 46 + nameLen + extraLen + commentLen;
            continue;
        }
        if (seen.has(name)) {
            throw new Error(`duplicate archive path: ${name}`);
        }
        seen.add(name);
        if (localOffset + 30 > archive.length || archive.readUInt32LE(localOffset) !== SIG_LOCAL) {
            throw new Error("invalid local header");
        }
        const localNameLen = archive.readUInt16LE(localOffset + 26);
        const localExtraLen = archive.readUInt16LE(localOffset + 28);
        const dataStart = localOffset + 30 + localNameLen + localExtraLen;
        if (dataStart + compSize > archive.length) {
            throw new Error("entry data out of bounds");
        }
        const data = archive.subarray(dataStart, dataStart + compSize);
        if (crc32(data) !== crc) {
            throw new Error(`crc mismatch for ${name}`);
        }
        entries.push({ path: name, data, crc });
        pos += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
}
exports.readStoreZipArchive = readStoreZipArchive;
function zipEntriesToMap(entries) {
    const map = new Map();
    for (const e of entries) {
        map.set(e.path.replace(/\\/g, "/"), e.data);
    }
    return map;
}
exports.zipEntriesToMap = zipEntriesToMap;
