"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const normalize_1 = require("./normalize");
(0, node_test_1.describe)("wallbox evcc normalize", () => {
    (0, node_test_1.it)("does not invent false for missing bool", () => {
        const r = (0, normalize_1.normalizeOptionalBool)(null);
        strict_1.default.equal(r.status, "missing");
        strict_1.default.equal(r.value, null);
    });
    (0, node_test_1.it)("does not invent 0 for missing number", () => {
        const r = (0, normalize_1.normalizeOptionalNumber)(undefined);
        strict_1.default.equal(r.status, "missing");
        strict_1.default.equal(r.value, null);
    });
    (0, node_test_1.it)("accepts explicit false and zero", () => {
        strict_1.default.equal((0, normalize_1.normalizeOptionalBool)(false).value, false);
        strict_1.default.equal((0, normalize_1.normalizeOptionalBool)(0).value, false);
        strict_1.default.equal((0, normalize_1.normalizeOptionalSoc)(0).value, 0);
        strict_1.default.equal((0, normalize_1.normalizeOptionalSoc)(0).status, "valid");
    });
    (0, node_test_1.it)("reads connected and charging booleans", () => {
        strict_1.default.equal((0, normalize_1.normalizeOptionalBool)(true).value, true);
        strict_1.default.equal((0, normalize_1.normalizeOptionalBool)("1").value, true);
        strict_1.default.equal((0, normalize_1.normalizeOptionalBool)("false").value, false);
    });
    (0, node_test_1.it)("reads charge power as number", () => {
        const r = (0, normalize_1.normalizeOptionalNumber)(4200);
        strict_1.default.equal(r.status, "valid");
        strict_1.default.equal(r.value, 4200);
    });
    (0, node_test_1.it)("missingField stays missing", () => {
        const m = (0, normalize_1.missingField)();
        strict_1.default.equal(m.status, "missing");
        strict_1.default.equal(m.value, null);
    });
});
