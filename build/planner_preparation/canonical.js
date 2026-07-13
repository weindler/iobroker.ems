"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computePreparationRevision = exports.canonicalPreparedJson = exports.canonicalPreparedPayload = exports.sortKeysDeep = void 0;
const node_crypto_1 = require("node:crypto");
const constants_1 = require("./constants");
function isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
function sortKeysDeep(value) {
    if (Array.isArray(value)) {
        return value.map(sortKeysDeep);
    }
    if (!isPlainObject(value)) {
        return value;
    }
    const out = {};
    for (const key of Object.keys(value).sort()) {
        if (constants_1.PREPARATION_REVISION_EXCLUDED_KEYS.includes(key)) {
            continue;
        }
        out[key] = sortKeysDeep(value[key]);
    }
    return out;
}
exports.sortKeysDeep = sortKeysDeep;
function canonicalPreparedPayload(prepared) {
    const clone = JSON.parse(JSON.stringify(prepared));
    for (const key of constants_1.PREPARATION_REVISION_EXCLUDED_KEYS) {
        delete clone[key];
    }
    return sortKeysDeep(clone);
}
exports.canonicalPreparedPayload = canonicalPreparedPayload;
function canonicalPreparedJson(prepared) {
    return JSON.stringify(canonicalPreparedPayload(prepared));
}
exports.canonicalPreparedJson = canonicalPreparedJson;
function computePreparationRevision(prepared) {
    return (0, node_crypto_1.createHash)("sha256").update(canonicalPreparedJson(prepared)).digest("hex");
}
exports.computePreparationRevision = computePreparationRevision;
