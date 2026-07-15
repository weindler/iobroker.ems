"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shortenRevision = exports.computeShadowProjectionRevision = exports.canonicalShadowProjectionJson = void 0;
const node_crypto_1 = require("node:crypto");
const canonical_1 = require("../planner_preparation/canonical");
function canonicalShadowProjectionJson(projection) {
    return JSON.stringify((0, canonical_1.sortKeysDeep)(projection));
}
exports.canonicalShadowProjectionJson = canonicalShadowProjectionJson;
function computeShadowProjectionRevision(projection) {
    return (0, node_crypto_1.createHash)("sha256").update(canonicalShadowProjectionJson(projection), "utf8").digest("hex");
}
exports.computeShadowProjectionRevision = computeShadowProjectionRevision;
function shortenRevision(revision, length = 12) {
    if (!revision)
        return "";
    return revision.length <= length ? revision : revision.slice(0, length);
}
exports.shortenRevision = shortenRevision;
