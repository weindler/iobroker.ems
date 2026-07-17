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
exports.publishWorkerCanonicalFromCandidate = exports.WorkerPublishError = void 0;
const node_crypto_1 = require("node:crypto");
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const types_1 = require("../planner_candidate/types");
const permit_1 = require("../planner_publish/permit");
class WorkerPublishError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
        this.name = "WorkerPublishError";
    }
}
exports.WorkerPublishError = WorkerPublishError;
function sha256(text) {
    return (0, node_crypto_1.createHash)("sha256").update(text, "utf8").digest("hex");
}
/**
 * Publish a validated candidate as the worker canonical plan under the runtime
 * worker canonical generation dir. Verifies the permit, writes atomically, reads
 * back, verifies revision + content hash, then consumes the permit.
 * Throws WorkerPublishError with a code on any failure so callers can fall back.
 */
async function publishWorkerCanonicalFromCandidate(input) {
    const { candidate, generation, layout, permit } = input;
    const nowMs = input.nowMs ?? Date.now();
    if (!(0, permit_1.isCanonicalPublishPermit)(permit))
        throw new WorkerPublishError("permit_invalid");
    if (permit.consumed)
        throw new WorkerPublishError("permit_consumed");
    if ((0, permit_1.permitExpired)(permit, nowMs))
        throw new WorkerPublishError("permit_expired");
    if (permit.scope !== "worker_dryrun" || permit.executionMode !== "dryrun") {
        throw new WorkerPublishError("permit_scope_invalid");
    }
    if (permit.generation !== generation)
        throw new WorkerPublishError("generation_mismatch");
    if (permit.candidateRevision !== candidate.candidateRevision) {
        throw new WorkerPublishError("candidate_revision_mismatch");
    }
    if (permit.planRevision !== candidate.candidateRevision) {
        throw new WorkerPublishError("plan_revision_mismatch");
    }
    // Independent integrity check: recompute candidate revision from content.
    const { candidateRevision, generatedAt, ...rest } = candidate;
    void generatedAt;
    const recomputed = (0, types_1.computeCandidateRevision)(rest);
    if (recomputed !== candidateRevision)
        throw new WorkerPublishError("candidate_hash_mismatch");
    const planPath = layout.workerCanonicalPlanPath(generation);
    const dir = path.dirname(planPath);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const json = `${JSON.stringify(candidate, null, 2)}\n`;
    const contentSha256 = sha256(json);
    const tmp = `${planPath}.${process.pid}.${nowMs}.tmp`;
    await fs.writeFile(tmp, json, { mode: 0o600 });
    await fs.rename(tmp, planPath);
    // Read back and verify.
    const readBack = await fs.readFile(planPath, "utf8");
    if (sha256(readBack) !== contentSha256)
        throw new WorkerPublishError("readback_hash_mismatch");
    let parsed;
    try {
        parsed = JSON.parse(readBack);
    }
    catch {
        throw new WorkerPublishError("readback_parse_failed");
    }
    if (parsed.candidateRevision !== candidate.candidateRevision) {
        throw new WorkerPublishError("readback_revision_mismatch");
    }
    if (!(0, permit_1.consumePermit)(permit))
        throw new WorkerPublishError("permit_consume_failed");
    return { planPath, planRevision: candidate.candidateRevision, contentSha256 };
}
exports.publishWorkerCanonicalFromCandidate = publishWorkerCanonicalFromCandidate;
