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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureAdapterFilesMeta = ensureAdapterFilesMeta;
exports.mirrorExportIntoAdapterFiles = mirrorExportIntoAdapterFiles;
exports.mirrorHostExportFile = mirrorHostExportFile;
exports.parseBackupFileStamp = parseBackupFileStamp;
exports.syncAdapterRestoreInboxToHost = syncAdapterRestoreInboxToHost;
exports.listRestoreFileOptions = listRestoreFileOptions;
exports.writeRestoreUploadToInbox = writeRestoreUploadToInbox;
exports.readSupportFileBase64 = readSupportFileBase64;
exports.listBackupFileNames = listBackupFileNames;
exports.readBackupFileBase64 = readBackupFileBase64;
exports.deleteBackupFile = deleteBackupFile;
exports.deleteOldBackups = deleteOldBackups;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const limits_1 = require("./limits");
const retention_1 = require("./retention");
const source_1 = require("../restore/source");
const export_permissions_1 = require("./export_permissions");
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
async function mirrorHostExportFile(host, kind, fileName) {
    const dir = kind === "backup" ? (0, retention_1.backupDir)(host) : (0, retention_1.supportDir)(host);
    const full = path.join(dir, fileName);
    const data = await fs.readFile(full);
    await mirrorExportIntoAdapterFiles(host, kind, fileName, data);
}
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
    await (0, export_permissions_1.ensureDirReadable)(inbox);
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
            await fs.writeFile(path.join(inbox, name), buf, { mode: export_permissions_1.EXPORT_FILE_MODE });
            await (0, export_permissions_1.chmodExportPath)(path.join(inbox, name), false);
            synced.push(name);
        }
        catch (e) {
            host.log?.warn?.(`restore sync ${rawName}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    return synced;
}
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
async function writeRestoreUploadToInbox(host, _fileName, base64OrDataUrl) {
    try {
        const raw = String(base64OrDataUrl || "");
        if (!raw || raw.length < 16) {
            return { ok: false, error: "keine Upload-Daten — Datei wählen und speichern/nochmal versuchen" };
        }
        /* Größenbegrenzung vor dem Dekodieren: base64 ist ca. 4/3 so lang wie die Daten. */
        if (raw.length > Math.ceil((limits_1.EXPORT_LIMITS.MAX_BACKUP_ARCHIVE_BYTES * 4) / 3) + 1024) {
            return { ok: false, error: "Datei zu groß (maximal 32 MB)" };
        }
        const b64 = raw.includes("base64,") ? raw.split("base64,", 2)[1] : raw;
        const buf = Buffer.from(b64, "base64");
        if (buf.length > limits_1.EXPORT_LIMITS.MAX_BACKUP_ARCHIVE_BYTES) {
            return { ok: false, error: "Datei zu groß (maximal 32 MB)" };
        }
        if (buf.length < 32) {
            return { ok: false, error: "upload empty or invalid" };
        }
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const name = `ems-light-upload-${ts}.emsbackup`;
        const inbox = (0, source_1.restoreInboxDir)(host);
        await (0, export_permissions_1.ensureDirReadable)(inbox);
        await fs.writeFile(path.join(inbox, name), buf, { mode: export_permissions_1.EXPORT_FILE_MODE });
        await (0, export_permissions_1.chmodExportPath)(path.join(inbox, name), false);
        return { ok: true, fileName: name };
    }
    catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}
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
            mimeType: "application/zip",
            downloadPath: (0, export_permissions_1.adapterFileDownloadPath)(host.namespace, "support", name),
            base64: buf.toString("base64"),
            sizeBytes: buf.length,
        };
    }
    catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}
/** Alle vorhandenen .emsbackup (Host-Backup-Ordner und Inbox), neueste zuerst. */
async function listBackupFileNames(host) {
    const seen = new Set();
    for (const dir of [(0, retention_1.backupDir)(host), (0, source_1.restoreInboxDir)(host)]) {
        const names = await fs.readdir(dir).catch(() => []);
        for (const n of names)
            if (n.endsWith(".emsbackup") && retention_1.OWN_EXPORT_FILE_RE.test(n))
                seen.add(n);
    }
    return [...seen].sort((a, b) => {
        const ka = parseBackupFileStamp(a)?.sortKey ?? a;
        const kb = parseBackupFileStamp(b)?.sortKey ?? b;
        return ka < kb ? 1 : ka > kb ? -1 : 0;
    });
}
/** Backup für den Browser-Download bereitstellen (Adapter-Dateien + base64 bis 6 MB). */
async function readBackupFileBase64(host, fileName) {
    try {
        const name = String(fileName || "").trim();
        (0, retention_1.assertSafeFileName)(name);
        if (!name.endsWith(".emsbackup"))
            return { ok: false, error: "keine Backup-Datei" };
        let buf = null;
        for (const dir of [(0, retention_1.backupDir)(host), (0, source_1.restoreInboxDir)(host)]) {
            buf = await fs.readFile(path.join(dir, name)).catch(() => null);
            if (buf)
                break;
        }
        if (!buf)
            return { ok: false, error: "Datei nicht gefunden" };
        /* Spiegel in den Adapter-Dateien sicherstellen, damit der Download-Link funktioniert. */
        await mirrorExportIntoAdapterFiles(host, "backup", name, buf).catch(() => undefined);
        return {
            ok: true,
            fileName: name,
            mimeType: "application/zip",
            downloadPath: (0, export_permissions_1.adapterFileDownloadPath)(host.namespace, "backup", name),
            base64: buf.toString("base64"),
            sizeBytes: buf.length,
        };
    }
    catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}
/** Ein Backup löschen: Host-Ordner, Inbox und die Spiegelkopie in den Adapter-Dateien. */
async function deleteBackupFile(host, fileName) {
    try {
        const name = String(fileName || "").trim();
        (0, retention_1.assertSafeFileName)(name);
        if (!name.endsWith(".emsbackup"))
            return { ok: false, error: "keine Backup-Datei" };
        let found = false;
        for (const dir of [(0, retention_1.backupDir)(host), (0, source_1.restoreInboxDir)(host)]) {
            const full = path.join(dir, name);
            const had = await fs.stat(full).then(() => true).catch(() => false);
            if (had) {
                await fs.unlink(full);
                found = true;
            }
        }
        if (typeof host.delFileAsync === "function") {
            for (const rel of [`backup/${name}`, `${ADAPTER_RESTORE_INBOX}/${name}`]) {
                if (await host.delFileAsync(host.namespace, rel).then(() => true).catch(() => false))
                    found = true;
            }
        }
        return found ? { ok: true, fileName: name } : { ok: false, error: "Datei nicht gefunden" };
    }
    catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}
/** Alle Backups löschen außer den neuesten `keep`. */
async function deleteOldBackups(host, keep) {
    const names = await listBackupFileNames(host);
    const keepN = Math.max(1, Math.floor(keep));
    const deleted = [];
    for (const n of names.slice(keepN)) {
        const r = await deleteBackupFile(host, n);
        if (r.ok)
            deleted.push(n);
    }
    return { deleted, kept: names.slice(0, keepN) };
}
