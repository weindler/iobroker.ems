"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.finalizeRestoreTransactionFence = exports.beginRestoreTransactionFence = exports.manifestMatchesInstance = exports.validateManifest = exports.writeManifestAtomic = exports.createInitialManifest = exports.newCheckpointId = exports.newDataEpoch = exports.PERSISTENCE_SCHEMA_VERSION = exports.MANIFEST_FORMAT_VERSION = exports.MANIFEST_FORMAT = void 0;
const node_crypto_1 = require("node:crypto");
const schema_1 = require("../backup/schema");
const atomic_write_1 = require("../persistence/atomic_write");
exports.MANIFEST_FORMAT = "ems-light-instance-data";
exports.MANIFEST_FORMAT_VERSION = 1;
exports.PERSISTENCE_SCHEMA_VERSION = 1;
function newDataEpoch() {
    return (0, node_crypto_1.randomUUID)();
}
exports.newDataEpoch = newDataEpoch;
function newCheckpointId() {
    return (0, node_crypto_1.randomUUID)();
}
exports.newCheckpointId = newCheckpointId;
function createInitialManifest(input) {
    const now = new Date().toISOString();
    return {
        format: exports.MANIFEST_FORMAT,
        formatVersion: exports.MANIFEST_FORMAT_VERSION,
        adapter: "ems",
        instance: input.instance,
        namespace: input.namespace,
        adapterVersion: input.adapterVersion,
        persistenceSchemaVersion: exports.PERSISTENCE_SCHEMA_VERSION,
        dataEpoch: newDataEpoch(),
        checkpointGeneration: 1,
        checkpointId: newCheckpointId(),
        transactionFence: null,
        createdAt: now,
        updatedAt: now,
    };
}
exports.createInitialManifest = createInitialManifest;
async function writeManifestAtomic(manifestPath, manifest) {
    const payload = { ...manifest, updatedAt: new Date().toISOString() };
    await (0, atomic_write_1.atomicWriteJson)(manifestPath, payload, schema_1.stableJsonStringify, (parsed) => {
        validateManifest(parsed);
    });
}
exports.writeManifestAtomic = writeManifestAtomic;
function validateManifest(raw) {
    if (!raw || typeof raw !== "object") {
        throw new Error("manifest_invalid");
    }
    const m = raw;
    if (m.format !== exports.MANIFEST_FORMAT)
        throw new Error("manifest_invalid_format");
    if (m.formatVersion !== exports.MANIFEST_FORMAT_VERSION)
        throw new Error("manifest_unsupported_format_version");
    if (m.adapter !== "ems")
        throw new Error("manifest_invalid_adapter");
    if (typeof m.instance !== "number" || m.instance < 0)
        throw new Error("manifest_invalid_instance");
    if (typeof m.namespace !== "string" || !m.namespace.startsWith("ems."))
        throw new Error("manifest_invalid_namespace");
    if (typeof m.adapterVersion !== "string")
        throw new Error("manifest_invalid");
    if (m.persistenceSchemaVersion !== exports.PERSISTENCE_SCHEMA_VERSION) {
        throw new Error("manifest_unsupported_persistence_schema");
    }
    if (typeof m.dataEpoch !== "string" || !m.dataEpoch)
        throw new Error("manifest_invalid_epoch");
    if (typeof m.checkpointGeneration !== "number" || m.checkpointGeneration < 1) {
        throw new Error("manifest_invalid_checkpoint_generation");
    }
    if (typeof m.checkpointId !== "string" || !m.checkpointId)
        throw new Error("manifest_invalid_checkpoint_id");
    if (m.transactionFence != null) {
        const fence = m.transactionFence;
        if (typeof fence.transactionId !== "string" || !fence.transactionId) {
            throw new Error("manifest_invalid_fence");
        }
    }
    return m;
}
exports.validateManifest = validateManifest;
function manifestMatchesInstance(manifest, namespace, instance) {
    return manifest.namespace === namespace && manifest.instance === instance;
}
exports.manifestMatchesInstance = manifestMatchesInstance;
async function beginRestoreTransactionFence(manifestPath, manifest, transactionId) {
    const next = {
        ...manifest,
        checkpointGeneration: manifest.checkpointGeneration + 1,
        checkpointId: newCheckpointId(),
        transactionFence: { transactionId, status: "prepared" },
    };
    await writeManifestAtomic(manifestPath, next);
    return next;
}
exports.beginRestoreTransactionFence = beginRestoreTransactionFence;
async function finalizeRestoreTransactionFence(manifestPath, manifest, outcome) {
    const next = {
        ...manifest,
        checkpointGeneration: manifest.checkpointGeneration + 1,
        checkpointId: newCheckpointId(),
        transactionFence: null,
    };
    void outcome;
    await writeManifestAtomic(manifestPath, next);
    return next;
}
exports.finalizeRestoreTransactionFence = finalizeRestoreTransactionFence;
