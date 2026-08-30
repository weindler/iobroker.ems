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
exports.atomicWriteJson = exports.atomicWriteFile = exports.cleanupAtomicTempFiles = exports.isAtomicTempFileName = exports.DIAGNOSTIC_DIR_MODE = exports.DIAGNOSTIC_FILE_MODE = exports.ATOMIC_TMP_PREFIX = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const node_crypto_1 = require("node:crypto");
exports.ATOMIC_TMP_PREFIX = ".tmp-";
/** Diagnose-Dateien: Owner rw, Gruppe/Andere r — kein World-Write. */
exports.DIAGNOSTIC_FILE_MODE = 0o644;
exports.DIAGNOSTIC_DIR_MODE = 0o755;
function isAtomicTempFileName(name) {
    return name.startsWith(exports.ATOMIC_TMP_PREFIX);
}
exports.isAtomicTempFileName = isAtomicTempFileName;
async function cleanupAtomicTempFiles(dir) {
    try {
        const names = await fs.readdir(dir);
        for (const name of names) {
            if (!isAtomicTempFileName(name))
                continue;
            await fs.unlink(path.join(dir, name)).catch(() => undefined);
        }
    }
    catch {
        // directory missing
    }
}
exports.cleanupAtomicTempFiles = cleanupAtomicTempFiles;
async function atomicWriteFile(targetPath, content, options = {}) {
    const dir = path.dirname(targetPath);
    const fileMode = options.mode ?? exports.DIAGNOSTIC_FILE_MODE;
    await fs.mkdir(dir, { recursive: true, mode: exports.DIAGNOSTIC_DIR_MODE });
    const tmp = path.join(dir, `${exports.ATOMIC_TMP_PREFIX}${path.basename(targetPath)}.${process.pid}.${(0, node_crypto_1.randomUUID)().slice(0, 8)}`);
    try {
        await fs.writeFile(tmp, content, { mode: fileMode });
        if (options.validate) {
            options.validate();
        }
        await fs.rename(tmp, targetPath);
        /* rename behält Mode der Temp-Datei; zusätzlich absichern falls umask/FS abweicht */
        await fs.chmod(targetPath, fileMode).catch(() => undefined);
    }
    catch (e) {
        await fs.unlink(tmp).catch(() => undefined);
        throw e;
    }
}
exports.atomicWriteFile = atomicWriteFile;
async function atomicWriteJson(targetPath, value, stringify, validate) {
    const content = stringify(value);
    await atomicWriteFile(targetPath, content, {
        validate: validate
            ? () => {
                validate(JSON.parse(content));
            }
            : undefined,
    });
}
exports.atomicWriteJson = atomicWriteJson;
