"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const constants_js_1 = require("./constants.js");
const resolve_js_1 = require("./resolve.js");
const config_js_1 = require("./config.js");
(0, node_test_1.describe)("global modes resolve", () => {
    (0, node_test_1.it)("accepts all five valid modes", () => {
        for (const mode of constants_js_1.GLOBAL_MODES) {
            const r = (0, resolve_js_1.resolveGlobalModes)({
                requestedRaw: mode,
                adminDefault: "balanced",
                hasPersistedRequested: true,
            });
            strict_1.default.equal(r.active, mode);
            strict_1.default.equal(r.valid, true);
        }
    });
    (0, node_test_1.it)("falls back to balanced for invalid mode", () => {
        const r = (0, resolve_js_1.resolveGlobalModes)({
            requestedRaw: "turbo",
            adminDefault: "eco",
            hasPersistedRequested: true,
        });
        strict_1.default.equal(r.active, constants_js_1.DEFAULT_GLOBAL_MODE);
        strict_1.default.equal(r.valid, false);
        strict_1.default.equal(r.status, "fallback");
    });
    (0, node_test_1.it)("fallback sets valid=false", () => {
        const r = (0, resolve_js_1.resolveGlobalModes)({
            requestedRaw: "invalid",
            adminDefault: "balanced",
            hasPersistedRequested: true,
        });
        strict_1.default.equal(r.valid, false);
    });
    (0, node_test_1.it)("issues_json contains fallback reason", () => {
        const r = (0, resolve_js_1.resolveGlobalModes)({
            requestedRaw: "nope",
            adminDefault: "balanced",
            hasPersistedRequested: true,
        });
        strict_1.default.ok(r.issues.some((i) => i.code === "global_mode_fallback"));
    });
    (0, node_test_1.it)("missing value uses admin default", () => {
        const r = (0, resolve_js_1.resolveGlobalModes)({
            requestedRaw: "",
            adminDefault: "eco",
            hasPersistedRequested: false,
        });
        strict_1.default.equal(r.active, "eco");
        strict_1.default.equal(r.requested, "eco");
    });
    (0, node_test_1.it)("invalid admin default resolves via config helper to balanced", () => {
        strict_1.default.equal((0, config_js_1.globalModeDefaultFromConfig)({ global_mode_default: "bogus" }), constants_js_1.DEFAULT_GLOBAL_MODE);
    });
    (0, node_test_1.it)("validateRequestedMode rejects unknown", () => {
        const v = (0, resolve_js_1.validateRequestedMode)("xyz");
        strict_1.default.equal(v.mode, null);
        strict_1.default.ok(v.issue);
    });
});
(0, node_test_1.describe)("global modes admin-default decision", () => {
    (0, node_test_1.it)("first init without runtime value adopts admin default", () => {
        const d = (0, resolve_js_1.decideRequestedWrite)({ currentRequestedRaw: "", adminDefault: "eco", lastAdminSeen: null });
        strict_1.default.equal(d.writeRequested, "eco");
        strict_1.default.equal(d.reason, "first_init");
    });
    (0, node_test_1.it)("keeps runtime value on plain restart (admin default unchanged)", () => {
        const d = (0, resolve_js_1.decideRequestedWrite)({
            currentRequestedRaw: "forced",
            adminDefault: "balanced",
            lastAdminSeen: "balanced",
        });
        strict_1.default.equal(d.writeRequested, null);
        strict_1.default.equal(d.reason, "keep");
    });
    (0, node_test_1.it)("applies admin default when it actively changed", () => {
        const d = (0, resolve_js_1.decideRequestedWrite)({
            currentRequestedRaw: "balanced",
            adminDefault: "eco",
            lastAdminSeen: "balanced",
        });
        strict_1.default.equal(d.writeRequested, "eco");
        strict_1.default.equal(d.reason, "admin_changed");
    });
    (0, node_test_1.it)("does not clobber existing runtime value when no admin default was seen yet", () => {
        const d = (0, resolve_js_1.decideRequestedWrite)({
            currentRequestedRaw: "comfort",
            adminDefault: "balanced",
            lastAdminSeen: null,
        });
        strict_1.default.equal(d.writeRequested, null);
        strict_1.default.equal(d.reason, "keep");
    });
});
