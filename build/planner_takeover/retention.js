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
exports.retainPlannerCandidates = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const constants_1 = require("./constants");
function toSet(v) {
    if (!v)
        return new Set();
    return v instanceof Set ? new Set(v) : new Set(v);
}
/**
 * Prune candidate job directories under runtime candidate root.
 * Never touches canonical paths. Never deletes protected (active) jobs.
 * Failures are isolated into errors[].
 */
async function retainPlannerCandidates(options) {
    const root = options.candidateRootDir;
    const protectedIds = toSet(options.protectedJobIds);
    const keepIds = toSet(options.keepJobIds);
    const nowMs = options.nowMs ?? Date.now();
    const maxRecent = options.maxRecent ?? constants_1.TAKEOVER_RETENTION_MAX_RECENT;
    const maxAgeMs = options.maxAgeMs ?? constants_1.TAKEOVER_RETENTION_MAX_AGE_MS;
    const maxTotalBytes = options.maxTotalBytes ?? constants_1.TAKEOVER_RETENTION_MAX_TOTAL_BYTES;
    const deleted = [];
    const kept = [];
    const errors = [];
    let entries = [];
    try {
        const names = await fs.readdir(root);
        for (const name of names) {
            const full = path.join(root, name);
            try {
                const st = await fs.stat(full);
                if (!st.isDirectory())
                    continue;
                entries.push({ name, mtimeMs: st.mtimeMs, size: await dirSize(full) });
            }
            catch (e) {
                errors.push(`${name}:${String(e)}`);
            }
        }
    }
    catch (e) {
        return { deleted, kept, errors: [`readdir:${String(e)}`], totalBytesAfter: 0 };
    }
    entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const mustKeep = new Set([...protectedIds, ...keepIds]);
    // Always keep newest recent window
    for (let i = 0; i < Math.min(maxRecent, entries.length); i++) {
        mustKeep.add(entries[i].name);
    }
    let totalBytes = entries.reduce((s, e) => s + e.size, 0);
    for (const entry of entries) {
        const age = nowMs - entry.mtimeMs;
        const overAge = age > maxAgeMs;
        const overBytes = totalBytes > maxTotalBytes;
        const overCount = entries.filter((e) => !deleted.includes(e.name)).length > maxRecent;
        const forcedKeep = mustKeep.has(entry.name) || protectedIds.has(entry.name);
        if (forcedKeep) {
            kept.push(entry.name);
            continue;
        }
        if (overAge || (overBytes && overCount) || overCount) {
            try {
                await fs.rm(path.join(root, entry.name), { recursive: true, force: true });
                deleted.push(entry.name);
                totalBytes -= entry.size;
            }
            catch (e) {
                errors.push(`${entry.name}:${String(e)}`);
                kept.push(entry.name);
            }
        }
        else {
            kept.push(entry.name);
        }
    }
    return { deleted, kept, errors, totalBytesAfter: Math.max(0, totalBytes) };
}
exports.retainPlannerCandidates = retainPlannerCandidates;
async function dirSize(dir) {
    let total = 0;
    const stack = [dir];
    while (stack.length) {
        const cur = stack.pop();
        const names = await fs.readdir(cur);
        for (const name of names) {
            const full = path.join(cur, name);
            const st = await fs.stat(full);
            if (st.isDirectory())
                stack.push(full);
            else
                total += st.size;
        }
    }
    return total;
}
