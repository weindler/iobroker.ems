import * as fs from "node:fs/promises";
import * as path from "node:path";
import { mergeNativeForRestore } from "./projection";
import { updateJournalPhase, readJournal } from "./journal";
import { restoreLearningFromSnapshot } from "./learning_apply";
import { syncExecutionModesFromConfig } from "../execution_mode";
import { runRestoreRuntimeCleanup } from "./runtime_cleanup";
import { maybeInjectRestoreRollbackFailure } from "./apply_hooks";
import type { RestoreHost } from "./types";
import { resolveEmsPaths } from "../backup_integration/paths";
import { readManifestFromDisk } from "../backup_integration/startup";
import { finalizeRestoreTransactionFence, validateManifest } from "../backup_integration/manifest";

export async function runRestoreRollback(host: RestoreHost, txDir: string): Promise<void> {
	await updateJournalPhase(txDir, "rollback_running");
	const beforePath = path.join(txDir, "before", "native_projection.json");
	const raw = await fs.readFile(beforePath, "utf8");
	const beforeNative = JSON.parse(raw) as Record<string, unknown>;
	const current =
		host.config && typeof host.config === "object" ? (host.config as Record<string, unknown>) : {};
	const merged = mergeNativeForRestore(current, beforeNative);
	for (const k of ["global_execution_mode", "wb_addon_mode", "bat_addon_mode", "ih_addon_mode", "ac_addon_mode"]) {
		merged[k] = "dryrun";
	}
	if (typeof host.updateConfig === "function") {
		await maybeInjectRestoreRollbackFailure("native_restore");
		await host.updateConfig(merged);
	}
	await syncExecutionModesFromConfig(host, merged, { forceDryrunReason: "restore_recovery" });
	await maybeInjectRestoreRollbackFailure("learning_restore");
	await restoreLearningFromSnapshot(host, txDir, "before");
	await runRestoreRuntimeCleanup(host);
	await updateJournalPhase(txDir, "rolled_back");
	const layout = resolveEmsPaths(host);
	const manifestRaw = await readManifestFromDisk(layout.manifestPath);
	if (manifestRaw?.transactionFence) {
		const manifest = validateManifest(manifestRaw);
		await finalizeRestoreTransactionFence(layout.manifestPath, manifest, "rolled_back");
	}
}

export async function readTransactionJournal(txDir: string) {
	return readJournal(txDir);
}
