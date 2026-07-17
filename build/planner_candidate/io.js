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
exports.readPlanCandidateFile = exports.writePlanCandidateAtomic = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const hash_1 = require("../planner_repository/hash");
const types_1 = require("./types");
async function writePlanCandidateAtomic(dir, candidate) {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const target = path.join(dir, types_1.PLANNER_CANDIDATE_FILE);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    const json = `${JSON.stringify(candidate, null, 2)}\n`;
    const byteSize = Buffer.byteLength(json, "utf8");
    if (byteSize > types_1.PLANNER_CANDIDATE_BUDGET_BYTES) {
        throw new Error(`candidate_budget_exceeded:${byteSize}`);
    }
    await fs.writeFile(tmp, json, { mode: 0o600 });
    await fs.rename(tmp, target);
    return { path: target, byteSize, sha256: (0, hash_1.sha256Hex)(json) };
}
exports.writePlanCandidateAtomic = writePlanCandidateAtomic;
async function readPlanCandidateFile(dir) {
    const raw = await fs.readFile(path.join(dir, types_1.PLANNER_CANDIDATE_FILE), "utf8");
    const byteSize = Buffer.byteLength(raw, "utf8");
    if (byteSize > types_1.PLANNER_CANDIDATE_BUDGET_BYTES) {
        throw new Error(`candidate_budget_exceeded:${byteSize}`);
    }
    const parsed = JSON.parse(raw);
    if (parsed?.schemaVersion !== 1 || typeof parsed.candidateRevision !== "string") {
        throw new Error("candidate_invalid_schema");
    }
    return parsed;
}
exports.readPlanCandidateFile = readPlanCandidateFile;
