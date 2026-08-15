import * as fs from "node:fs/promises";
import * as path from "node:path";
import { scanRestoreTransactionsAtStartup } from "../restore/journal";
import { runRestoreStartupRecoveryAtPath } from "../restore/startup_recovery";
import { setRestoreInProgress } from "../restore/barrier";
import { setPendingForceDryrunReason } from "../restore/dryrun_context";
import { diagnoseRestoreDetection, readBootGuard, type RestoreDetection } from "./boot_guard";
import { ensureBackupIntegrationInfoStates, publishBackupIntegrationDiagnostics } from "./ensure_states";
import {
	createInitialManifest,
	validateManifest,
	writeManifestAtomic,
	type EmsInstanceManifest,
} from "./manifest";
import { legacyRuntimePathsRemain, readMigrationStatus, runRuntimeMigration } from "./migration";
import { shouldQuarantineLegacyJournal, validateBoundJournal } from "./journal_validation";
import { evaluateTransactionFenceAtStartup, clearOrphanTransactionFence } from "./fence_validation";
import { parseInstanceFromNamespace, resolveEmsPaths, type EmsPathLayout } from "./paths";
import { setStartupRearmRequired } from "./startup_rearm";
import type { RestoreHost } from "../restore/types";

export interface BackupIntegrationContext {
	layout: EmsPathLayout;
	manifest: EmsInstanceManifest | null;
	restoreDetection: RestoreDetection;
	migrationStatus: string;
	journalStatus: string;
	manifestValid: boolean;
	manifestError: string;
}

let lastContext: BackupIntegrationContext | null = null;

export function getBackupIntegrationContext(): BackupIntegrationContext | null {
	return lastContext;
}

export function resetBackupIntegrationContextForTest(): void {
	lastContext = null;
}

async function ensureRuntimeDirs(layout: EmsPathLayout): Promise<void> {
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
	for (const dir of dirs) {
		await fs.mkdir(dir, { recursive: true, mode: 0o700 });
	}
}

async function quarantineJournalDir(layout: EmsPathLayout, journalDir: string): Promise<void> {
	const base = path.basename(journalDir);
	const target = path.join(layout.runtimeQuarantineDir, `${base}-${Date.now()}`);
	await fs.rename(journalDir, target).catch(async () => {
		await fs.rm(journalDir, { recursive: true, force: true }).catch(() => undefined);
	});
}

async function validateJournals(
	layout: EmsPathLayout,
	manifest: EmsInstanceManifest,
	restoreDetection: RestoreDetection,
): Promise<string> {
	const scan = await scanRestoreTransactionsAtStartup(layout.runtimeTransactionsDir);
	let journalStatus = "none";

	for (const { dir, journal } of [...scan.failed, ...scan.active, ...scan.rolledBack]) {
		if (!journal) {
			await quarantineJournalDir(layout, dir);
			journalStatus = "quarantined";
			continue;
		}
		if (shouldQuarantineLegacyJournal(journal, restoreDetection)) {
			await quarantineJournalDir(layout, dir);
			journalStatus = "quarantined";
			continue;
		}
		const check = validateBoundJournal(journal, manifest, manifest.namespace, manifest.instance);
		if (!check.ok) {
			await quarantineJournalDir(layout, dir);
			journalStatus = "quarantined";
			continue;
		}
		if (journal.phase === "rolled_back") {
			journalStatus = "recovering";
		} else if (scan.active.length > 0) {
			journalStatus = "valid";
		}
	}
	return journalStatus;
}

export async function runLegacyRestoreRecoveryBeforeMigration(host: RestoreHost): Promise<void> {
	const layout = resolveEmsPaths(host);
	if (!(await fs.access(layout.legacyTransactionsDir).then(() => true).catch(() => false))) {
		return;
	}
	const scan = await scanRestoreTransactionsAtStartup(layout.legacyTransactionsDir);
	const hasWork =
		scan.failed.length > 0 || scan.active.length > 0 || scan.rolledBack.length > 0;
	if (!hasWork) {
		return;
	}
	await runRestoreStartupRecoveryAtPath(host, layout.legacyTransactionsDir);
}

export async function runBackupIntegrationStartup(host: RestoreHost): Promise<BackupIntegrationContext> {
	const layout = resolveEmsPaths(host);
	await ensureRuntimeDirs(layout);

	setStartupRearmRequired(false);
	setRestoreInProgress(true);
	setPendingForceDryrunReason(null);

	await ensureBackupIntegrationInfoStates(host);

	await runLegacyRestoreRecoveryBeforeMigration(host);

	const migrationResult = await runRuntimeMigration(layout, {
		skipTransactions: false,
	});

	let manifest: EmsInstanceManifest | null = null;
	let manifestValid = false;
	let manifestError = "";
	try {
		manifest = await readManifestFromDisk(layout.manifestPath);
		if (manifest) {
			validateManifest(manifest);
			manifestValid = true;
		}
	} catch (e) {
		manifestError = e instanceof Error ? e.message : String(e);
	}

	if (!manifest && manifestValid === false && !manifestError) {
		const instance = parseInstanceFromNamespace(host.namespace);
		manifest = createInitialManifest({
			instance,
			namespace: host.namespace,
			adapterVersion: String(host.common?.version ?? "0.1.143"),
		});
		await writeManifestAtomic(layout.manifestPath, manifest);
		manifestValid = true;
		manifestError = "";
	}

	const bootGuard = manifest ? await readBootGuard(layout.bootGuardPath) : null;
	let restoreDetection: RestoreDetection = "manifest_invalid";
	if (manifest && manifestValid) {
		restoreDetection = diagnoseRestoreDetection({
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
		const fenceEval = await evaluateTransactionFenceAtStartup(manifest, layout.runtimeTransactionsDir);
		if (!fenceEval.ok) {
			manifestError = manifestError || fenceEval.reason;
			restoreDetection = "manifest_invalid";
			manifestValid = false;
			if (fenceEval.reason.startsWith("orphan_fence")) {
				manifest = await clearOrphanTransactionFence(layout.manifestPath, manifest);
			}
		}
		journalStatus = await validateJournals(layout, manifest, restoreDetection);
		if (journalStatus === "quarantined") {
			restoreDetection = "journal_quarantined";
		}
	}

	const migrationRecord = await readMigrationStatus(layout.migrationStatusPath);
	const migrationStatus = migrationRecord?.status ?? migrationResult.status;
	const legacyRemain = await legacyRuntimePathsRemain(layout);

	const ctx: BackupIntegrationContext = {
		layout,
		manifest,
		restoreDetection,
		migrationStatus,
		journalStatus,
		manifestValid: manifestValid && legacyRemain.length === 0 && migrationResult.ok,
		manifestError: manifestError || (legacyRemain.length ? `legacy_runtime_remain:${legacyRemain.join(",")}` : migrationResult.error ?? ""),
	};
	lastContext = ctx;

	await publishBackupIntegrationDiagnostics(host, {
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

export async function readManifestFromDisk(manifestPath: string): Promise<EmsInstanceManifest | null> {
	try {
		const raw = await fs.readFile(manifestPath, "utf8");
		return JSON.parse(raw) as EmsInstanceManifest;
	} catch {
		return null;
	}
}

export async function updateBootGuardAfterBootstrap(
	host: RestoreHost,
	manifest: EmsInstanceManifest,
): Promise<void> {
	const layout = resolveEmsPaths(host);
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
