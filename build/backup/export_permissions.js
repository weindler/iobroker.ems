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
exports.EXPORT_FILE_MODE = exports.EXPORT_DIR_MODE = void 0;
exports.chmodExportPath = chmodExportPath;
exports.ensureDirReadable = ensureDirReadable;
exports.applyReadableExportDirs = applyReadableExportDirs;
exports.applyReadableExportPermissions = applyReadableExportPermissions;
exports.adapterFileDownloadPath = adapterFileDownloadPath;
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
async function ensureDirReadable(dirPath) {
    await fs.mkdir(dirPath, { recursive: true, mode: exports.EXPORT_DIR_MODE });
    await chmodExportPath(dirPath, true);
}
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
/** Backup-, Support- und Restore-Inbox-Bäume auf 0755/0644 setzen (bestehende Dateien inkl.). */
async function applyReadableExportPermissions(input) {
    await applyReadableExportDirs([(0, retention_1.backupDir)(input), (0, retention_1.supportDir)(input), (0, source_1.restoreInboxDir)(input)]);
}
function adapterFileDownloadPath(namespace, kind, fileName) {
    return `/files/${namespace}/${kind}/${fileName}`;
}
