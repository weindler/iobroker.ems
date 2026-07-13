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
exports.writePlannerInputSnapshot = exports.PLANNER_INPUT_SNAPSHOT_FILE = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const node_crypto_1 = require("node:crypto");
const paths_1 = require("../backup_integration/paths");
const atomic_write_1 = require("../persistence/atomic_write");
const paths_2 = require("../planner_paths/paths");
const canonical_1 = require("./canonical");
const constants_1 = require("./constants");
const types_1 = require("./types");
const validate_1 = require("./validate");
exports.PLANNER_INPUT_SNAPSHOT_FILE = "input.json";
function sha256Hex(text) {
    return (0, node_crypto_1.createHash)("sha256").update(text).digest("hex");
}
function assertSafeJobDir(jobDir, runtimeRootDir, durableDataDir) {
    const resolvedJobDir = path.resolve(jobDir);
    const resolvedRuntime = path.resolve(runtimeRootDir);
    (0, paths_1.assertPathWithinRoot)(resolvedJobDir, resolvedRuntime);
    (0, paths_2.assertJobPathNotUnderDurableDataFolder)(resolvedJobDir, durableDataDir);
    if (path.basename(resolvedJobDir).includes("..")) {
        throw new Error("invalid job directory");
    }
    return resolvedJobDir;
}
async function writePlannerInputSnapshot(jobDir, snapshot, options) {
    const safeJobDir = assertSafeJobDir(jobDir, options.runtimeRootDir, options.durableDataDir);
    (0, validate_1.assertSnapshotSerializable)(snapshot);
    (0, validate_1.assertNoForbiddenSnapshotContent)(snapshot);
    const withRevision = {
        ...snapshot,
        inputRevision: (0, canonical_1.computeInputRevision)({ ...snapshot, inputRevision: "" }),
    };
    const json = `${JSON.stringify(withRevision, null, 2)}\n`;
    const byteSize = (0, canonical_1.utf8ByteLength)(json);
    if (byteSize > constants_1.PLANNER_INPUT_SNAPSHOT_BUDGET_BYTES) {
        throw new types_1.PlannerInputSnapshotBudgetError(byteSize, constants_1.PLANNER_INPUT_SNAPSHOT_BUDGET_BYTES);
    }
    const targetPath = path.join(safeJobDir, exports.PLANNER_INPUT_SNAPSHOT_FILE);
    const sha256 = sha256Hex(json);
    await (0, atomic_write_1.atomicWriteFile)(targetPath, json, {
        validate: () => {
            const reread = JSON.parse(json);
            if (!(0, validate_1.validatePlannerInputSnapshotV2)(reread)) {
                throw new Error("written snapshot failed validation");
            }
            if ((0, canonical_1.computeInputRevision)({ ...reread, inputRevision: "" }) !== withRevision.inputRevision) {
                throw new Error("written snapshot revision mismatch");
            }
            if ((0, canonical_1.canonicalSnapshotJson)(reread) !== (0, canonical_1.canonicalSnapshotJson)(withRevision)) {
                throw new Error("written snapshot canonical mismatch");
            }
        },
    });
    const disk = await fs.readFile(targetPath, "utf8");
    if (sha256Hex(disk) !== sha256) {
        throw new Error("post-write sha256 mismatch");
    }
    return {
        path: targetPath,
        byteSize,
        sha256,
        inputRevision: withRevision.inputRevision,
    };
}
exports.writePlannerInputSnapshot = writePlannerInputSnapshot;
