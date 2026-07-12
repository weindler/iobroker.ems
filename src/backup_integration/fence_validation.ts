import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { EmsInstanceManifest } from "./manifest";
import type { RestoreJournal } from "../restore/types";
import { readJournal } from "../restore/journal";

export type FenceEvaluation =
	| { ok: true; action: "none" | "matches_journal" }
	| { ok: false; reason: FenceFailureReason; transactionId?: string };

export type FenceFailureReason =
	| "orphan_fence_no_journal"
	| "orphan_fence_journal_cleaned"
	| "fence_journal_id_mismatch"
	| "fence_future_generation";

export async function listTransactionDirs(transactionsDir: string): Promise<string[]> {
	try {
		const ids = await fs.readdir(transactionsDir);
		return ids.map((id) => path.join(transactionsDir, id));
	} catch {
		return [];
	}
}

export async function evaluateTransactionFenceAtStartup(
	manifest: EmsInstanceManifest,
	transactionsDir: string,
): Promise<FenceEvaluation> {
	const fence = manifest.transactionFence;
	if (!fence) {
		return { ok: true, action: "none" };
	}

	const dirs = await listTransactionDirs(transactionsDir);
	const matchingDir = dirs.find((dir) => path.basename(dir) === fence.transactionId);
	const journal = matchingDir ? await readJournal(matchingDir) : null;

	if (!journal) {
		return { ok: false, reason: "orphan_fence_no_journal", transactionId: fence.transactionId };
	}

	if (journal.transaction_id !== fence.transactionId) {
		return { ok: false, reason: "fence_journal_id_mismatch", transactionId: fence.transactionId };
	}

	if (journal.schema_version >= 2) {
		const bound = journal as RestoreJournal & { base_checkpoint_generation?: number };
		if (
			typeof bound.base_checkpoint_generation === "number" &&
			bound.base_checkpoint_generation > manifest.checkpointGeneration
		) {
			return { ok: false, reason: "fence_future_generation", transactionId: fence.transactionId };
		}
		if (bound.transaction_fence_id && bound.transaction_fence_id !== fence.transactionId) {
			return { ok: false, reason: "fence_journal_id_mismatch", transactionId: fence.transactionId };
		}
	}

	if (journal.phase === "committed" || journal.phase === "rolled_back" || journal.phase === "failed") {
		return { ok: false, reason: "orphan_fence_journal_cleaned", transactionId: fence.transactionId };
	}

	return { ok: true, action: "matches_journal", ...(matchingDir ? {} : {}) };
}

export async function clearOrphanTransactionFence(manifestPath: string, manifest: EmsInstanceManifest): Promise<EmsInstanceManifest> {
	const { writeManifestAtomic } = await import("./manifest");
	const cleared: EmsInstanceManifest = { ...manifest, transactionFence: null };
	await writeManifestAtomic(manifestPath, cleared);
	return cleared;
}
