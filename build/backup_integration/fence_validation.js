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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.listTransactionDirs = listTransactionDirs;
exports.evaluateTransactionFenceAtStartup = evaluateTransactionFenceAtStartup;
exports.clearOrphanTransactionFence = clearOrphanTransactionFence;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const journal_1 = require("../restore/journal");
async function listTransactionDirs(transactionsDir) {
    try {
        const ids = await fs.readdir(transactionsDir);
        return ids.map((id) => path.join(transactionsDir, id));
    }
    catch {
        return [];
    }
}
async function evaluateTransactionFenceAtStartup(manifest, transactionsDir) {
    const fence = manifest.transactionFence;
    if (!fence) {
        return { ok: true, action: "none" };
    }
    const dirs = await listTransactionDirs(transactionsDir);
    const matchingDir = dirs.find((dir) => path.basename(dir) === fence.transactionId);
    const journal = matchingDir ? await (0, journal_1.readJournal)(matchingDir) : null;
    if (!journal) {
        return { ok: false, reason: "orphan_fence_no_journal", transactionId: fence.transactionId };
    }
    if (journal.transaction_id !== fence.transactionId) {
        return { ok: false, reason: "fence_journal_id_mismatch", transactionId: fence.transactionId };
    }
    if (journal.schema_version >= 2) {
        const bound = journal;
        if (typeof bound.base_checkpoint_generation === "number" &&
            bound.base_checkpoint_generation > manifest.checkpointGeneration) {
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
async function clearOrphanTransactionFence(manifestPath, manifest) {
    const { writeManifestAtomic } = await import("./manifest.js");
    const cleared = { ...manifest, transactionFence: null };
    await writeManifestAtomic(manifestPath, cleared);
    return cleared;
}
