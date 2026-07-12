import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { stableJsonStringify } from "../backup/schema";
import { restoreTransactionsDir } from "./source";
import type { PathResolverInput } from "../backup_integration/paths";
import type { RestoreJournal, RestoreJournalPhase } from "./types";
import { RESTORE_JOURNAL_SCHEMA_VERSION, RESTORE_JOURNAL_SCHEMA_VERSION_V2 } from "./types";
import type { EmsInstanceManifest } from "../backup_integration/manifest";

export function newTransactionId(): string {
	return randomUUID().replace(/-/g, "").slice(0, 24);
}

export function transactionDir(input: PathResolverInput, transactionId: string): string {
	return path.join(restoreTransactionsDir(input), transactionId);
}

export async function ensureTransactionLayout(input: PathResolverInput, transactionId: string): Promise<string> {
	const dir = transactionDir(input, transactionId);
	await fs.mkdir(path.join(dir, "before", "learning"), { recursive: true, mode: 0o700 });
	await fs.mkdir(path.join(dir, "staged", "learning"), { recursive: true, mode: 0o700 });
	return dir;
}

export async function writeJournalAtomic(dir: string, journal: RestoreJournal): Promise<void> {
	const target = path.join(dir, "journal.json");
	const tmp = path.join(dir, `.tmp-journal-${process.pid}.json`);
	await fs.writeFile(tmp, stableJsonStringify(journal), { mode: 0o600 });
	await fs.rename(tmp, target);
}

export async function readJournal(dir: string): Promise<RestoreJournal | null> {
	try {
		const raw = await fs.readFile(path.join(dir, "journal.json"), "utf8");
		return JSON.parse(raw) as RestoreJournal;
	} catch {
		return null;
	}
}

export function createJournal(input: {
	transactionId: string;
	archiveFileName: string;
	archiveSha256: string;
	phase: RestoreJournalPhase;
	manifest?: EmsInstanceManifest;
}): RestoreJournal {
	const now = new Date().toISOString();
	if (input.manifest) {
		return {
			schema_version: RESTORE_JOURNAL_SCHEMA_VERSION_V2,
			transaction_id: input.transactionId,
			archive_file_name: input.archiveFileName,
			archive_sha256: input.archiveSha256,
			phase: input.phase,
			created_at: now,
			updated_at: now,
			restore_must_start_dryrun: true,
			data_epoch: input.manifest.dataEpoch,
			base_checkpoint_generation: input.manifest.checkpointGeneration,
			base_checkpoint_id: input.manifest.checkpointId,
			transaction_fence_id: input.transactionId,
			instance: input.manifest.instance,
			namespace: input.manifest.namespace,
		};
	}
	return {
		schema_version: RESTORE_JOURNAL_SCHEMA_VERSION,
		transaction_id: input.transactionId,
		archive_file_name: input.archiveFileName,
		archive_sha256: input.archiveSha256,
		phase: input.phase,
		created_at: now,
		updated_at: now,
		restore_must_start_dryrun: true,
	};
}

export async function updateJournalPhase(dir: string, phase: RestoreJournalPhase): Promise<void> {
	const journal = await readJournal(dir);
	if (!journal) throw new Error("journal missing");
	journal.phase = phase;
	journal.updated_at = new Date().toISOString();
	await writeJournalAtomic(dir, journal);
}

export async function listIncompleteTransactions(instanceDataDir: string): Promise<Array<{ dir: string; journal: RestoreJournal }>> {
	const base = restoreTransactionsDir(instanceDataDir);
	const out: Array<{ dir: string; journal: RestoreJournal }> = [];
	try {
		const ids = await fs.readdir(base);
		for (const id of ids) {
			const dir = path.join(base, id);
			const journal = await readJournal(dir);
			if (!journal) continue;
			if (journal.phase !== "committed" && journal.phase !== "rolled_back" && journal.phase !== "failed") {
				out.push({ dir, journal });
			}
		}
	} catch {
		// kein Verzeichnis
	}
	return out;
}

/** Unvollständige oder nach Neustart noch offene committed-Transaktionen. */
export async function listRecoverableTransactions(instanceDataDir: string): Promise<Array<{ dir: string; journal: RestoreJournal }>> {
	const scan = await scanRestoreTransactionsAtStartup(instanceDataDir);
	return scan.active;
}

export interface StartupJournalScan {
	/** Journalphase failed oder defektes journal.json — blockiert Startup dauerhaft. */
	failed: Array<{ dir: string; journal: RestoreJournal | null }>;
	/** committed oder unvollständige Phasen vor Abschluss/Rollback. */
	active: Array<{ dir: string; journal: RestoreJournal }>;
	/** Abgeschlossenes Rollback — einmaliger Restore-Nachlauf beim nächsten Start. */
	rolledBack: Array<{ dir: string; journal: RestoreJournal }>;
}

export async function scanRestoreTransactionsAtStartup(transactionsDir: string): Promise<StartupJournalScan> {
	const base = transactionsDir;
	const failed: StartupJournalScan["failed"] = [];
	const active: StartupJournalScan["active"] = [];
	const rolledBack: StartupJournalScan["rolledBack"] = [];
	try {
		const ids = await fs.readdir(base);
		for (const id of ids) {
			const dir = path.join(base, id);
			const journal = await readJournal(dir);
			if (!journal) {
				failed.push({ dir, journal: null });
				continue;
			}
			if (journal.phase === "failed") {
				failed.push({ dir, journal });
				continue;
			}
			if (journal.phase === "rolled_back") {
				rolledBack.push({ dir, journal });
				continue;
			}
			active.push({ dir, journal });
		}
	} catch {
		// kein Verzeichnis
	}
	return { failed, active, rolledBack };
}

export async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
	const dir = path.dirname(filePath);
	await fs.mkdir(dir, { recursive: true, mode: 0o700 });
	const tmp = path.join(dir, `.tmp-${path.basename(filePath)}.${process.pid}`);
	await fs.writeFile(tmp, stableJsonStringify(value), { mode: 0o600 });
	await fs.rename(tmp, filePath);
}
