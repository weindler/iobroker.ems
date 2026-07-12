import type { RestoreJournal } from "../restore/types";
import type { EmsInstanceManifest } from "./manifest";

export const RESTORE_JOURNAL_SCHEMA_VERSION_V2 = 2;

export interface BoundRestoreJournal extends RestoreJournal {
	schema_version: 2;
	data_epoch: string;
	base_checkpoint_generation: number;
	base_checkpoint_id: string;
	transaction_fence_id: string;
	instance: number;
	namespace: string;
}

export function isLegacyRestoreJournal(journal: RestoreJournal): boolean {
	return journal.schema_version === 1 && !("data_epoch" in journal);
}

export function validateBoundJournal(
	journal: RestoreJournal,
	manifest: EmsInstanceManifest,
	namespace: string,
	instance: number,
): { ok: true; journal: BoundRestoreJournal } | { ok: false; reason: string } {
	if (isLegacyRestoreJournal(journal)) {
		return { ok: true, journal: journal as BoundRestoreJournal };
	}
	if (journal.schema_version !== RESTORE_JOURNAL_SCHEMA_VERSION_V2) {
		return { ok: false, reason: "unsupported_journal_schema" };
	}
	const bound = journal as unknown as BoundRestoreJournal;
	if (bound.namespace !== namespace || bound.instance !== instance) {
		return { ok: false, reason: "journal_wrong_instance" };
	}
	if (bound.data_epoch !== manifest.dataEpoch) {
		return { ok: false, reason: "journal_foreign_epoch" };
	}
	if (bound.base_checkpoint_generation > manifest.checkpointGeneration) {
		return { ok: false, reason: "journal_future_generation" };
	}
	if (manifest.transactionFence && bound.transaction_fence_id !== manifest.transactionFence.transactionId) {
		if (bound.transaction_id !== manifest.transactionFence.transactionId) {
			return { ok: false, reason: "journal_fence_mismatch" };
		}
	}
	return { ok: true, journal: bound };
}

export function shouldQuarantineLegacyJournal(
	journal: RestoreJournal,
	restoreDetection: string,
): boolean {
	if (!isLegacyRestoreJournal(journal)) {
		return false;
	}
	return (
		restoreDetection === "foreign_timeline" ||
		restoreDetection === "rollback_suspected" ||
		restoreDetection === "manifest_invalid"
	);
}
