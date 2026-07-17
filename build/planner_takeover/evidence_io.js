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
exports.readTakeoverEvidenceFile = exports.writeTakeoverEvidenceAtomic = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const hash_1 = require("../planner_repository/hash");
const constants_1 = require("./constants");
const evidence_1 = require("./evidence");
const constants_2 = require("./constants");
async function writeTakeoverEvidenceAtomic(dir, evidence) {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const target = path.join(dir, constants_1.TAKEOVER_EVIDENCE_FILE);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    const sealed = evidence.evidenceRevision
        ? evidence
        : (0, evidence_1.sealEvidence)(evidence);
    const json = `${JSON.stringify(sealed, null, 2)}\n`;
    const byteSize = Buffer.byteLength(json, "utf8");
    if (byteSize > constants_1.TAKEOVER_EVIDENCE_BUDGET_BYTES) {
        throw new Error(`evidence_budget_exceeded:${byteSize}`);
    }
    await fs.writeFile(tmp, json, { mode: 0o600 });
    await fs.rename(tmp, target);
    return { path: target, byteSize, sha256: (0, hash_1.sha256Hex)(json) };
}
exports.writeTakeoverEvidenceAtomic = writeTakeoverEvidenceAtomic;
async function readTakeoverEvidenceFile(dir, policy = constants_2.DEFAULT_TAKEOVER_READINESS_POLICY) {
    const target = path.join(dir, constants_1.TAKEOVER_EVIDENCE_FILE);
    try {
        const raw = await fs.readFile(target, "utf8");
        const byteSize = Buffer.byteLength(raw, "utf8");
        if (byteSize > constants_1.TAKEOVER_EVIDENCE_BUDGET_BYTES) {
            return {
                evidence: (0, evidence_1.sealEvidence)({
                    ...(0, evidence_1.emptyTakeoverEvidence)(policy),
                    state: "collecting",
                    lastBlockReason: "policy_reset",
                }),
                resetReason: "budget_exceeded",
            };
        }
        const parsed = JSON.parse(raw);
        return (0, evidence_1.reconcileLoadedEvidence)(parsed, policy);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("ENOENT")) {
            return {
                evidence: (0, evidence_1.sealEvidence)({ ...(0, evidence_1.emptyTakeoverEvidence)(policy), state: "not_evaluated" }),
                resetReason: "missing",
            };
        }
        return {
            evidence: (0, evidence_1.sealEvidence)({
                ...(0, evidence_1.emptyTakeoverEvidence)(policy),
                state: "collecting",
                lastBlockReason: "policy_reset",
            }),
            resetReason: "corrupt",
        };
    }
}
exports.readTakeoverEvidenceFile = readTakeoverEvidenceFile;
