"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const registry_js_1 = require("./registry.js");
const constants_js_1 = require("./constants.js");
function testProvider(id, addonType, instanceId) {
    const empty = {
        meta: {
            schemaVersion: constants_js_1.POLICY_SCHEMA_VERSION,
            engineVersion: constants_js_1.POLICY_ENGINE_VERSION,
            providerId: id,
            addonType,
            instanceId,
        },
        capabilities: {},
        limits: {},
        preferences: {},
        protection: {},
        economics: {},
        validation: { valid: true, status: "valid", issues: [] },
        status: "ready",
    };
    return {
        id,
        addonType,
        instanceId,
        schemaVersion: constants_js_1.POLICY_SCHEMA_VERSION,
        readConfig: async () => ({}),
        readFacts: async () => ({}),
        buildConfiguredPolicy: () => empty,
        buildEffectivePolicy: (c) => c,
        validate: () => ({ valid: true, status: "valid", issues: [] }),
    };
}
(0, node_test_1.describe)("policy provider registry", () => {
    (0, node_test_1.it)("registers provider", () => {
        const reg = new registry_js_1.PolicyProviderRegistry();
        const r = reg.register(testProvider("t1", "demo", "main"));
        strict_1.default.equal(r.ok, true);
        strict_1.default.equal(reg.list().length, 1);
    });
    (0, node_test_1.it)("stable sort order", () => {
        const reg = new registry_js_1.PolicyProviderRegistry();
        reg.register(testProvider("z", "demo", "z"));
        reg.register(testProvider("a", "demo", "a"));
        strict_1.default.deepEqual(reg.list().map((p) => p.id), ["a", "z"]);
    });
    (0, node_test_1.it)("rejects duplicate id", () => {
        const reg = new registry_js_1.PolicyProviderRegistry();
        reg.register(testProvider("dup", "demo", "a"));
        const r = reg.register(testProvider("dup", "demo", "b"));
        strict_1.default.equal(r.ok, false);
    });
    (0, node_test_1.it)("rejects duplicate addon instance", () => {
        const reg = new registry_js_1.PolicyProviderRegistry();
        reg.register(testProvider("p1", "battery", "main"));
        const r = reg.register(testProvider("p2", "battery", "main"));
        strict_1.default.equal(r.ok, false);
    });
    (0, node_test_1.it)("rejects empty id", () => {
        const reg = new registry_js_1.PolicyProviderRegistry();
        const r = reg.register(testProvider("", "demo", "main"));
        strict_1.default.equal(r.ok, false);
    });
});
