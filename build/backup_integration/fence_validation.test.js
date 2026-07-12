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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const os = __importStar(require("node:os"));
const manifest_js_1 = require("./manifest.js");
const fence_validation_js_1 = require("./fence_validation.js");
const journal_js_1 = require("../restore/journal.js");
function manifestWithFence(txId, checkpointGeneration = 1) {
    const m = (0, manifest_js_1.createInitialManifest)({ instance: 0, namespace: "ems.0", adapterVersion: "0.1.143" });
    m.checkpointGeneration = checkpointGeneration;
    m.transactionFence = { transactionId: txId, status: "prepared" };
    return m;
}
function baseJournal(overrides) {
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
async function writeJournal(txDir, journal) {
    await fs.mkdir(txDir, { recursive: true, mode: 0o700 });
    await (0, journal_js_1.writeJournalAtomic)(txDir, journal);
}
(0, node_test_1.describe)("manifest fence crash windows", () => {
    let txRoot = "";
    (0, node_test_1.beforeEach)(async () => {
        txRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ems-fence-"));
    });
    (0, node_test_1.afterEach)(async () => {
        await fs.rm(txRoot, { recursive: true, force: true }).catch(() => undefined);
    });
    (0, node_test_1.it)("1: fence written but no journal directory", async () => {
        const eval1 = await (0, fence_validation_js_1.evaluateTransactionFenceAtStartup)(manifestWithFence("tx-no-journal"), txRoot);
        strict_1.default.equal(eval1.ok, false);
        if (!eval1.ok)
            strict_1.default.equal(eval1.reason, "orphan_fence_no_journal");
    });
    (0, node_test_1.it)("2: journal prepared, apply not started — fence matches active journal", async () => {
        const txId = "tx-prepared";
        const txDir = path.join(txRoot, txId);
        await writeJournal(txDir, baseJournal({
            transaction_id: txId,
            phase: "prepared",
            base_checkpoint_generation: 1,
            transaction_fence_id: txId,
        }));
        const eval2 = await (0, fence_validation_js_1.evaluateTransactionFenceAtStartup)(manifestWithFence(txId), txRoot);
        strict_1.default.equal(eval2.ok, true);
        if (eval2.ok)
            strict_1.default.equal(eval2.action, "matches_journal");
    });
    (0, node_test_1.it)("3: apply committed but fence not removed", async () => {
        const txId = "tx-committed";
        const txDir = path.join(txRoot, txId);
        await writeJournal(txDir, baseJournal({
            transaction_id: txId,
            phase: "committed",
            base_checkpoint_generation: 1,
            transaction_fence_id: txId,
        }));
        const eval3 = await (0, fence_validation_js_1.evaluateTransactionFenceAtStartup)(manifestWithFence(txId), txRoot);
        strict_1.default.equal(eval3.ok, false);
        if (!eval3.ok)
            strict_1.default.equal(eval3.reason, "orphan_fence_journal_cleaned");
    });
    (0, node_test_1.it)("4: rollback completed but fence not removed", async () => {
        const txId = "tx-rolled-back";
        const txDir = path.join(txRoot, txId);
        await writeJournal(txDir, baseJournal({
            transaction_id: txId,
            phase: "rolled_back",
            base_checkpoint_generation: 1,
            transaction_fence_id: txId,
        }));
        const eval4 = await (0, fence_validation_js_1.evaluateTransactionFenceAtStartup)(manifestWithFence(txId), txRoot);
        strict_1.default.equal(eval4.ok, false);
        if (!eval4.ok)
            strict_1.default.equal(eval4.reason, "orphan_fence_journal_cleaned");
    });
    (0, node_test_1.it)("5: journal cleaned (failed phase) but fence remains", async () => {
        const txId = "tx-failed";
        const txDir = path.join(txRoot, txId);
        await writeJournal(txDir, baseJournal({
            transaction_id: txId,
            phase: "failed",
            base_checkpoint_generation: 1,
            transaction_fence_id: txId,
        }));
        const eval5 = await (0, fence_validation_js_1.evaluateTransactionFenceAtStartup)(manifestWithFence(txId), txRoot);
        strict_1.default.equal(eval5.ok, false);
        if (!eval5.ok)
            strict_1.default.equal(eval5.reason, "orphan_fence_journal_cleaned");
    });
    (0, node_test_1.it)("6: fence and journal contain different transaction IDs", async () => {
        const fenceId = "tx-fence";
        const journalId = "tx-journal";
        const txDir = path.join(txRoot, fenceId);
        await writeJournal(txDir, baseJournal({
            transaction_id: journalId,
            phase: "prepared",
            base_checkpoint_generation: 1,
            transaction_fence_id: "other-fence",
        }));
        const eval6 = await (0, fence_validation_js_1.evaluateTransactionFenceAtStartup)(manifestWithFence(fenceId), txRoot);
        strict_1.default.equal(eval6.ok, false);
        if (!eval6.ok)
            strict_1.default.equal(eval6.reason, "fence_journal_id_mismatch");
    });
    (0, node_test_1.it)("7: journal references future checkpoint generation", async () => {
        const txId = "tx-future";
        const txDir = path.join(txRoot, txId);
        await writeJournal(txDir, baseJournal({
            transaction_id: txId,
            phase: "prepared",
            base_checkpoint_generation: 99,
            transaction_fence_id: txId,
        }));
        const eval7 = await (0, fence_validation_js_1.evaluateTransactionFenceAtStartup)(manifestWithFence(txId, 1), txRoot);
        strict_1.default.equal(eval7.ok, false);
        if (!eval7.ok)
            strict_1.default.equal(eval7.reason, "fence_future_generation");
    });
});
