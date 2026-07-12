import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { createInitialManifest, type EmsInstanceManifest } from "./manifest.js";
import { evaluateTransactionFenceAtStartup } from "./fence_validation.js";
import { writeJournalAtomic } from "../restore/journal.js";
import type { RestoreJournal } from "../restore/types.js";

function manifestWithFence(
	txId: string,
	checkpointGeneration = 1,
): EmsInstanceManifest {
	const m = createInitialManifest({ instance: 0, namespace: "ems.0", adapterVersion: "0.1.143" });
	m.checkpointGeneration = checkpointGeneration;
	m.transactionFence = { transactionId: txId, status: "prepared" };
	return m;
}

function baseJournal(overrides: Partial<RestoreJournal> & Pick<RestoreJournal, "transaction_id" | "phase">): RestoreJournal {
	return {
		schema_version: 2,
		archive_file_name: "test.emsbackup",
		archive_sha256: "abc",
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		restore_must_start_dryrun: true,
		...overrides,
	};
}

async function writeJournal(
	txDir: string,
	journal: RestoreJournal,
): Promise<void> {
	await fs.mkdir(txDir, { recursive: true, mode: 0o700 });
	await writeJournalAtomic(txDir, journal);
}

describe("manifest fence crash windows", () => {
	let txRoot = "";

	beforeEach(async () => {
		txRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ems-fence-"));
	});

	afterEach(async () => {
		await fs.rm(txRoot, { recursive: true, force: true }).catch(() => undefined);
	});

	it("1: fence written but no journal directory", async () => {
		const eval1 = await evaluateTransactionFenceAtStartup(manifestWithFence("tx-no-journal"), txRoot);
		assert.equal(eval1.ok, false);
		if (!eval1.ok) assert.equal(eval1.reason, "orphan_fence_no_journal");
	});

	it("2: journal prepared, apply not started — fence matches active journal", async () => {
		const txId = "tx-prepared";
		const txDir = path.join(txRoot, txId);
		await writeJournal(txDir, baseJournal({
			transaction_id: txId,
			phase: "prepared",
			base_checkpoint_generation: 1,
			transaction_fence_id: txId,
		}));
		const eval2 = await evaluateTransactionFenceAtStartup(manifestWithFence(txId), txRoot);
		assert.equal(eval2.ok, true);
		if (eval2.ok) assert.equal(eval2.action, "matches_journal");
	});

	it("3: apply committed but fence not removed", async () => {
		const txId = "tx-committed";
		const txDir = path.join(txRoot, txId);
		await writeJournal(txDir, baseJournal({
			transaction_id: txId,
			phase: "committed",
			base_checkpoint_generation: 1,
			transaction_fence_id: txId,
		}));
		const eval3 = await evaluateTransactionFenceAtStartup(manifestWithFence(txId), txRoot);
		assert.equal(eval3.ok, false);
		if (!eval3.ok) assert.equal(eval3.reason, "orphan_fence_journal_cleaned");
	});

	it("4: rollback completed but fence not removed", async () => {
		const txId = "tx-rolled-back";
		const txDir = path.join(txRoot, txId);
		await writeJournal(txDir, baseJournal({
			transaction_id: txId,
			phase: "rolled_back",
			base_checkpoint_generation: 1,
			transaction_fence_id: txId,
		}));
		const eval4 = await evaluateTransactionFenceAtStartup(manifestWithFence(txId), txRoot);
		assert.equal(eval4.ok, false);
		if (!eval4.ok) assert.equal(eval4.reason, "orphan_fence_journal_cleaned");
	});

	it("5: journal cleaned (failed phase) but fence remains", async () => {
		const txId = "tx-failed";
		const txDir = path.join(txRoot, txId);
		await writeJournal(txDir, baseJournal({
			transaction_id: txId,
			phase: "failed",
			base_checkpoint_generation: 1,
			transaction_fence_id: txId,
		}));
		const eval5 = await evaluateTransactionFenceAtStartup(manifestWithFence(txId), txRoot);
		assert.equal(eval5.ok, false);
		if (!eval5.ok) assert.equal(eval5.reason, "orphan_fence_journal_cleaned");
	});

	it("6: fence and journal contain different transaction IDs", async () => {
		const fenceId = "tx-fence";
		const journalId = "tx-journal";
		const txDir = path.join(txRoot, fenceId);
		await writeJournal(txDir, baseJournal({
			transaction_id: journalId,
			phase: "prepared",
			base_checkpoint_generation: 1,
			transaction_fence_id: "other-fence",
		}));
		const eval6 = await evaluateTransactionFenceAtStartup(manifestWithFence(fenceId), txRoot);
		assert.equal(eval6.ok, false);
		if (!eval6.ok) assert.equal(eval6.reason, "fence_journal_id_mismatch");
	});

	it("7: journal references future checkpoint generation", async () => {
		const txId = "tx-future";
		const txDir = path.join(txRoot, txId);
		await writeJournal(txDir, baseJournal({
			transaction_id: txId,
			phase: "prepared",
			base_checkpoint_generation: 99,
			transaction_fence_id: txId,
		}));
		const eval7 = await evaluateTransactionFenceAtStartup(manifestWithFence(txId, 1), txRoot);
		assert.equal(eval7.ok, false);
		if (!eval7.ok) assert.equal(eval7.reason, "fence_future_generation");
	});
});
