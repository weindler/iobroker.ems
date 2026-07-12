"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldQuarantineLegacyJournal = exports.validateBoundJournal = exports.isLegacyRestoreJournal = exports.RESTORE_JOURNAL_SCHEMA_VERSION_V2 = void 0;
exports.RESTORE_JOURNAL_SCHEMA_VERSION_V2 = 2;
function isLegacyRestoreJournal(journal) {
    return journal.schema_version === 1 && !("data_epoch" in journal);
}
exports.isLegacyRestoreJournal = isLegacyRestoreJournal;
function validateBoundJournal(journal, manifest, namespace, instance) {
    if (isLegacyRestoreJournal(journal)) {
        return { ok: true, journal: journal };
    }
    if (journal.schema_version !== exports.RESTORE_JOURNAL_SCHEMA_VERSION_V2) {
        return { ok: false, reason: "unsupported_journal_schema" };
    }
    const bound = journal;
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
exports.validateBoundJournal = validateBoundJournal;
function shouldQuarantineLegacyJournal(journal, restoreDetection) {
    if (!isLegacyRestoreJournal(journal)) {
        return false;
    }
    return (restoreDetection === "foreign_timeline" ||
        restoreDetection === "rollback_suspected" ||
        restoreDetection === "manifest_invalid");
}
exports.shouldQuarantineLegacyJournal = shouldQuarantineLegacyJournal;
