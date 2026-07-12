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
exports.clearRestoreRestartRequiredAfterBootstrap = exports.cleanupFinishedRestoreTransactions = exports.runRestoreStartupRecovery = void 0;
const fs = __importStar(require("node:fs/promises"));
const journal_1 = require("./journal");
const rollback_1 = require("./rollback");
const runtime_cleanup_1 = require("./runtime_cleanup");
const barrier_1 = require("./barrier");
const execution_mode_1 = require("../execution_mode");
const dryrun_context_1 = require("./dryrun_context");
const ensure_states_1 = require("../backup/ensure_states");
async function persistRestoreRecoveryDryrun(host) {
    const config = host.config && typeof host.config === "object" ? host.config : {};
    await (0, execution_mode_1.syncExecutionModesFromConfig)(host, config, { forceDryrunReason: "restore_recovery" });
}
async function markStartupRecoveryBlocked(host, error) {
    (0, barrier_1.setRestoreInProgress)(true);
    (0, dryrun_context_1.setPendingForceDryrunReason)("restore_recovery");
    (0, barrier_1.setRestoreRestartRequired)(true);
    await persistRestoreRecoveryDryrun(host);
    await host.setStateAsync(ensure_states_1.RESTORE_STATES.status, { val: "recovery_failed", ack: true });
    await host.setStateAsync(ensure_states_1.RESTORE_STATES.lastError, { val: error, ack: true });
    await host.setStateAsync(ensure_states_1.RESTORE_STATES.lastResult, { val: "failed", ack: true });
    await host.setStateAsync(ensure_states_1.RESTORE_STATES.restartRequired, { val: true, ack: true });
}
async function runRolledBackFollowUp(host) {
    (0, barrier_1.setRestoreInProgress)(true);
    (0, dryrun_context_1.setPendingForceDryrunReason)("restore_recovery");
    await persistRestoreRecoveryDryrun(host);
    await (0, runtime_cleanup_1.runRestoreRuntimeCleanup)(host);
    return { ok: true, action: "finalized_rolled_back" };
}
async function runRestoreStartupRecovery(host) {
    const dataDir = typeof host.getAbsoluteInstanceDataDir === "function" ? host.getAbsoluteInstanceDataDir() : null;
    if (!dataDir)
        return { ok: true, action: "none" };
    const scan = await (0, journal_1.scanRestoreTransactionsAtStartup)(dataDir);
    if (scan.failed.length > 0) {
        await markStartupRecoveryBlocked(host, "restore_transaction_failed");
        return { ok: false, error: "restore_transaction_failed" };
    }
    if (scan.active.length > 1) {
        await markStartupRecoveryBlocked(host, "multiple_incomplete_restore_transactions");
        return { ok: false, error: "multiple_incomplete_restore_transactions" };
    }
    if (scan.active.length === 1) {
        const { dir, journal } = scan.active[0];
        (0, barrier_1.setRestoreInProgress)(true);
        (0, dryrun_context_1.setPendingForceDryrunReason)("restore_recovery");
        await persistRestoreRecoveryDryrun(host);
        if (journal.phase === "committed") {
            await (0, runtime_cleanup_1.runRestoreRuntimeCleanup)(host);
            (0, barrier_1.setRestoreRestartRequired)(true);
            await host.setStateAsync(ensure_states_1.RESTORE_STATES.restartRequired, { val: true, ack: true });
            return { ok: true, action: "finalized_committed" };
        }
        try {
            await (0, rollback_1.runRestoreRollback)(host, dir);
            return { ok: true, action: "rolled_back" };
        }
        catch {
            await markStartupRecoveryBlocked(host, "restore_rollback_failed");
            return { ok: false, error: "restore_rollback_failed" };
        }
    }
    if (scan.rolledBack.length > 1) {
        await markStartupRecoveryBlocked(host, "multiple_rolled_back_followup_transactions");
        return { ok: false, error: "multiple_rolled_back_followup_transactions" };
    }
    if (scan.rolledBack.length === 1) {
        return runRolledBackFollowUp(host);
    }
    return { ok: true, action: "none" };
}
exports.runRestoreStartupRecovery = runRestoreStartupRecovery;
async function cleanupFinishedRestoreTransactions(instanceDataDir) {
    const scan = await (0, journal_1.scanRestoreTransactionsAtStartup)(instanceDataDir);
    for (const { dir, journal } of scan.active) {
        if (journal.phase === "committed") {
            await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
        }
    }
    for (const { dir } of scan.rolledBack) {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
}
exports.cleanupFinishedRestoreTransactions = cleanupFinishedRestoreTransactions;
async function clearRestoreRestartRequiredAfterBootstrap(host) {
    const dataDir = typeof host.getAbsoluteInstanceDataDir === "function" ? host.getAbsoluteInstanceDataDir() : null;
    if (dataDir) {
        await cleanupFinishedRestoreTransactions(dataDir);
    }
    (0, barrier_1.setRestoreRestartRequired)(false);
    (0, barrier_1.setRestoreInProgress)(false);
    (0, dryrun_context_1.clearPendingForceDryrunReason)();
    await host.setStateAsync(ensure_states_1.RESTORE_STATES.restartRequired, { val: false, ack: true });
}
exports.clearRestoreRestartRequiredAfterBootstrap = clearRestoreRestartRequiredAfterBootstrap;
