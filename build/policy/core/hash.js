"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.revisionFromHash = exports.computePolicyRevisionHash = exports.stableStringify = void 0;
const node_crypto_1 = require("node:crypto");
const constants_1 = require("./constants");
const normalize_1 = require("./normalize");
function stableStringify(value) {
    return JSON.stringify((0, normalize_1.sortKeysDeep)(value));
}
exports.stableStringify = stableStringify;
function computePolicyRevisionHash(snapshot, validation) {
    const payload = {
        schemaVersion: constants_1.POLICY_SCHEMA_VERSION,
        content: {
            meta: snapshot.meta,
            capabilities: snapshot.capabilities,
            limits: snapshot.limits,
            preferences: snapshot.preferences,
            protection: snapshot.protection,
            economics: snapshot.economics,
            status: snapshot.status,
            provenance: snapshot.provenance,
            validation: {
                valid: validation?.valid ?? snapshot.validation.valid,
                status: validation?.status ?? snapshot.validation.status,
                issues: validation?.issues ?? snapshot.validation.issues,
            },
        },
    };
    return (0, node_crypto_1.createHash)("sha256").update(stableStringify(payload), "utf8").digest("hex");
}
exports.computePolicyRevisionHash = computePolicyRevisionHash;
function revisionFromHash(hash) {
    return hash.slice(0, 16);
}
exports.revisionFromHash = revisionFromHash;
