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
exports.readGlobalModesPersistRevision = exports.writeGlobalModesPersist = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
async function writeGlobalModesPersist(baseDir, payload) {
    await fs.mkdir(baseDir, { recursive: true });
    const filePath = path.join(baseDir, "global_modes_v1.json");
    await fs.writeFile(filePath, `${JSON.stringify({
        module: "global_modes_v1",
        requested: payload.requested,
        active: payload.active,
        valid: payload.valid,
        status: payload.status,
        revision: payload.revision,
        issues: payload.issues,
    }, null, 2)}\n`, "utf8");
}
exports.writeGlobalModesPersist = writeGlobalModesPersist;
async function readGlobalModesPersistRevision(baseDir) {
    try {
        const raw = await fs.readFile(path.join(baseDir, "global_modes_v1.json"), "utf8");
        const parsed = JSON.parse(raw);
        return typeof parsed.revision === "string" ? parsed.revision : null;
    }
    catch {
        return null;
    }
}
exports.readGlobalModesPersistRevision = readGlobalModesPersistRevision;
