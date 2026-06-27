"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const normalize_js_1 = require("./normalize.js");
const TZ = "Europe/Berlin";
(0, node_test_1.describe)("wallbox intent normalize", () => {
    (0, node_test_1.it)("off -> off", () => {
        strict_1.default.equal((0, normalize_js_1.normalizeEvccMode)("off").strategy, "off");
    });
    (0, node_test_1.it)("minpv -> min_pv", () => {
        strict_1.default.equal((0, normalize_js_1.normalizeEvccMode)("minpv").strategy, "min_pv");
    });
    (0, node_test_1.it)("min_pv -> min_pv", () => {
        strict_1.default.equal((0, normalize_js_1.normalizeEvccMode)("min_pv").strategy, "min_pv");
    });
    (0, node_test_1.it)("pv -> pv", () => {
        strict_1.default.equal((0, normalize_js_1.normalizeEvccMode)("pv").strategy, "pv");
    });
    (0, node_test_1.it)("now -> immediate", () => {
        strict_1.default.equal((0, normalize_js_1.normalizeEvccMode)("now").strategy, "immediate");
    });
    (0, node_test_1.it)("case insensitive", () => {
        strict_1.default.equal((0, normalize_js_1.normalizeEvccMode)("  PV ").strategy, "pv");
    });
    (0, node_test_1.it)("unknown mode stays unknown with raw", () => {
        const r = (0, normalize_js_1.normalizeEvccMode)("weirdmode");
        strict_1.default.equal(r.strategy, "unknown");
        strict_1.default.equal(r.raw, "weirdmode");
    });
    (0, node_test_1.it)("target soc 0 is valid not missing", () => {
        const r = (0, normalize_js_1.normalizeTargetSoc)(0);
        strict_1.default.equal(r.value, 0);
        strict_1.default.equal(r.status, "valid");
    });
    (0, node_test_1.it)("target soc 100 valid", () => {
        strict_1.default.equal((0, normalize_js_1.normalizeTargetSoc)(100).status, "valid");
    });
    (0, node_test_1.it)("target soc negative invalid", () => {
        strict_1.default.equal((0, normalize_js_1.normalizeTargetSoc)(-1).status, "invalid");
    });
    (0, node_test_1.it)("target soc over 100 invalid", () => {
        strict_1.default.equal((0, normalize_js_1.normalizeTargetSoc)(101).status, "invalid");
    });
    (0, node_test_1.it)("NaN invalid", () => {
        strict_1.default.equal((0, normalize_js_1.normalizeTargetSoc)(NaN).status, "invalid");
    });
    (0, node_test_1.it)("ISO deadline normalized", () => {
        const now = new Date("2026-06-27T10:00:00Z");
        const r = (0, normalize_js_1.normalizeDeadline)("2026-06-27T18:00:00+02:00", TZ, now);
        strict_1.default.equal(r.status, "valid");
        strict_1.default.ok(r.value?.at);
    });
    (0, node_test_1.it)("unix seconds normalized", () => {
        const now = new Date("2026-01-01T00:00:00Z");
        const sec = Math.floor(new Date("2026-06-27T18:00:00Z").getTime() / 1000);
        const r = (0, normalize_js_1.normalizeDeadline)(sec, TZ, now);
        strict_1.default.equal(r.status, "valid");
    });
    (0, node_test_1.it)("unix ms normalized", () => {
        const now = new Date("2026-01-01T00:00:00Z");
        const ms = new Date("2026-06-27T18:00:00Z").getTime();
        const r = (0, normalize_js_1.normalizeDeadline)(ms, TZ, now);
        strict_1.default.equal(r.status, "valid");
    });
    (0, node_test_1.it)("invalid deadline", () => {
        const now = new Date();
        strict_1.default.equal((0, normalize_js_1.normalizeDeadline)("not-a-date", TZ, now).status, "invalid");
    });
    (0, node_test_1.it)("past deadline expired", () => {
        const now = new Date("2026-06-27T12:00:00Z");
        const r = (0, normalize_js_1.normalizeDeadline)("2026-06-27T08:00:00Z", TZ, now);
        strict_1.default.equal(r.status, "expired");
    });
});
