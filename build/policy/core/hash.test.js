"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const hash_js_1 = require("./hash.js");
const normalize_js_1 = require("./normalize.js");
const constants_js_1 = require("./constants.js");
function emptySnapshot() {
    return {
        meta: { schemaVersion: constants_js_1.POLICY_SCHEMA_VERSION, engineVersion: constants_js_1.POLICY_ENGINE_VERSION },
        capabilities: {},
        limits: {},
        preferences: {},
        protection: {},
        economics: {},
        validation: { valid: true, status: "valid", issues: [] },
        status: "ready",
    };
}
(0, node_test_1.describe)("policy hash determinism", () => {
    (0, node_test_1.it)("same inputs same hash", () => {
        const a = emptySnapshot();
        const b = emptySnapshot();
        strict_1.default.equal((0, hash_js_1.computePolicyRevisionHash)(a), (0, hash_js_1.computePolicyRevisionHash)(b));
    });
    (0, node_test_1.it)("key order does not change hash", () => {
        const a = emptySnapshot();
        a.limits = {
            z: { value: 1, source: "admin", strength: "hard", valid: true },
            a: { value: 2, source: "admin", strength: "hard", valid: true },
        };
        const b = emptySnapshot();
        b.limits = {
            a: { value: 2, source: "admin", strength: "hard", valid: true },
            z: { value: 1, source: "admin", strength: "hard", valid: true },
        };
        strict_1.default.equal((0, hash_js_1.computePolicyRevisionHash)(a), (0, hash_js_1.computePolicyRevisionHash)(b));
    });
    (0, node_test_1.it)("updated_at is not part of hash payload", () => {
        const a = emptySnapshot();
        const b = emptySnapshot();
        a.updatedAt = "2026-01-01";
        strict_1.default.equal((0, hash_js_1.computePolicyRevisionHash)(a), (0, hash_js_1.computePolicyRevisionHash)(b));
    });
    (0, node_test_1.it)("issues sorted deterministically", () => {
        const issues = (0, normalize_js_1.sortIssuesDeterministic)([
            { code: "b", severity: "info", message: "m" },
            { code: "a", severity: "error", message: "m" },
            { code: "a", severity: "warning", message: "m" },
        ]);
        strict_1.default.equal(issues[0].severity, "error");
        strict_1.default.equal(issues[1].severity, "warning");
    });
    (0, node_test_1.it)("stableStringify sorts keys", () => {
        strict_1.default.equal((0, hash_js_1.stableStringify)({ b: 1, a: 2 }), (0, hash_js_1.stableStringify)({ a: 2, b: 1 }));
    });
});
