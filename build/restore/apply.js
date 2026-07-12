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
exports.resetRestoreApplyForTest = exports.getActiveRestorePlan = exports.planSummaryJson = exports.clearRestorePlanForTest = exports.runRestoreApply = exports.runRestoreValidate = void 0;
const path = __importStar(require("node:path"));
const operation_lock_1 = require("../backup/operation_lock");
const source_1 = require("./source");
const validate_archive_1 = require("./validate_archive");
const projection_1 = require("./projection");
const plan_1 = require("./plan");
const barrier_1 = require("./barrier");
const journal_1 = require("./journal");
const learning_apply_1 = require("./learning_apply");
const runtime_cleanup_1 = require("./runtime_cleanup");
const rollback_1 = require("./rollback");
const execution_mode_1 = require("../execution_mode");
const diagnostic_mode_1 = require("../support/diagnostic_mode");
const apply_hooks_1 = require("./apply_hooks");
const schema_1 = require("../backup/schema");
const startup_1 = require("../backup_integration/startup");
const manifest_1 = require("../backup_integration/manifest");
const paths_1 = require("../backup_integration/paths");
function currentNative(host) {
    return host.config && typeof host.config === "object" ? { ...host.config } : {};
}
async function forceDryrun(host, config) {
    if (typeof host.updateConfig === "function") {
        await host.updateConfig(config);
    }
    await (0, execution_mode_1.syncExecutionModesFromConfig)(host, config, { forceDryrunReason: "restore_recovery" });
}
async function runRestoreValidate(host, fileName) {
    const lock = (0, operation_lock_1.tryAcquireOperationLock)("restore_validate");
    if (!lock.ok)
        return { ok: false, error: lock.error, status: "error" };
    try {
        (0, plan_1.invalidateRestorePlan)();
        const file = await (0, source_1.readRestoreArchiveFile)(host, fileName);
        const validated = (0, validate_archive_1.validateRestoreArchiveBuffer)(file.buffer);
        const projection = (0, projection_1.buildRestoreProjection)(validated.payloadMap);
        const identity = {
            fileName,
            rootKind: file.rootKind,
            archiveSha256: validated.archiveSha256,
            sizeBytes: file.sizeBytes,
            mtimeMs: file.mtimeMs,
        };
        const changed = (0, projection_1.countChangedConfigFields)(currentNative(host), projection.native);
        const plan = (0, plan_1.createRestorePlan)({
            identity,
            manifest: validated.manifest,
            projection,
            changedConfigFields: changed,
        });
        return { ok: true, status: "ready", planId: plan.planId };
    }
    catch (e) {
        (0, plan_1.invalidateRestorePlan)();
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: msg, status: "error" };
    }
    finally {
        (0, operation_lock_1.releaseOperationLock)();
    }
}
exports.runRestoreValidate = runRestoreValidate;
async function runRestoreApply(host, fileName, confirmPlanId) {
    const lock = (0, operation_lock_1.tryAcquireOperationLock)("restore_apply");
    if (!lock.ok)
        return { ok: false, error: lock.error, status: "error" };
    const txId = (0, journal_1.newTransactionId)();
    let txDir = "";
    (0, barrier_1.setRestoreInProgress)(true);
    try {
        await (0, apply_hooks_1.maybeInjectRestoreApplyFailure)("after_lock");
        (0, diagnostic_mode_1.stopDiagnosticMode)();
        const file = await (0, source_1.readRestoreArchiveFile)(host, fileName);
        const validated = (0, validate_archive_1.validateRestoreArchiveBuffer)(file.buffer);
        const identity = {
            fileName,
            rootKind: file.rootKind,
            archiveSha256: validated.archiveSha256,
            sizeBytes: file.sizeBytes,
            mtimeMs: file.mtimeMs,
        };
        const plan = (0, plan_1.assertPlanMatchesIdentity)(identity, confirmPlanId);
        (0, plan_1.markPlanUsed)();
        await (0, apply_hooks_1.maybeInjectRestoreApplyFailure)("after_barrier");
        txDir = await (0, journal_1.ensureTransactionLayout)(host, txId);
        const layout = (0, paths_1.resolveEmsPaths)(host);
        let manifest = await (0, startup_1.readManifestFromDisk)(layout.manifestPath);
        if (!manifest) {
            throw new Error("manifest_missing");
        }
        manifest = (0, manifest_1.validateManifest)(manifest);
        manifest = await (0, manifest_1.beginRestoreTransactionFence)(layout.manifestPath, manifest, txId);
        const beforeNative = (0, projection_1.exportCurrentNativeProjection)(currentNative(host));
        await (0, journal_1.writeJsonFileAtomic)(path.join(txDir, "before", "native_projection.json"), beforeNative);
        const learningBefore = await (0, learning_apply_1.snapshotLearningFiles)(host);
        await (0, learning_apply_1.writeLearningSnapshot)(txDir, "before", learningBefore);
        let journal = (0, journal_1.createJournal)({
            transactionId: txId,
            archiveFileName: fileName,
            archiveSha256: validated.archiveSha256,
            phase: "prepared",
            manifest,
        });
        await (0, journal_1.writeJournalAtomic)(txDir, journal);
        await (0, apply_hooks_1.maybeInjectRestoreApplyFailure)("after_before_snapshot");
        const stagedNative = plan.projection.native;
        await (0, journal_1.writeJsonFileAtomic)(path.join(txDir, "staged", "native_projection.json"), stagedNative);
        for (const [key, content] of Object.entries(plan.projection.learning)) {
            await (0, journal_1.writeJsonFileAtomic)(path.join(txDir, "staged", "learning", key), content);
        }
        await (0, apply_hooks_1.maybeInjectRestoreApplyFailure)("after_staged_write");
        const merged = (0, projection_1.mergeNativeForRestore)(currentNative(host), stagedNative);
        await forceDryrun(host, merged);
        await (0, journal_1.updateJournalPhase)(txDir, "dryrun_locked");
        await (0, apply_hooks_1.maybeInjectRestoreApplyFailure)("after_dryrun_lock");
        if (typeof host.updateConfig !== "function") {
            throw new Error("updateConfig unavailable");
        }
        await host.updateConfig(merged);
        const after = currentNative(host);
        if ((0, schema_1.stableJsonStringify)((0, projection_1.mergeNativeForRestore)(after, stagedNative)).trim() !== (0, schema_1.stableJsonStringify)(merged).trim()) {
            throw new Error("native projection verify failed");
        }
        await (0, journal_1.updateJournalPhase)(txDir, "config_applied");
        await (0, apply_hooks_1.maybeInjectRestoreApplyFailure)("after_native_apply");
        await (0, learning_apply_1.applyLearningFromStaged)(host, txDir, plan.projection.learning);
        await (0, journal_1.updateJournalPhase)(txDir, "learning_applied");
        await (0, runtime_cleanup_1.runRestoreRuntimeCleanup)(host);
        await (0, journal_1.updateJournalPhase)(txDir, "runtime_cleared");
        await (0, apply_hooks_1.maybeInjectRestoreApplyFailure)("after_runtime_cleanup");
        (0, barrier_1.setRestoreRestartRequired)(true);
        await (0, apply_hooks_1.maybeInjectRestoreApplyFailure)("after_restart_required");
        await (0, apply_hooks_1.maybeInjectRestoreApplyFailure)("before_committed_journal");
        await (0, journal_1.updateJournalPhase)(txDir, "committed");
        await (0, manifest_1.finalizeRestoreTransactionFence)(layout.manifestPath, manifest, "committed");
        return { ok: true, status: "success_restart_required", transactionId: txId, planId: plan.planId };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (txDir) {
            try {
                await (0, rollback_1.runRestoreRollback)(host, txDir);
                (0, plan_1.invalidateRestorePlan)();
                (0, barrier_1.setRestoreInProgress)(false);
                return { ok: false, error: msg, status: "rolled_back" };
            }
            catch {
                await (0, journal_1.updateJournalPhase)(txDir, "failed").catch(() => undefined);
                (0, plan_1.invalidateRestorePlan)();
                return { ok: false, error: "restore_rollback_failed", status: "recovery_failed" };
            }
        }
        (0, plan_1.invalidateRestorePlan)();
        (0, barrier_1.setRestoreInProgress)(false);
        return { ok: false, error: msg, status: "error" };
    }
    finally {
        (0, operation_lock_1.releaseOperationLock)();
    }
}
exports.runRestoreApply = runRestoreApply;
var plan_2 = require("./plan");
Object.defineProperty(exports, "clearRestorePlanForTest", { enumerable: true, get: function () { return plan_2.clearRestorePlanForTest; } });
Object.defineProperty(exports, "planSummaryJson", { enumerable: true, get: function () { return plan_2.planSummaryJson; } });
Object.defineProperty(exports, "getActiveRestorePlan", { enumerable: true, get: function () { return plan_2.getActiveRestorePlan; } });
function resetRestoreApplyForTest() {
    (0, plan_1.clearRestorePlanForTest)();
    (0, barrier_1.setRestoreInProgress)(false);
    (0, barrier_1.setRestoreRestartRequired)(false);
}
exports.resetRestoreApplyForTest = resetRestoreApplyForTest;
