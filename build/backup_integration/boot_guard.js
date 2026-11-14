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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.readBootGuard = readBootGuard;
exports.writeBootGuardAtomic = writeBootGuardAtomic;
exports.diagnoseRestoreDetection = diagnoseRestoreDetection;
const fs = __importStar(require("node:fs/promises"));
const atomic_write_1 = require("../persistence/atomic_write");
const schema_1 = require("../backup/schema");
async function readBootGuard(bootGuardPath) {
    try {
        const raw = await fs.readFile(bootGuardPath, "utf8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
async function writeBootGuardAtomic(bootGuardPath, record) {
    await (0, atomic_write_1.atomicWriteJson)(bootGuardPath, record, schema_1.stableJsonStringify);
}
function diagnoseRestoreDetection(input) {
    if (!input.bootGuard) {
        return "first_start";
    }
    if (input.bootGuard.dataEpoch !== input.manifestEpoch) {
        return "foreign_timeline";
    }
    if (input.manifestGeneration < input.bootGuard.highestCheckpointGeneration) {
        return "rollback_suspected";
    }
    if (input.manifestGeneration === input.bootGuard.highestCheckpointGeneration &&
        input.manifestCheckpointId === input.bootGuard.checkpointId) {
        return "normal_restart";
    }
    return "none";
}
