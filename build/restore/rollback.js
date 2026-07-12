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
exports.readTransactionJournal = exports.runRestoreRollback = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const projection_1 = require("./projection");
const journal_1 = require("./journal");
const learning_apply_1 = require("./learning_apply");
const execution_mode_1 = require("../execution_mode");
const runtime_cleanup_1 = require("./runtime_cleanup");
const apply_hooks_1 = require("./apply_hooks");
const paths_1 = require("../backup_integration/paths");
const startup_1 = require("../backup_integration/startup");
const manifest_1 = require("../backup_integration/manifest");
async function runRestoreRollback(host, txDir) {
    await (0, journal_1.updateJournalPhase)(txDir, "rollback_running");
    const beforePath = path.join(txDir, "before", "native_projection.json");
    const raw = await fs.readFile(beforePath, "utf8");
    const beforeNative = JSON.parse(raw);
    const current = host.config && typeof host.config === "object" ? host.config : {};
    const merged = (0, projection_1.mergeNativeForRestore)(current, beforeNative);
    for (const k of ["global_execution_mode", "wb_addon_mode", "bat_addon_mode", "ih_addon_mode", "ac_addon_mode"]) {
        merged[k] = "dryrun";
    }
    if (typeof host.updateConfig === "function") {
        await (0, apply_hooks_1.maybeInjectRestoreRollbackFailure)("native_restore");
        await host.updateConfig(merged);
    }
    await (0, execution_mode_1.syncExecutionModesFromConfig)(host, merged, { forceDryrunReason: "restore_recovery" });
    await (0, apply_hooks_1.maybeInjectRestoreRollbackFailure)("learning_restore");
    await (0, learning_apply_1.restoreLearningFromSnapshot)(host, txDir, "before");
    await (0, runtime_cleanup_1.runRestoreRuntimeCleanup)(host);
    await (0, journal_1.updateJournalPhase)(txDir, "rolled_back");
    const layout = (0, paths_1.resolveEmsPaths)(host);
    const manifestRaw = await (0, startup_1.readManifestFromDisk)(layout.manifestPath);
    if (manifestRaw?.transactionFence) {
        const manifest = (0, manifest_1.validateManifest)(manifestRaw);
        await (0, manifest_1.finalizeRestoreTransactionFence)(layout.manifestPath, manifest, "rolled_back");
    }
}
exports.runRestoreRollback = runRestoreRollback;
async function readTransactionJournal(txDir) {
    return (0, journal_1.readJournal)(txDir);
}
exports.readTransactionJournal = readTransactionJournal;
