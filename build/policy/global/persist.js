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
exports.readGlobalPolicyPersistRevision = exports.writeGlobalPolicyPersist = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
async function writeGlobalPolicyPersist(baseDir, payload) {
    await fs.mkdir(baseDir, { recursive: true });
    await fs.writeFile(path.join(baseDir, "policy_global_v1.json"), `${JSON.stringify({ module: "policy_global_v1", ...payload }, null, 2)}\n`, "utf8");
}
exports.writeGlobalPolicyPersist = writeGlobalPolicyPersist;
async function readGlobalPolicyPersistRevision(baseDir) {
    try {
        const raw = await fs.readFile(path.join(baseDir, "policy_global_v1.json"), "utf8");
        const parsed = JSON.parse(raw);
        return typeof parsed.revision === "string" ? parsed.revision : null;
    }
    catch {
        return null;
    }
}
exports.readGlobalPolicyPersistRevision = readGlobalPolicyPersistRevision;
