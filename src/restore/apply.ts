import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
	tryAcquireOperationLock,
	releaseOperationLock,
} from "../backup/operation_lock";
import { readRestoreArchiveFile } from "./source";
import { validateRestoreArchiveBuffer } from "./validate_archive";
import {
	buildRestoreProjection,
	countChangedConfigFields,
	mergeNativeForRestore,
	exportCurrentNativeProjection,
} from "./projection";
import {
	createRestorePlan,
	invalidateRestorePlan,
	markPlanUsed,
	assertPlanMatchesIdentity,
	planSummaryJson,
	clearRestorePlanForTest,
} from "./plan";
import {
	setRestoreInProgress,
	setRestoreRestartRequired,
} from "./barrier";
import {
	createJournal,
	ensureTransactionLayout,
	newTransactionId,
	updateJournalPhase,
	writeJournalAtomic,
	writeJsonFileAtomic,
} from "./journal";
import {
	snapshotLearningFiles,
	writeLearningSnapshot,
	applyLearningFromStaged,
} from "./learning_apply";
import { runRestoreRuntimeCleanup } from "./runtime_cleanup";
import { runRestoreRollback } from "./rollback";
import { syncExecutionModesFromConfig } from "../execution_mode";
import { stopDiagnosticMode } from "../support/diagnostic_mode";
import { maybeInjectRestoreApplyFailure } from "./apply_hooks";
import type { RestoreHost, RestoreResult, RestoreArchiveIdentity } from "./types";
import { stableJsonStringify } from "../backup/schema";
import { readManifestFromDisk } from "../backup_integration/startup";
import {
	beginRestoreTransactionFence,
	finalizeRestoreTransactionFence,
	validateManifest,
} from "../backup_integration/manifest";
import { resolveEmsPaths } from "../backup_integration/paths";

function currentNative(host: RestoreHost): Record<string, unknown> {
	return host.config && typeof host.config === "object" ? { ...(host.config as Record<string, unknown>) } : {};
}

async function forceDryrun(host: RestoreHost, config: Record<string, unknown>): Promise<void> {
	if (typeof host.updateConfig === "function") {
		await host.updateConfig(config);
	}
	await syncExecutionModesFromConfig(host, config, { forceDryrunReason: "restore_recovery" });
}

export async function runRestoreValidate(host: RestoreHost, fileName: string): Promise<RestoreResult> {
	const lock = tryAcquireOperationLock("restore_validate");
	if (!lock.ok) return { ok: false, error: lock.error, status: "error" };

	try {
		invalidateRestorePlan();
		const file = await readRestoreArchiveFile(host, fileName);
		const validated = validateRestoreArchiveBuffer(file.buffer);
		const projection = buildRestoreProjection(validated.payloadMap);
		const identity: RestoreArchiveIdentity = {
			fileName,
			rootKind: file.rootKind,
			archiveSha256: validated.archiveSha256,
			sizeBytes: file.sizeBytes,
			mtimeMs: file.mtimeMs,
		};
		const changed = countChangedConfigFields(currentNative(host), projection.native);
		const plan = createRestorePlan({
			identity,
			manifest: validated.manifest,
			projection,
			changedConfigFields: changed,
		});
		return { ok: true, status: "ready", planId: plan.planId };
	} catch (e) {
		invalidateRestorePlan();
		const msg = e instanceof Error ? e.message : String(e);
		return { ok: false, error: msg, status: "error" };
	} finally {
		releaseOperationLock();
	}
}

export async function runRestoreApply(host: RestoreHost, fileName: string, confirmPlanId: string): Promise<RestoreResult> {
	const lock = tryAcquireOperationLock("restore_apply");
	if (!lock.ok) return { ok: false, error: lock.error, status: "error" };

	const txId = newTransactionId();
	let txDir = "";
	setRestoreInProgress(true);

	try {
		await maybeInjectRestoreApplyFailure("after_lock");
		stopDiagnosticMode();
		const file = await readRestoreArchiveFile(host, fileName);
		const validated = validateRestoreArchiveBuffer(file.buffer);
		const identity: RestoreArchiveIdentity = {
			fileName,
			rootKind: file.rootKind,
			archiveSha256: validated.archiveSha256,
			sizeBytes: file.sizeBytes,
			mtimeMs: file.mtimeMs,
		};
		const plan = assertPlanMatchesIdentity(identity, confirmPlanId);
		markPlanUsed();

		await maybeInjectRestoreApplyFailure("after_barrier");

		txDir = await ensureTransactionLayout(host, txId);
		const layout = resolveEmsPaths(host);
		let manifest = await readManifestFromDisk(layout.manifestPath);
		if (!manifest) {
			throw new Error("manifest_missing");
		}
		manifest = validateManifest(manifest);
		manifest = await beginRestoreTransactionFence(layout.manifestPath, manifest, txId);

		const beforeNative = exportCurrentNativeProjection(currentNative(host));
		await writeJsonFileAtomic(path.join(txDir, "before", "native_projection.json"), beforeNative);

		const learningBefore = await snapshotLearningFiles(host);
		await writeLearningSnapshot(txDir, "before", learningBefore);

		let journal = createJournal({
			transactionId: txId,
			archiveFileName: fileName,
			archiveSha256: validated.archiveSha256,
			phase: "prepared",
			manifest,
		});
		await writeJournalAtomic(txDir, journal);
		await maybeInjectRestoreApplyFailure("after_before_snapshot");

		const stagedNative = plan.projection.native;
		await writeJsonFileAtomic(path.join(txDir, "staged", "native_projection.json"), stagedNative);
		for (const [key, content] of Object.entries(plan.projection.learning)) {
			await writeJsonFileAtomic(path.join(txDir, "staged", "learning", key), content);
		}

		await maybeInjectRestoreApplyFailure("after_staged_write");

		const merged = mergeNativeForRestore(currentNative(host), stagedNative);
		await forceDryrun(host, merged);
		await updateJournalPhase(txDir, "dryrun_locked");
		await maybeInjectRestoreApplyFailure("after_dryrun_lock");

		if (typeof host.updateConfig !== "function") {
			throw new Error("updateConfig unavailable");
		}
		await host.updateConfig(merged);
		const after = currentNative(host);
		if (stableJsonStringify(mergeNativeForRestore(after, stagedNative)).trim() !== stableJsonStringify(merged).trim()) {
			throw new Error("native projection verify failed");
		}
		await updateJournalPhase(txDir, "config_applied");
		await maybeInjectRestoreApplyFailure("after_native_apply");

		await applyLearningFromStaged(host, txDir, plan.projection.learning);
		await updateJournalPhase(txDir, "learning_applied");

		await runRestoreRuntimeCleanup(host);
		await updateJournalPhase(txDir, "runtime_cleared");
		await maybeInjectRestoreApplyFailure("after_runtime_cleanup");

		setRestoreRestartRequired(true);
		await maybeInjectRestoreApplyFailure("after_restart_required");
		await maybeInjectRestoreApplyFailure("before_committed_journal");
		await updateJournalPhase(txDir, "committed");
		await finalizeRestoreTransactionFence(layout.manifestPath, manifest, "committed");

		return { ok: true, status: "success_restart_required", transactionId: txId, planId: plan.planId };
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		if (txDir) {
			try {
				await runRestoreRollback(host, txDir);
				invalidateRestorePlan();
				setRestoreInProgress(false);
				return { ok: false, error: msg, status: "rolled_back" };
			} catch {
				await updateJournalPhase(txDir, "failed").catch(() => undefined);
				invalidateRestorePlan();
				return { ok: false, error: "restore_rollback_failed", status: "recovery_failed" };
			}
		}
		invalidateRestorePlan();
		setRestoreInProgress(false);
		return { ok: false, error: msg, status: "error" };
	} finally {
		releaseOperationLock();
	}
}

export {
	clearRestorePlanForTest,
	planSummaryJson,
	getActiveRestorePlan,
} from "./plan";

import { getActiveRestorePlan } from "./plan";

export function resetRestoreApplyForTest(): void {
	clearRestorePlanForTest();
	setRestoreInProgress(false);
	setRestoreRestartRequired(false);
}
