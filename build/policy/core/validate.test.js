"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const value_js_1 = require("./value.js");
const normalize_js_1 = require("./normalize.js");
const validate_js_1 = require("./validate.js");
const constants_js_1 = require("./constants.js");
const value_js_2 = require("./value.js");
(0, node_test_1.describe)("unknown handling", () => {
    (0, node_test_1.it)("missing number is not zero", () => {
        const v = (0, value_js_1.unknownValue)();
        strict_1.default.notEqual(v.value, 0);
        strict_1.default.equal(v.value, null);
    });
    (0, node_test_1.it)("missing boolean is not false", () => {
        const v = (0, value_js_1.unknownValue)();
        strict_1.default.notEqual(v.value, false);
    });
    (0, node_test_1.it)("missing capability is unknown", () => {
        strict_1.default.equal((0, value_js_1.unknownTriState)().value, "unknown");
    });
    (0, node_test_1.it)("normalizeTriState unknown for garbage", () => {
        strict_1.default.equal((0, normalize_js_1.normalizeTriState)("maybe"), "unknown");
    });
});
(0, node_test_1.describe)("policy validation", () => {
    function snap(overrides = {}) {
        return {
            meta: { schemaVersion: constants_js_1.POLICY_SCHEMA_VERSION, engineVersion: constants_js_1.POLICY_ENGINE_VERSION },
            capabilities: {},
            limits: {},
            preferences: {},
            protection: {},
            economics: {},
            validation: { valid: true, status: "valid", issues: [] },
            status: "ready",
            ...overrides,
        };
    }
    (0, node_test_1.it)("min greater than max is error", () => {
        const s = snap({
            limits: {
                minSocPct: (0, value_js_2.policyValue)(80, "admin", "hard"),
                maxSocPct: (0, value_js_2.policyValue)(70, "admin", "hard"),
            },
        });
        const v = (0, validate_js_1.validatePolicySnapshot)(s);
        strict_1.default.equal(v.valid, false);
        strict_1.default.ok(v.issues.some((i) => i.code === "min_greater_than_max"));
    });
    (0, node_test_1.it)("rejects NaN", () => {
        const s = snap({
            limits: { x: (0, value_js_2.policyValue)(Number.NaN, "admin", "hard") },
        });
        const v = (0, validate_js_1.validatePolicySnapshot)(s);
        strict_1.default.ok(v.issues.some((i) => i.code === "non_finite_number"));
    });
    (0, node_test_1.it)("rejects Infinity", () => {
        const s = snap({
            limits: { x: (0, value_js_2.policyValue)(Number.POSITIVE_INFINITY, "admin", "hard") },
        });
        const v = (0, validate_js_1.validatePolicySnapshot)(s);
        strict_1.default.ok(v.issues.some((i) => i.code === "non_finite_number"));
    });
    (0, node_test_1.it)("invalid confidence detected", () => {
        strict_1.default.equal((0, value_js_1.isValidConfidence)(1.5), false);
        const s = snap({
            limits: {
                x: { value: 1, source: "admin", strength: "hard", valid: true, confidence: 2 },
            },
        });
        const v = (0, validate_js_1.validatePolicySnapshot)(s);
        strict_1.default.ok(v.issues.some((i) => i.code === "invalid_confidence"));
    });
    (0, node_test_1.it)("invalid mutual exclusion same addon", () => {
        const s = snap({
            protection: {
                mutualExclusions: (0, value_js_2.policyValue)([{ id: "x", addonA: "a", addonB: "a" }], "admin", "hard"),
            },
        });
        const v = (0, validate_js_1.validatePolicySnapshot)(s);
        strict_1.default.ok(v.issues.some((i) => i.code === "mutual_exclusion_same_addon"));
    });
    (0, node_test_1.it)("negative power rejected", () => {
        const s = snap({
            limits: { houseFuseLimitW: (0, value_js_2.policyValue)(-100, "admin", "hard") },
        });
        const v = (0, validate_js_1.validatePolicySnapshot)(s);
        strict_1.default.ok(v.issues.some((i) => i.code === "negative_power_limit"));
    });
    (0, node_test_1.it)("energy priority dedupes", () => {
        strict_1.default.deepEqual((0, normalize_js_1.normalizeEnergyPriority)(["pv", "pv", "battery"]), ["pv", "battery"]);
    });
});
