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
exports.restoreLearningFromSnapshot = exports.applyLearningFromStaged = exports.writeLearningSnapshot = exports.snapshotLearningFiles = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const promises_1 = require("node:fs/promises");
const data_dir_1 = require("../learning/data_dir");
const checksum_1 = require("../backup/checksum");
const limits_1 = require("../backup/limits");
const schema_1 = require("../backup/schema");
const learning_map_1 = require("./learning_map");
const journal_1 = require("./journal");
const apply_hooks_1 = require("./apply_hooks");
async function snapshotLearningFiles(host) {
    const adapter = host;
    const out = [];
    for (const key of learning_map_1.RESTORE_LEARNING_KEYS) {
        const target = learning_map_1.RESTORE_LEARNING_TARGETS[key];
        const base = (0, data_dir_1.learningDataPath)(adapter, target.category);
        const filePath = path.join(base, target.fileName);
        let exists = false;
        let sha256 = null;
        let sizeBytes = 0;
        let content;
        try {
            const st = await fs.lstat(filePath);
            if (st.isSymbolicLink()) {
                throw new Error(`learning symlink not allowed: ${key}`);
            }
            const buf = await fs.readFile(filePath);
            exists = true;
            sizeBytes = buf.length;
            sha256 = (0, checksum_1.sha256Buffer)(buf);
            content = JSON.parse(buf.toString("utf8"));
        }
        catch (e) {
            if (e instanceof Error && e.message.includes("symlink"))
                throw e;
        }
        out.push({ key, category: target.category, fileName: target.fileName, exists, sha256, sizeBytes, content });
    }
    return out;
}
exports.snapshotLearningFiles = snapshotLearningFiles;
async function writeLearningSnapshot(dir, sub, entries) {
    for (const e of entries) {
        if (!e.exists || e.content === undefined)
            continue;
        const rel = path.join(sub, "learning", e.fileName);
        await (0, journal_1.writeJsonFileAtomic)(path.join(dir, rel), e.content);
    }
}
exports.writeLearningSnapshot = writeLearningSnapshot;
async function applyLearningFromStaged(host, txDir, learning) {
    const adapter = host;
    const middleIdx = Math.floor(learning_map_1.RESTORE_LEARNING_KEYS.length / 2);
    for (let i = 0; i < learning_map_1.RESTORE_LEARNING_KEYS.length; i++) {
        const key = learning_map_1.RESTORE_LEARNING_KEYS[i];
        const target = learning_map_1.RESTORE_LEARNING_TARGETS[key];
        const base = (0, data_dir_1.learningDataPath)(adapter, target.category);
        await fs.mkdir(base, { recursive: true, mode: 0o700 });
        const dest = path.join(base, target.fileName);
        const resolved = path.resolve(dest);
        const realBase = await (0, promises_1.realpath)(base).catch(() => path.resolve(base));
        if (!resolved.startsWith(realBase + path.sep) && resolved !== realBase) {
            throw new Error("learning target outside base");
        }
        const st = await fs.lstat(dest).catch(() => null);
        if (st?.isSymbolicLink()) {
            throw new Error("learning target is symlink");
        }
        if (learning[key] === undefined) {
            await fs.unlink(dest).catch(() => undefined);
        }
        else {
            const text = (0, schema_1.stableJsonStringify)(learning[key]);
            (0, limits_1.assertWithinLimit)(text.length, limits_1.EXPORT_LIMITS.MAX_SINGLE_FILE_BYTES, key);
            JSON.parse(text);
            const stagedPath = path.join(txDir, "staged", "learning", target.fileName);
            let payload = learning[key];
            try {
                const stagedRaw = await fs.readFile(stagedPath, "utf8");
                payload = JSON.parse(stagedRaw);
            }
            catch {
                // staged fehlt — direkt aus Projektion
            }
            const tmp = path.join(base, `.tmp-${target.fileName}.${process.pid}`);
            await fs.writeFile(tmp, (0, schema_1.stableJsonStringify)(payload), { mode: 0o600 });
            await fs.rename(tmp, dest);
            const verify = (0, checksum_1.sha256Buffer)(await fs.readFile(dest));
            const expected = (0, checksum_1.sha256Buffer)(Buffer.from((0, schema_1.stableJsonStringify)(payload), "utf8"));
            if (verify !== expected) {
                throw new Error(`learning verify failed: ${key}`);
            }
        }
        if (i === 0)
            await (0, apply_hooks_1.maybeInjectRestoreApplyFailure)("after_learning_first");
        if (i === middleIdx)
            await (0, apply_hooks_1.maybeInjectRestoreApplyFailure)("after_learning_middle");
        if (i === learning_map_1.RESTORE_LEARNING_KEYS.length - 1)
            await (0, apply_hooks_1.maybeInjectRestoreApplyFailure)("after_learning_last");
    }
}
exports.applyLearningFromStaged = applyLearningFromStaged;
async function restoreLearningFromSnapshot(host, txDir, sub) {
    const adapter = host;
    for (const key of learning_map_1.RESTORE_LEARNING_KEYS) {
        const target = learning_map_1.RESTORE_LEARNING_TARGETS[key];
        const base = (0, data_dir_1.learningDataPath)(adapter, target.category);
        const dest = path.join(base, target.fileName);
        const snapPath = path.join(txDir, sub, "learning", target.fileName);
        try {
            const raw = await fs.readFile(snapPath, "utf8");
            const tmp = path.join(base, `.tmp-${target.fileName}.${process.pid}`);
            await fs.writeFile(tmp, raw, { mode: 0o600 });
            await fs.rename(tmp, dest);
        }
        catch {
            await fs.unlink(dest).catch(() => undefined);
        }
    }
}
exports.restoreLearningFromSnapshot = restoreLearningFromSnapshot;
