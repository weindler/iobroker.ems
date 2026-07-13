"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validatePlannerInputSnapshotV2 = exports.assertNoForbiddenSnapshotContent = exports.assertSnapshotSerializable = void 0;
const constants_1 = require("./constants");
const FORBIDDEN_SNAPSHOT_KEY_PATTERNS = [
    /plan_json$/i,
    /effective_json$/i,
    /last_json$/i,
    /setStateId/i,
    /password/i,
    /token/i,
    /credential/i,
    /snapshot_json$/i,
    /history_json$/i,
    /by_season_json$/i,
    /by_day_type_json$/i,
];
const FORBIDDEN_SNAPSHOT_VALUE_PATTERNS = [
    /setState\./i,
    /password=/i,
    /token=/i,
    /:.*@.*\//, // URL with credentials
];
function walk(value, keyPath, issues) {
    if (value === null || value === undefined)
        return;
    if (typeof value === "function") {
        issues.push(`function at ${keyPath}`);
        return;
    }
    if (typeof value !== "object") {
        if (typeof value === "string") {
            for (const pattern of FORBIDDEN_SNAPSHOT_VALUE_PATTERNS) {
                if (pattern.test(value)) {
                    issues.push(`forbidden value at ${keyPath}`);
                }
            }
        }
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((item, i) => walk(item, `${keyPath}[${i}]`, issues));
        return;
    }
    for (const [key, child] of Object.entries(value)) {
        const childPath = keyPath ? `${keyPath}.${key}` : key;
        for (const pattern of FORBIDDEN_SNAPSHOT_KEY_PATTERNS) {
            if (pattern.test(key)) {
                issues.push(`forbidden key ${childPath}`);
            }
        }
        walk(child, childPath, issues);
    }
}
function assertSnapshotSerializable(snapshot) {
    JSON.parse(JSON.stringify(snapshot));
}
exports.assertSnapshotSerializable = assertSnapshotSerializable;
function assertNoForbiddenSnapshotContent(snapshot) {
    const issues = [];
    walk(snapshot, "", issues);
    if (issues.length > 0) {
        throw new Error(`forbidden snapshot content: ${issues.join("; ")}`);
    }
}
exports.assertNoForbiddenSnapshotContent = assertNoForbiddenSnapshotContent;
function validatePlannerInputSnapshotV2(snapshot) {
    if (!snapshot || typeof snapshot !== "object")
        return false;
    const s = snapshot;
    if (s.schemaVersion !== constants_1.PLANNER_INPUT_SCHEMA_VERSION)
        return false;
    if (typeof s.capturedAt !== "string" || typeof s.timezone !== "string")
        return false;
    if (typeof s.inputRevision !== "string" || s.inputRevision.length !== 64)
        return false;
    if (!s.general || !s.policy || !s.live || !s.learning || !s.prices || !s.intents)
        return false;
    return true;
}
exports.validatePlannerInputSnapshotV2 = validatePlannerInputSnapshotV2;
