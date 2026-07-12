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
exports.readRestoreArchiveFile = exports.assertRestoreSourceSafe = exports.resolveRestoreSourcePath = exports.assertRestoreFileName = exports.restoreTransactionsDir = exports.restoreInboxDir = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const promises_1 = require("node:fs/promises");
const retention_1 = require("../backup/retention");
const retention_2 = require("../backup/retention");
function restoreInboxDir(instanceDataDir) {
    return path.join(instanceDataDir, "restore", "inbox");
}
exports.restoreInboxDir = restoreInboxDir;
function restoreTransactionsDir(instanceDataDir) {
    return path.join(instanceDataDir, "restore", "transactions");
}
exports.restoreTransactionsDir = restoreTransactionsDir;
/** Validiert Dateinamen — nur einfacher `.emsbackup`-Name. */
function assertRestoreFileName(fileName) {
    if (!fileName || fileName.includes("/") || fileName.includes("\\") || fileName.includes("\0")) {
        throw new Error("invalid restore file name");
    }
    if (fileName.includes("..")) {
        throw new Error("path traversal in restore file name");
    }
    if (fileName.startsWith(".tmp-")) {
        throw new Error("temp file not allowed");
    }
    if (!fileName.endsWith(".emsbackup")) {
        throw new Error("restore requires .emsbackup extension");
    }
    if (fileName.endsWith(".emssupport")) {
        throw new Error("support packages not restorable");
    }
    if (!retention_2.OWN_EXPORT_FILE_RE.test(fileName)) {
        throw new Error("invalid restore file name pattern");
    }
}
exports.assertRestoreFileName = assertRestoreFileName;
function resolveRestoreSourcePath(instanceDataDir, fileName) {
    assertRestoreFileName(fileName);
    const candidates = [
        { path: path.join((0, retention_1.backupDir)(instanceDataDir), fileName), rootKind: "backup_dir", root: (0, retention_1.backupDir)(instanceDataDir) },
        { path: path.join(restoreInboxDir(instanceDataDir), fileName), rootKind: "inbox", root: restoreInboxDir(instanceDataDir) },
    ];
    for (const c of candidates) {
        const resolved = path.resolve(c.path);
        const root = path.resolve(c.root);
        if (resolved.startsWith(root + path.sep) || resolved === root) {
            return { path: resolved, rootKind: c.rootKind };
        }
    }
    throw new Error("restore source path outside allowed root");
}
exports.resolveRestoreSourcePath = resolveRestoreSourcePath;
async function assertRestoreSourceSafe(resolvedPath, allowedRoot) {
    const st = await fs.lstat(resolvedPath);
    if (st.isSymbolicLink()) {
        throw new Error("restore source symlink not allowed");
    }
    const realRoot = await (0, promises_1.realpath)(allowedRoot).catch(() => path.resolve(allowedRoot));
    const realTarget = await (0, promises_1.realpath)(resolvedPath).catch(() => path.resolve(resolvedPath));
    if (!realTarget.startsWith(realRoot + path.sep) && realTarget !== realRoot) {
        throw new Error("restore source realpath outside root");
    }
}
exports.assertRestoreSourceSafe = assertRestoreSourceSafe;
async function readRestoreArchiveFile(instanceDataDir, fileName) {
    const { path: resolved, rootKind } = resolveRestoreSourcePath(instanceDataDir, fileName);
    const allowedRoot = rootKind === "backup_dir" ? (0, retention_1.backupDir)(instanceDataDir) : restoreInboxDir(instanceDataDir);
    await assertRestoreSourceSafe(resolved, allowedRoot);
    const st = await fs.stat(resolved);
    const buffer = await fs.readFile(resolved);
    return { buffer, rootKind, sizeBytes: st.size, mtimeMs: st.mtimeMs, resolvedPath: resolved };
}
exports.readRestoreArchiveFile = readRestoreArchiveFile;
