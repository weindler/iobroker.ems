import * as fs from "node:fs/promises";
import * as path from "node:path";
import { scanRestoreTransactionsAtStartup } from "./journal";
import { runRestoreRollback } from "./rollback";
import { runRestoreRuntimeCleanup } from "./runtime_cleanup";
import { setRestoreInProgress, setRestoreRestartRequired } from "./barrier";
import { syncExecutionModesFromConfig } from "../execution_mode";
import { setPendingForceDryrunReason, clearPendingForceDryrunReason } from "./dryrun_context";
import { RESTORE_STATES } from "../backup/ensure_states";
import { resolveEmsPaths } from "../backup_integration/paths";
import type { RestoreHost } from "./types";

export type StartupRecoveryResult =
	| { ok: true; action: "none" | "rolled_back" | "finalized_committed" | "finalized_rolled_back" }
	| { ok: false; error: string };

async function persistRestoreRecoveryDryrun(host: RestoreHost): Promise<void> {
	const config =
		host.config && typeof host.config === "object" ? (host.config as Record<string, unknown>) : {};
	await syncExecutionModesFromConfig(host, config, { forceDryrunReason: "restore_recovery" });
}

async function markStartupRecoveryBlocked(host: RestoreHost, error: string): Promise<void> {
	setRestoreInProgress(true);
	setPendingForceDryrunReason("restore_recovery");
	setRestoreRestartRequired(true);
	await persistRestoreRecoveryDryrun(host);
	await host.setStateAsync(RESTORE_STATES.status, { val: "recovery_failed", ack: true });
	await host.setStateAsync(RESTORE_STATES.lastError, { val: error, ack: true });
	await host.setStateAsync(RESTORE_STATES.lastResult, { val: "failed", ack: true });
	await host.setStateAsync(RESTORE_STATES.restartRequired, { val: true, ack: true });
}

async function runRolledBackFollowUp(host: RestoreHost): Promise<StartupRecoveryResult> {
	setRestoreInProgress(true);
	setPendingForceDryrunReason("restore_recovery");
	await persistRestoreRecoveryDryrun(host);
	await runRestoreRuntimeCleanup(host);
	return { ok: true, action: "finalized_rolled_back" };
}

async function runRecoveryScan(host: RestoreHost, transactionsDir: string): Promise<StartupRecoveryResult> {
	const scan = await scanRestoreTransactionsAtStartup(transactionsDir);

	if (scan.failed.length > 0) {
		await markStartupRecoveryBlocked(host, "restore_transaction_failed");
		return { ok: false, error: "restore_transaction_failed" };
	}

	if (scan.active.length > 1) {
		await markStartupRecoveryBlocked(host, "multiple_incomplete_restore_transactions");
		return { ok: false, error: "multiple_incomplete_restore_transactions" };
	}

	if (scan.active.length === 1) {
		const { dir, journal } = scan.active[0]!;
		setRestoreInProgress(true);
		setPendingForceDryrunReason("restore_recovery");
		await persistRestoreRecoveryDryrun(host);

		if (journal.phase === "committed") {
			await runRestoreRuntimeCleanup(host);
			setRestoreRestartRequired(true);
			await host.setStateAsync(RESTORE_STATES.restartRequired, { val: true, ack: true });
			return { ok: true, action: "finalized_committed" };
		}

		try {
			await runRestoreRollback(host, dir);
			return { ok: true, action: "rolled_back" };
		} catch {
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

export async function runRestoreStartupRecoveryAtPath(
	host: RestoreHost,
	transactionsDir: string,
): Promise<StartupRecoveryResult> {
	return runRecoveryScan(host, transactionsDir);
}

export async function runRestoreStartupRecovery(host: RestoreHost): Promise<StartupRecoveryResult> {
	const layout = resolveEmsPaths(host);
	return runRecoveryScan(host, layout.runtimeTransactionsDir);
}

export async function cleanupFinishedRestoreTransactions(transactionsDir: string): Promise<void> {
	const scan = await scanRestoreTransactionsAtStartup(transactionsDir);
	for (const { dir, journal } of scan.active) {
		if (journal.phase === "committed") {
			await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
		}
	}
	for (const { dir } of scan.rolledBack) {
		await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
	}
}

export async function clearRestoreRestartRequiredAfterBootstrap(host: RestoreHost): Promise<void> {
	const layout = resolveEmsPaths(host);
	await cleanupFinishedRestoreTransactions(layout.runtimeTransactionsDir);
	setRestoreRestartRequired(false);
	setRestoreInProgress(false);
	clearPendingForceDryrunReason();
	await host.setStateAsync(RESTORE_STATES.restartRequired, { val: false, ack: true });
}
