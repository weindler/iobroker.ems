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
const path = __importStar(require("node:path"));
const paths_1 = require("../backup_integration/paths");
const retention_1 = require("../backup/retention");
function layoutFromInstanceDataDir(instanceDataDir) {
    return (0, paths_1.resolveEmsPaths)(instanceDataDir);
}
function restoreInboxDir(input) {
    return (0, paths_1.resolveEmsPaths)(input).runtimeRestoreInboxDir;
}
exports.restoreInboxDir = restoreInboxDir;
function restoreTransactionsDir(input) {
    return (0, paths_1.resolveEmsPaths)(input).runtimeTransactionsDir;
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
    if (!retention_1.OWN_EXPORT_FILE_RE.test(fileName)) {
        throw new Error("invalid restore file name pattern");
    }
}
exports.assertRestoreFileName = assertRestoreFileName;
function resolveRestoreSourcePath(input, fileName) {
    assertRestoreFileName(fileName);
    const layout = (0, paths_1.resolveEmsPaths)(input);
    const candidates = [
        {
            path: path.join(layout.runtimeExportsDir, "backup", fileName),
            rootKind: "backup_dir",
            root: path.join(layout.runtimeExportsDir, "backup"),
        },
        {
            path: path.join(layout.runtimeRestoreInboxDir, fileName),
            rootKind: "inbox",
            root: layout.runtimeRestoreInboxDir,
        },
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
    const { realpath, lstat } = await Promise.resolve().then(() => __importStar(require("node:fs/promises")));
    const st = await lstat(resolvedPath);
    if (st.isSymbolicLink()) {
        throw new Error("restore source symlink not allowed");
    }
    const realRoot = await realpath(allowedRoot).catch(() => path.resolve(allowedRoot));
    const realTarget = await realpath(resolvedPath).catch(() => path.resolve(resolvedPath));
    if (!realTarget.startsWith(realRoot + path.sep) && realTarget !== realRoot) {
        throw new Error("restore source realpath outside root");
    }
}
exports.assertRestoreSourceSafe = assertRestoreSourceSafe;
async function readRestoreArchiveFile(input, fileName) {
    const { path: resolved, rootKind } = resolveRestoreSourcePath(input, fileName);
    const layout = (0, paths_1.resolveEmsPaths)(input);
    const allowedRoot = rootKind === "backup_dir"
        ? path.join(layout.runtimeExportsDir, "backup")
        : layout.runtimeRestoreInboxDir;
    await assertRestoreSourceSafe(resolved, allowedRoot);
    const { stat, readFile } = await Promise.resolve().then(() => __importStar(require("node:fs/promises")));
    const st = await stat(resolved);
    const buffer = await readFile(resolved);
    return { buffer, rootKind, sizeBytes: st.size, mtimeMs: st.mtimeMs, resolvedPath: resolved };
}
exports.readRestoreArchiveFile = readRestoreArchiveFile;
