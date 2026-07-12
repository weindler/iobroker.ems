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
exports.writeJsonFileAtomic = exports.scanRestoreTransactionsAtStartup = exports.listRecoverableTransactions = exports.listIncompleteTransactions = exports.updateJournalPhase = exports.createJournal = exports.readJournal = exports.writeJournalAtomic = exports.ensureTransactionLayout = exports.transactionDir = exports.newTransactionId = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const node_crypto_1 = require("node:crypto");
const schema_1 = require("../backup/schema");
const source_1 = require("./source");
const types_1 = require("./types");
function newTransactionId() {
    return (0, node_crypto_1.randomUUID)().replace(/-/g, "").slice(0, 24);
}
exports.newTransactionId = newTransactionId;
function transactionDir(input, transactionId) {
    return path.join((0, source_1.restoreTransactionsDir)(input), transactionId);
}
exports.transactionDir = transactionDir;
async function ensureTransactionLayout(input, transactionId) {
    const dir = transactionDir(input, transactionId);
    await fs.mkdir(path.join(dir, "before", "learning"), { recursive: true, mode: 0o700 });
    await fs.mkdir(path.join(dir, "staged", "learning"), { recursive: true, mode: 0o700 });
    return dir;
}
exports.ensureTransactionLayout = ensureTransactionLayout;
async function writeJournalAtomic(dir, journal) {
    const target = path.join(dir, "journal.json");
    const tmp = path.join(dir, `.tmp-journal-${process.pid}.json`);
    await fs.writeFile(tmp, (0, schema_1.stableJsonStringify)(journal), { mode: 0o600 });
    await fs.rename(tmp, target);
}
exports.writeJournalAtomic = writeJournalAtomic;
async function readJournal(dir) {
    try {
        const raw = await fs.readFile(path.join(dir, "journal.json"), "utf8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
exports.readJournal = readJournal;
function createJournal(input) {
    const now = new Date().toISOString();
    if (input.manifest) {
        return {
            schema_version: types_1.RESTORE_JOURNAL_SCHEMA_VERSION_V2,
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
        schema_version: types_1.RESTORE_JOURNAL_SCHEMA_VERSION,
        transaction_id: input.transactionId,
        archive_file_name: input.archiveFileName,
        archive_sha256: input.archiveSha256,
        phase: input.phase,
        created_at: now,
        updated_at: now,
        restore_must_start_dryrun: true,
    };
}
exports.createJournal = createJournal;
async function updateJournalPhase(dir, phase) {
    const journal = await readJournal(dir);
    if (!journal)
        throw new Error("journal missing");
    journal.phase = phase;
    journal.updated_at = new Date().toISOString();
    await writeJournalAtomic(dir, journal);
}
exports.updateJournalPhase = updateJournalPhase;
async function listIncompleteTransactions(instanceDataDir) {
    const base = (0, source_1.restoreTransactionsDir)(instanceDataDir);
    const out = [];
    try {
        const ids = await fs.readdir(base);
        for (const id of ids) {
            const dir = path.join(base, id);
            const journal = await readJournal(dir);
            if (!journal)
                continue;
            if (journal.phase !== "committed" && journal.phase !== "rolled_back" && journal.phase !== "failed") {
                out.push({ dir, journal });
            }
        }
    }
    catch {
        // kein Verzeichnis
    }
    return out;
}
exports.listIncompleteTransactions = listIncompleteTransactions;
/** Unvollständige oder nach Neustart noch offene committed-Transaktionen. */
async function listRecoverableTransactions(instanceDataDir) {
    const scan = await scanRestoreTransactionsAtStartup(instanceDataDir);
    return scan.active;
}
exports.listRecoverableTransactions = listRecoverableTransactions;
async function scanRestoreTransactionsAtStartup(transactionsDir) {
    const base = transactionsDir;
    const failed = [];
    const active = [];
    const rolledBack = [];
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
    }
    catch {
        // kein Verzeichnis
    }
    return { failed, active, rolledBack };
}
exports.scanRestoreTransactionsAtStartup = scanRestoreTransactionsAtStartup;
async function writeJsonFileAtomic(filePath, value) {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = path.join(dir, `.tmp-${path.basename(filePath)}.${process.pid}`);
    await fs.writeFile(tmp, (0, schema_1.stableJsonStringify)(value), { mode: 0o600 });
    await fs.rename(tmp, filePath);
}
exports.writeJsonFileAtomic = writeJsonFileAtomic;
