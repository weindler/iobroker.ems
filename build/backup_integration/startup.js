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
exports.updateBootGuardAfterBootstrap = exports.readManifestFromDisk = exports.runBackupIntegrationStartup = exports.runLegacyRestoreRecoveryBeforeMigration = exports.resetBackupIntegrationContextForTest = exports.getBackupIntegrationContext = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const journal_1 = require("../restore/journal");
const startup_recovery_1 = require("../restore/startup_recovery");
const barrier_1 = require("../restore/barrier");
const dryrun_context_1 = require("../restore/dryrun_context");
const boot_guard_1 = require("./boot_guard");
const ensure_states_1 = require("./ensure_states");
const manifest_1 = require("./manifest");
const migration_1 = require("./migration");
const journal_validation_1 = require("./journal_validation");
const fence_validation_1 = require("./fence_validation");
const paths_1 = require("./paths");
const startup_rearm_1 = require("./startup_rearm");
let lastContext = null;
function getBackupIntegrationContext() {
    return lastContext;
}
exports.getBackupIntegrationContext = getBackupIntegrationContext;
function resetBackupIntegrationContextForTest() {
    lastContext = null;
}
exports.resetBackupIntegrationContextForTest = resetBackupIntegrationContextForTest;
async function ensureRuntimeDirs(layout) {
    const dirs = [
        layout.runtimeIntentDir,
        layout.runtimeGlobalModesDir,
        layout.runtimeAddonDir("immersion_heater"),
        layout.runtimeAddonDir("air_conditioning"),
        layout.runtimeExportsDir,
        path.join(layout.runtimeExportsDir, "backup"),
        path.join(layout.runtimeExportsDir, "support"),
        path.join(layout.runtimeExportsDir, "support", "logs"),
        layout.runtimeRestoreInboxDir,
        layout.runtimeTransactionsDir,
        layout.runtimeRecoveryDir,
        layout.runtimeQuarantineDir,
        layout.runtimeTempDir,
        path.join(layout.durableDataDir, "migration"),
    ];
    const readableRoots = new Set([
        layout.runtimeExportsDir,
        path.join(layout.runtimeExportsDir, "backup"),
        path.join(layout.runtimeExportsDir, "support"),
        path.join(layout.runtimeExportsDir, "support", "logs"),
        layout.runtimeRestoreInboxDir,
    ]);
    for (const dir of dirs) {
        const mode = readableRoots.has(dir) ? 0o755 : 0o700;
        await fs.mkdir(dir, { recursive: true, mode });
        if (readableRoots.has(dir)) {
            await fs.chmod(dir, 0o755).catch(() => undefined);
        }
    }
    const { applyReadableExportDirs } = await import("../backup/export_permissions.js");
    await applyReadableExportDirs([
        path.join(layout.runtimeExportsDir, "backup"),
        path.join(layout.runtimeExportsDir, "support"),
        layout.runtimeRestoreInboxDir,
    ]);
}
async function quarantineJournalDir(layout, journalDir) {
    const base = path.basename(journalDir);
    const target = path.join(layout.runtimeQuarantineDir, `${base}-${Date.now()}`);
    await fs.rename(journalDir, target).catch(async () => {
        await fs.rm(journalDir, { recursive: true, force: true }).catch(() => undefined);
    });
}
async function validateJournals(layout, manifest, restoreDetection) {
    const scan = await (0, journal_1.scanRestoreTransactionsAtStartup)(layout.runtimeTransactionsDir);
    let journalStatus = "none";
    for (const { dir, journal } of [...scan.failed, ...scan.active, ...scan.rolledBack]) {
        if (!journal) {
            await quarantineJournalDir(layout, dir);
            journalStatus = "quarantined";
            continue;
        }
        if ((0, journal_validation_1.shouldQuarantineLegacyJournal)(journal, restoreDetection)) {
            await quarantineJournalDir(layout, dir);
            journalStatus = "quarantined";
            continue;
        }
        const check = (0, journal_validation_1.validateBoundJournal)(journal, manifest, manifest.namespace, manifest.instance);
        if (!check.ok) {
            await quarantineJournalDir(layout, dir);
            journalStatus = "quarantined";
            continue;
        }
        if (journal.phase === "rolled_back") {
            journalStatus = "recovering";
        }
        else if (scan.active.length > 0) {
            journalStatus = "valid";
        }
    }
    return journalStatus;
}
async function runLegacyRestoreRecoveryBeforeMigration(host) {
    const layout = (0, paths_1.resolveEmsPaths)(host);
    if (!(await fs.access(layout.legacyTransactionsDir).then(() => true).catch(() => false))) {
        return;
    }
    const scan = await (0, journal_1.scanRestoreTransactionsAtStartup)(layout.legacyTransactionsDir);
    const hasWork = scan.failed.length > 0 || scan.active.length > 0 || scan.rolledBack.length > 0;
    if (!hasWork) {
        return;
    }
    await (0, startup_recovery_1.runRestoreStartupRecoveryAtPath)(host, layout.legacyTransactionsDir);
}
exports.runLegacyRestoreRecoveryBeforeMigration = runLegacyRestoreRecoveryBeforeMigration;
async function runBackupIntegrationStartup(host) {
    const layout = (0, paths_1.resolveEmsPaths)(host);
    await ensureRuntimeDirs(layout);
    (0, startup_rearm_1.setStartupRearmRequired)(false);
    (0, barrier_1.setRestoreInProgress)(true);
    (0, dryrun_context_1.setPendingForceDryrunReason)(null);
    await (0, ensure_states_1.ensureBackupIntegrationInfoStates)(host);
    await runLegacyRestoreRecoveryBeforeMigration(host);
    const migrationResult = await (0, migration_1.runRuntimeMigration)(layout, {
        skipTransactions: false,
    });
    let manifest = null;
    let manifestValid = false;
    let manifestError = "";
    try {
        manifest = await readManifestFromDisk(layout.manifestPath);
        if (manifest) {
            (0, manifest_1.validateManifest)(manifest);
            manifestValid = true;
        }
    }
    catch (e) {
        manifestError = e instanceof Error ? e.message : String(e);
    }
    if (!manifest && manifestValid === false && !manifestError) {
        const instance = (0, paths_1.parseInstanceFromNamespace)(host.namespace);
        manifest = (0, manifest_1.createInitialManifest)({
            instance,
            namespace: host.namespace,
            adapterVersion: String(host.common?.version ?? "0.1.143"),
        });
        await (0, manifest_1.writeManifestAtomic)(layout.manifestPath, manifest);
        manifestValid = true;
        manifestError = "";
    }
    const bootGuard = manifest ? await (0, boot_guard_1.readBootGuard)(layout.bootGuardPath) : null;
    let restoreDetection = "manifest_invalid";
    if (manifest && manifestValid) {
        restoreDetection = (0, boot_guard_1.diagnoseRestoreDetection)({
            bootGuard,
            manifestEpoch: manifest.dataEpoch,
            manifestGeneration: manifest.checkpointGeneration,
            manifestCheckpointId: manifest.checkpointId,
        });
        if (manifestError.includes("manifest_invalid")) {
            restoreDetection = "manifest_invalid";
        }
    }
    if (!migrationResult.ok) {
        restoreDetection = "migration_failed";
    }
    let journalStatus = "none";
    if (manifest && manifestValid) {
        const fenceEval = await (0, fence_validation_1.evaluateTransactionFenceAtStartup)(manifest, layout.runtimeTransactionsDir);
        if (!fenceEval.ok) {
            manifestError = manifestError || fenceEval.reason;
            restoreDetection = "manifest_invalid";
            manifestValid = false;
            if (fenceEval.reason.startsWith("orphan_fence")) {
                manifest = await (0, fence_validation_1.clearOrphanTransactionFence)(layout.manifestPath, manifest);
            }
        }
        journalStatus = await validateJournals(layout, manifest, restoreDetection);
        if (journalStatus === "quarantined") {
            restoreDetection = "journal_quarantined";
        }
    }
    const migrationRecord = await (0, migration_1.readMigrationStatus)(layout.migrationStatusPath);
    const migrationStatus = migrationRecord?.status ?? migrationResult.status;
    const legacyRemain = await (0, migration_1.legacyRuntimePathsRemain)(layout);
    const ctx = {
        layout,
        manifest,
        restoreDetection,
        migrationStatus,
        journalStatus,
        manifestValid: manifestValid && legacyRemain.length === 0 && migrationResult.ok,
        manifestError: manifestError || (legacyRemain.length ? `legacy_runtime_remain:${legacyRemain.join(",")}` : migrationResult.error ?? ""),
    };
    lastContext = ctx;
    await (0, ensure_states_1.publishBackupIntegrationDiagnostics)(host, {
        dataFolder: "ems.%INSTANCE%",
        runtimeFolder: "ems-runtime.%INSTANCE%",
        formatVersion: manifest?.formatVersion ?? 0,
        persistenceSchemaVersion: manifest?.persistenceSchemaVersion ?? 0,
        persistenceValid: ctx.manifestValid,
        lastValidationError: ctx.manifestError,
        restoreDetection,
        checkpointGeneration: manifest?.checkpointGeneration ?? 0,
        journalStatus,
        migrationStatus,
        liveRearmRequired: false,
    });
    return ctx;
}
exports.runBackupIntegrationStartup = runBackupIntegrationStartup;
async function readManifestFromDisk(manifestPath) {
    try {
        const raw = await fs.readFile(manifestPath, "utf8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
exports.readManifestFromDisk = readManifestFromDisk;
async function updateBootGuardAfterBootstrap(host, manifest) {
    const layout = (0, paths_1.resolveEmsPaths)(host);
    const record = {
        dataEpoch: manifest.dataEpoch,
        highestCheckpointGeneration: manifest.checkpointGeneration,
        checkpointId: manifest.checkpointId,
        adapterVersion: String(host.common?.version ?? manifest.adapterVersion),
        lastSuccessfulBootstrapAt: new Date().toISOString(),
    };
    const { writeBootGuardAtomic } = await import("./boot_guard.js");
    await writeBootGuardAtomic(layout.bootGuardPath, record);
}
exports.updateBootGuardAfterBootstrap = updateBootGuardAfterBootstrap;
