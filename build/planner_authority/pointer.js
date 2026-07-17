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
exports.writeWorkerPointer = exports.writeLegacyPointer = exports.readPointer = exports.writePointerAtomic = exports.validatePointer = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const constants_1 = require("./constants");
const authoritative_source_1 = require("../planner_config/authoritative_source");
function isUnder(candidate, root) {
    const c = path.resolve(candidate);
    const r = path.resolve(root);
    return c === r || c.startsWith(r + path.sep);
}
/**
 * Validate a pointer's structure and — for worker_dryrun — that the plan path is
 * confined to the worker canonical dir and never under the candidate area.
 */
function validatePointer(pointer, layout) {
    if (!pointer || typeof pointer !== "object")
        return { ok: false, code: "not_object" };
    const p = pointer;
    if (p.schemaVersion !== constants_1.ACTIVE_AUTHORITY_SCHEMA_VERSION)
        return { ok: false, code: "schema_mismatch" };
    if (!(0, authoritative_source_1.isPlannerRequestedAuthority)(p.source))
        return { ok: false, code: "invalid_source" };
    if (typeof p.generation !== "number" || !Number.isInteger(p.generation) || p.generation < 0) {
        return { ok: false, code: "invalid_generation" };
    }
    if (p.source === "legacy") {
        if (p.planPath !== null)
            return { ok: false, code: "legacy_plan_path_present" };
        return { ok: true, code: null };
    }
    // worker_dryrun
    if (typeof p.planPath !== "string" || p.planPath.length === 0) {
        return { ok: false, code: "missing_plan_path" };
    }
    if (typeof p.planRevision !== "string" || p.planRevision.length === 0) {
        return { ok: false, code: "missing_plan_revision" };
    }
    if (p.planPath.includes(".."))
        return { ok: false, code: "path_traversal" };
    if (isUnder(p.planPath, layout.runtimeCandidateDir)) {
        return { ok: false, code: "plan_path_under_candidate" };
    }
    if (!isUnder(p.planPath, layout.workerCanonicalDir)) {
        return { ok: false, code: "plan_path_outside_worker_canonical" };
    }
    return { ok: true, code: null };
}
exports.validatePointer = validatePointer;
async function writePointerAtomic(layout, pointer) {
    const validation = validatePointer(pointer, layout);
    if (!validation.ok) {
        throw new Error(`invalid_pointer:${validation.code}`);
    }
    const target = layout.activeAuthorityPointerPath;
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    const json = `${JSON.stringify(pointer, null, 2)}\n`;
    await fs.writeFile(tmp, json, { mode: 0o600 });
    await fs.rename(tmp, target);
}
exports.writePointerAtomic = writePointerAtomic;
async function readPointer(layout) {
    try {
        const raw = await fs.readFile(layout.activeAuthorityPointerPath, "utf8");
        const parsed = JSON.parse(raw);
        if (!validatePointer(parsed, layout).ok)
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
exports.readPointer = readPointer;
async function writeLegacyPointer(layout, input) {
    await writePointerAtomic(layout, {
        schemaVersion: constants_1.ACTIVE_AUTHORITY_SCHEMA_VERSION,
        source: "legacy",
        generation: input.generation,
        planPath: null,
        planRevision: null,
        updatedAt: new Date(input.nowMs).toISOString(),
        sessionId: input.sessionId,
    });
}
exports.writeLegacyPointer = writeLegacyPointer;
async function writeWorkerPointer(layout, input) {
    await writePointerAtomic(layout, {
        schemaVersion: constants_1.ACTIVE_AUTHORITY_SCHEMA_VERSION,
        source: "worker_dryrun",
        generation: input.generation,
        planPath: input.planPath,
        planRevision: input.planRevision,
        updatedAt: new Date(input.nowMs).toISOString(),
        sessionId: input.sessionId,
    });
}
exports.writeWorkerPointer = writeWorkerPointer;
