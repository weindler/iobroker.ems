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
exports.TEMP_PREFIX = exports.SUPPORT_EXT = exports.BACKUP_EXT = exports.writeAtomicArchive = exports.enforceRetention = exports.cleanupTempExports = exports.ensureExportDirs = exports.resolveExportPath = exports.assertPathWithinExportRoot = exports.assertSafeFileName = exports.supportDir = exports.backupDir = exports.exportRootDir = exports.OWN_EXPORT_FILE_RE = exports.SUPPORT_RETENTION_MAX = exports.BACKUP_RETENTION_MAX = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const promises_1 = require("node:fs/promises");
exports.BACKUP_RETENTION_MAX = 10;
exports.SUPPORT_RETENTION_MAX = 5;
const BACKUP_EXT = ".emsbackup";
exports.BACKUP_EXT = BACKUP_EXT;
const SUPPORT_EXT = ".emssupport";
exports.SUPPORT_EXT = SUPPORT_EXT;
const TEMP_PREFIX = ".tmp-";
exports.TEMP_PREFIX = TEMP_PREFIX;
/** Nur eigene Exportdateien (ems-light-*.{emsbackup,emssupport}). */
exports.OWN_EXPORT_FILE_RE = /^ems-light-.+\.(emsbackup|emssupport)$/;
function exportRootDir(instanceDataDir) {
    return path.join(instanceDataDir, "exports");
}
exports.exportRootDir = exportRootDir;
function backupDir(instanceDataDir) {
    return path.join(exportRootDir(instanceDataDir), "backup");
}
exports.backupDir = backupDir;
function supportDir(instanceDataDir) {
    return path.join(exportRootDir(instanceDataDir), "support");
}
exports.supportDir = supportDir;
function assertSafeFileName(name) {
    if (!name || name.includes("..") || name.includes("/") || name.includes("\\") || name.includes("\0")) {
        throw new Error("invalid export file name");
    }
    if (!exports.OWN_EXPORT_FILE_RE.test(name)) {
        throw new Error("invalid export file name pattern");
    }
}
exports.assertSafeFileName = assertSafeFileName;
async function assertPathWithinExportRoot(resolvedPath, exportRoot) {
    const realRoot = await (0, promises_1.realpath)(exportRoot).catch(() => path.resolve(exportRoot));
    const realTarget = await (0, promises_1.realpath)(resolvedPath).catch(() => path.resolve(resolvedPath));
    if (!realTarget.startsWith(realRoot + path.sep) && realTarget !== realRoot) {
        throw new Error("path traversal blocked (realpath)");
    }
}
exports.assertPathWithinExportRoot = assertPathWithinExportRoot;
function resolveExportPath(baseDir, fileName) {
    assertSafeFileName(fileName);
    const resolved = path.resolve(baseDir, fileName);
    const base = path.resolve(baseDir);
    if (!resolved.startsWith(base + path.sep) && resolved !== base) {
        throw new Error("path traversal blocked");
    }
    return resolved;
}
exports.resolveExportPath = resolveExportPath;
async function ensureExportDirs(instanceDataDir) {
    await fs.mkdir(backupDir(instanceDataDir), { recursive: true, mode: 0o700 });
    await fs.mkdir(supportDir(instanceDataDir), { recursive: true, mode: 0o700 });
}
exports.ensureExportDirs = ensureExportDirs;
async function cleanupTempExports(instanceDataDir) {
    for (const dir of [backupDir(instanceDataDir), supportDir(instanceDataDir)]) {
        try {
            const files = await fs.readdir(dir);
            for (const f of files) {
                if (!f.startsWith(TEMP_PREFIX))
                    continue;
                const full = path.join(dir, f);
                const st = await fs.lstat(full);
                if (st.isSymbolicLink())
                    continue;
                await fs.unlink(full).catch(() => undefined);
            }
        }
        catch {
            // Verzeichnis fehlt
        }
    }
}
exports.cleanupTempExports = cleanupTempExports;
function isOwnArchive(name, ext) {
    return name.endsWith(ext) && !name.startsWith(TEMP_PREFIX) && exports.OWN_EXPORT_FILE_RE.test(name);
}
async function listArchives(dir, ext) {
    try {
        const files = await fs.readdir(dir);
        const out = [];
        for (const name of files) {
            if (!isOwnArchive(name, ext))
                continue;
            const full = path.join(dir, name);
            const st = await fs.lstat(full);
            if (st.isSymbolicLink())
                continue;
            out.push({ name, mtimeMs: st.mtimeMs });
        }
        return out.sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name));
    }
    catch {
        return [];
    }
}
async function enforceRetention(instanceDataDir) {
    const bDir = backupDir(instanceDataDir);
    const sDir = supportDir(instanceDataDir);
    const backups = await listArchives(bDir, BACKUP_EXT);
    while (backups.length > exports.BACKUP_RETENTION_MAX) {
        const oldest = backups.shift();
        if (oldest) {
            const target = path.join(bDir, oldest.name);
            await assertPathWithinExportRoot(target, bDir).catch(() => undefined);
            await fs.unlink(target).catch(() => undefined);
        }
    }
    const supports = await listArchives(sDir, SUPPORT_EXT);
    while (supports.length > exports.SUPPORT_RETENTION_MAX) {
        const oldest = supports.shift();
        if (oldest) {
            const target = path.join(sDir, oldest.name);
            await assertPathWithinExportRoot(target, sDir).catch(() => undefined);
            await fs.unlink(target).catch(() => undefined);
        }
    }
}
exports.enforceRetention = enforceRetention;
async function writeAtomicArchive(targetPath, data) {
    const dir = path.dirname(targetPath);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const resolved = path.resolve(targetPath);
    await assertPathWithinExportRoot(resolved, dir);
    const tmp = path.join(dir, `${TEMP_PREFIX}${path.basename(targetPath)}.${process.pid}`);
    await fs.writeFile(tmp, data, { mode: 0o600 });
    await fs.rename(tmp, targetPath);
    try {
        await fs.chmod(targetPath, 0o600);
    }
    catch {
        // Plattform ohne chmod
    }
}
exports.writeAtomicArchive = writeAtomicArchive;
