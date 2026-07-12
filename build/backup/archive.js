"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readZipEntryData = exports.readZipEntryNames = exports.buildZipArchive = void 0;
const manifest_validate_1 = require("./manifest_validate");
/** CRC32 für ZIP (IEEE). */
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
function dosTime(date) {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    const hours = date.getUTCHours();
    const minutes = date.getUTCMinutes();
    const seconds = Math.floor(date.getUTCSeconds() / 2);
    return {
        time: (hours << 11) | (minutes << 5) | seconds,
        date: ((year - 1980) << 9) | (month << 5) | day,
    };
}
/**
 * Erzeugt ein ZIP-Archiv (Store, ohne Kompression) — kompatibel mit .emsbackup/.emssupport.
 * Kein ZIP64 — Größenlimits in limits.ts erzwingen kompatible Archive.
 */
function buildZipArchive(entries) {
    (0, manifest_validate_1.assertUniqueArchivePaths)(entries);
    const now = new Date();
    const { time, date } = dosTime(now);
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    for (const entry of entries) {
        const name = entry.path.replace(/\\/g, "/");
        const nameBuf = Buffer.from(name, "utf8");
        const data = typeof entry.content === "string" ? Buffer.from(entry.content, "utf8") : entry.content;
        const crc = crc32(data);
        const local = Buffer.alloc(30 + nameBuf.length);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0, 6);
        local.writeUInt16LE(0, 8);
        local.writeUInt16LE(time, 10);
        local.writeUInt16LE(date, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28);
        nameBuf.copy(local, 30);
        localParts.push(local, data);
        const central = Buffer.alloc(46 + nameBuf.length);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0, 8);
        central.writeUInt16LE(0, 10);
        central.writeUInt16LE(time, 12);
        central.writeUInt16LE(date, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(data.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt16LE(0, 30);
        central.writeUInt16LE(0, 32);
        central.writeUInt16LE(0, 34);
        central.writeUInt16LE(0, 36);
        central.writeUInt32LE(0, 38);
        central.writeUInt32LE(offset, 42);
        nameBuf.copy(central, 46);
        centralParts.push(central);
        offset += local.length + data.length;
    }
    const centralDir = Buffer.concat(centralParts);
    const localData = Buffer.concat(localParts);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralDir.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);
    return Buffer.concat([localData, centralDir, end]);
}
exports.buildZipArchive = buildZipArchive;
function readZipEntryNames(archive) {
    const names = [];
    let pos = 0;
    while (pos + 30 <= archive.length) {
        const sig = archive.readUInt32LE(pos);
        if (sig === 0x06054b50)
            break;
        if (sig !== 0x04034b50)
            break;
        const nameLen = archive.readUInt16LE(pos + 26);
        const extraLen = archive.readUInt16LE(pos + 28);
        const name = archive.subarray(pos + 30, pos + 30 + nameLen).toString("utf8");
        names.push(name);
        const compSize = archive.readUInt32LE(pos + 18);
        pos += 30 + nameLen + extraLen + compSize;
    }
    return names;
}
exports.readZipEntryNames = readZipEntryNames;
function readZipEntryData(archive, entryName) {
    let pos = 0;
    const target = entryName.replace(/\\/g, "/");
    while (pos + 30 <= archive.length) {
        const sig = archive.readUInt32LE(pos);
        if (sig === 0x06054b50)
            break;
        if (sig !== 0x04034b50)
            break;
        const nameLen = archive.readUInt16LE(pos + 26);
        const extraLen = archive.readUInt16LE(pos + 28);
        const name = archive.subarray(pos + 30, pos + 30 + nameLen).toString("utf8");
        const compSize = archive.readUInt32LE(pos + 18);
        const dataStart = pos + 30 + nameLen + extraLen;
        if (name === target) {
            return archive.subarray(dataStart, dataStart + compSize);
        }
        pos = dataStart + compSize;
    }
    return null;
}
exports.readZipEntryData = readZipEntryData;
