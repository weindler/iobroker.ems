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
exports.readSupportFileBase64 = exports.writeRestoreUploadToInbox = exports.listRestoreFileOptions = exports.syncAdapterRestoreInboxToHost = exports.parseBackupFileStamp = exports.mirrorHostExportFile = exports.mirrorExportIntoAdapterFiles = exports.ensureAdapterFilesMeta = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const retention_1 = require("./retention");
const source_1 = require("../restore/source");
const ADAPTER_RESTORE_INBOX = "restore-inbox";
/** Meta-Objekt für Admin fileSelector / Download. */
async function ensureAdapterFilesMeta(host) {
    if (typeof host.setObjectNotExistsAsync !== "function")
        return;
    await host.setObjectNotExistsAsync(host.namespace, {
        type: "meta",
        common: {
            name: host.namespace,
            type: "meta.user",
        },
        native: {},
    });
}
exports.ensureAdapterFilesMeta = ensureAdapterFilesMeta;
/** Datei zusätzlich in die Adapter-File-DB legen (Admin-Download). */
async function mirrorExportIntoAdapterFiles(host, kind, fileName, data) {
    if (typeof host.writeFileAsync !== "function") {
        host.log?.warn?.("backup: writeFileAsync missing — Admin-Download-Spiegel übersprungen");
        return;
    }
    await ensureAdapterFilesMeta(host);
    const rel = `${kind}/${fileName}`;
    await host.writeFileAsync(host.namespace, rel, data);
    host.log?.info?.(`backup: mirrored ${rel} into adapter files for Admin download`);
}
exports.mirrorExportIntoAdapterFiles = mirrorExportIntoAdapterFiles;
async function mirrorHostExportFile(host, kind, fileName) {
    const dir = kind === "backup" ? (0, retention_1.backupDir)(host) : (0, retention_1.supportDir)(host);
    const full = path.join(dir, fileName);
    const data = await fs.readFile(full);
    await mirrorExportIntoAdapterFiles(host, kind, fileName, data);
}
exports.mirrorHostExportFile = mirrorHostExportFile;
/** Zeitstempel aus ems-light-…-backup-2026-07-19T095123951Z.emsbackup lesen. */
function parseBackupFileStamp(fileName) {
    const m = fileName.match(/(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})?Z/);
    if (!m)
        return null;
    const [, day, hh, mm, ss] = m;
    return {
        sortKey: `${day}T${hh}${mm}${ss}`,
        labelWhen: `${day} ${hh}:${mm}:${ss} UTC`,
    };
}
exports.parseBackupFileStamp = parseBackupFileStamp;
function formatRestoreOptionLabel(fileName, tag, newest) {
    const stamp = parseBackupFileStamp(fileName);
    const when = stamp?.labelWhen ?? fileName;
    const newestMark = newest ? " ★ NEUESTE" : "";
    return {
        value: fileName,
        label: `${when}${newestMark}`,
        description: `${tag} · ${fileName}`,
    };
}
/**
 * Admin-Uploads unter restore-inbox/ in die Host-Inbox spiegeln
 * (Restore liest nur Host-Pfade).
 */
async function syncAdapterRestoreInboxToHost(host) {
    const synced = [];
    if (typeof host.readDirAsync !== "function" || typeof host.readFileAsync !== "function") {
        return synced;
    }
    let entries = [];
    try {
        entries = await host.readDirAsync(host.namespace, ADAPTER_RESTORE_INBOX);
    }
    catch {
        return synced;
    }
    const inbox = (0, source_1.restoreInboxDir)(host);
    await fs.mkdir(inbox, { recursive: true });
    for (const ent of entries) {
        if (ent.isDir)
            continue;
        const rawName = path.basename(ent.file);
        if (!rawName.endsWith(".emsbackup"))
            continue;
        let name = rawName;
        if (!retention_1.OWN_EXPORT_FILE_RE.test(name)) {
            const ts = new Date().toISOString().replace(/[:.]/g, "-");
            name = `ems-light-upload-${ts}.emsbackup`;
        }
        try {
            const { file } = await host.readFileAsync(host.namespace, `${ADAPTER_RESTORE_INBOX}/${rawName}`);
            const buf = Buffer.isBuffer(file) ? file : Buffer.from(String(file), "binary");
            if (buf.length < 32)
                continue;
            await fs.writeFile(path.join(inbox, name), buf);
            synced.push(name);
        }
        catch (e) {
            host.log?.warn?.(`restore sync ${rawName}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    return synced;
}
exports.syncAdapterRestoreInboxToHost = syncAdapterRestoreInboxToHost;
async function listRestoreFileOptions(host) {
    await syncAdapterRestoreInboxToHost(host);
    const dirs = [
        { dir: (0, retention_1.backupDir)(host), tag: "backup" },
        { dir: (0, source_1.restoreInboxDir)(host), tag: "inbox" },
    ];
    const collected = [];
    const seen = new Set();
    for (const { dir, tag } of dirs) {
        let names = [];
        try {
            names = await fs.readdir(dir);
        }
        catch {
            continue;
        }
        for (const name of names) {
            if (!name.endsWith(".emsbackup"))
                continue;
            if (!retention_1.OWN_EXPORT_FILE_RE.test(name))
                continue;
            if (seen.has(name))
                continue;
            seen.add(name);
            const stamp = parseBackupFileStamp(name);
            collected.push({ name, tag, sortKey: stamp?.sortKey ?? name });
        }
    }
    collected.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));
    if (collected.length === 0) {
        return [
            {
                value: "",
                label: "(keine .emsbackup — zuerst „Backup jetzt erstellen“)",
            },
        ];
    }
    return collected.map((c, i) => formatRestoreOptionLabel(c.name, c.tag, i === 0));
}
exports.listRestoreFileOptions = listRestoreFileOptions;
async function writeRestoreUploadToInbox(host, _fileName, base64OrDataUrl) {
    try {
        const raw = String(base64OrDataUrl || "");
        if (!raw || raw.length < 16) {
            return { ok: false, error: "keine Upload-Daten — Datei wählen und speichern/nochmal versuchen" };
        }
        const b64 = raw.includes("base64,") ? raw.split("base64,", 2)[1] : raw;
        const buf = Buffer.from(b64, "base64");
        if (buf.length < 32) {
            return { ok: false, error: "upload empty or invalid" };
        }
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const name = `ems-light-upload-${ts}.emsbackup`;
        const inbox = (0, source_1.restoreInboxDir)(host);
        await fs.mkdir(inbox, { recursive: true });
        await fs.writeFile(path.join(inbox, name), buf);
        return { ok: true, fileName: name };
    }
    catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}
exports.writeRestoreUploadToInbox = writeRestoreUploadToInbox;
async function readSupportFileBase64(host, fileName) {
    try {
        let name = String(fileName || "").trim();
        if (!name) {
            const dir = (0, retention_1.supportDir)(host);
            const names = (await fs.readdir(dir).catch(() => []))
                .filter((n) => n.endsWith(".emssupport") && retention_1.OWN_EXPORT_FILE_RE.test(n))
                .sort()
                .reverse();
            name = names[0] ?? "";
        }
        if (!name || !name.endsWith(".emssupport") || !retention_1.OWN_EXPORT_FILE_RE.test(name)) {
            return { ok: false, error: "no support file" };
        }
        const full = path.join((0, retention_1.supportDir)(host), name);
        const buf = await fs.readFile(full);
        return {
            ok: true,
            fileName: name,
            mimeType: "application/octet-stream",
            base64: buf.toString("base64"),
            sizeBytes: buf.length,
        };
    }
    catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}
exports.readSupportFileBase64 = readSupportFileBase64;
