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
exports.adapterFileDownloadPath = exports.applyReadableExportPermissions = exports.applyReadableExportDirs = exports.ensureDirReadable = exports.chmodExportPath = exports.EXPORT_FILE_MODE = exports.EXPORT_DIR_MODE = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const atomic_write_1 = require("../persistence/atomic_write");
const retention_1 = require("./retention");
const source_1 = require("../restore/source");
/** User-facing Exporte: lesbar für normalen ioBroker-/SFTP-Betrieb, nicht world-writable. */
exports.EXPORT_DIR_MODE = atomic_write_1.DIAGNOSTIC_DIR_MODE;
exports.EXPORT_FILE_MODE = atomic_write_1.DIAGNOSTIC_FILE_MODE;
async function chmodExportPath(fullPath, dir) {
    await fs.chmod(fullPath, dir ? exports.EXPORT_DIR_MODE : exports.EXPORT_FILE_MODE).catch(() => undefined);
}
exports.chmodExportPath = chmodExportPath;
async function ensureDirReadable(dirPath) {
    await fs.mkdir(dirPath, { recursive: true, mode: exports.EXPORT_DIR_MODE });
    await chmodExportPath(dirPath, true);
}
exports.ensureDirReadable = ensureDirReadable;
async function walkExportTree(root) {
    let entries;
    try {
        entries = await fs.readdir(root, { withFileTypes: true });
    }
    catch {
        return;
    }
    await chmodExportPath(root, true);
    for (const ent of entries) {
        if (ent.name === "." || ent.name === "..")
            continue;
        const full = path.join(root, ent.name);
        try {
            const st = await fs.lstat(full);
            if (st.isSymbolicLink())
                continue;
            if (st.isDirectory()) {
                await walkExportTree(full);
            }
            else if (st.isFile()) {
                await chmodExportPath(full, false);
            }
        }
        catch {
            // Eintrag verschwunden
        }
    }
}
async function applyReadableExportDirs(roots) {
    for (const root of roots) {
        await ensureDirReadable(root);
        await walkExportTree(root);
    }
}
exports.applyReadableExportDirs = applyReadableExportDirs;
/** Backup-, Support- und Restore-Inbox-Bäume auf 0755/0644 setzen (bestehende Dateien inkl.). */
async function applyReadableExportPermissions(input) {
    await applyReadableExportDirs([(0, retention_1.backupDir)(input), (0, retention_1.supportDir)(input), (0, source_1.restoreInboxDir)(input)]);
}
exports.applyReadableExportPermissions = applyReadableExportPermissions;
function adapterFileDownloadPath(namespace, kind, fileName) {
    return `/files/${namespace}/${kind}/${fileName}`;
}
exports.adapterFileDownloadPath = adapterFileDownloadPath;
