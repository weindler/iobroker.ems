"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const merge_js_1 = require("./merge.js");
const value_js_1 = require("./value.js");
const schema_js_1 = require("../../global_modes/schema.js");
const build_js_1 = require("../global/build.js");
const config_js_1 = require("../global/config.js");
(0, node_test_1.describe)("policy merge", () => {
    (0, node_test_1.it)("highest minimum wins", () => {
        const a = (0, value_js_1.policyValue)(10, "admin", "hard");
        const b = (0, value_js_1.policyValue)(15, "learning", "hard", { confidence: 0.9 });
        const m = (0, merge_js_1.mergePolicyValues)(a, b, { section: "limits", field: "x", kind: "minimum" });
        strict_1.default.equal(m.value, 15);
    });
    (0, node_test_1.it)("lowest maximum wins", () => {
        const a = (0, value_js_1.policyValue)(5000, "admin", "hard");
        const b = (0, value_js_1.policyValue)(4000, "global_mode", "hard");
        const m = (0, merge_js_1.mergePolicyValues)(a, b, { section: "limits", field: "x", kind: "maximum" });
        strict_1.default.equal(m.value, 4000);
    });
    (0, node_test_1.it)("hard false beats true", () => {
        const a = (0, value_js_1.policyValue)(true, "admin", "hard");
        const b = (0, value_js_1.policyValue)(false, "protection", "hard");
        const m = (0, merge_js_1.mergePolicyValues)(a, b, { section: "protection", field: "x", kind: "hard_boolean" });
        strict_1.default.equal(m.value, false);
    });
    (0, node_test_1.it)("soft preference from global mode overlays", () => {
        const base = (0, value_js_1.policyValue)(0.5, "admin", "soft");
        const overlay = (0, value_js_1.policyValue)(0.9, "global_mode", "soft");
        const m = (0, merge_js_1.mergePolicyValues)(base, overlay, {
            section: "preferences",
            field: "economyWeight",
            kind: "preference",
        });
        strict_1.default.equal(m.value, 0.9);
    });
    (0, node_test_1.it)("protection is not loosened by forced profile", () => {
        const configured = (0, build_js_1.buildConfiguredGlobalPolicy)({
            houseFuseLimitW: 5000,
            maxGridImportW: 5000,
            energyPriority: null,
            mutualExclusions: [{ id: "a", addonA: "battery", addonB: "wallbox" }],
            gridImportAllowed: false,
        });
        const forced = (0, build_js_1.buildEffectiveGlobalPolicy)(configured, (0, schema_js_1.profileForMode)("forced"));
        strict_1.default.equal(forced.economics.gridImportAllowed?.value, false);
    });
    (0, node_test_1.it)("off disables flexible optimization preference", () => {
        const configured = (0, build_js_1.buildConfiguredGlobalPolicy)((0, config_js_1.globalPolicyConfigFromAdapter)({}));
        const off = (0, build_js_1.buildEffectiveGlobalPolicy)(configured, (0, schema_js_1.profileForMode)("off"));
        strict_1.default.equal(off.capabilities.flexibleOptimization?.value, false);
    });
    (0, node_test_1.it)("learning low confidence does not harden limit", () => {
        const base = (0, value_js_1.policyValue)(5000, "admin", "hard");
        const learn = (0, value_js_1.policyValue)(3000, "learning", "hard", { confidence: 0.2 });
        const m = (0, merge_js_1.mergePolicyValues)(base, learn, { section: "limits", field: "max", kind: "maximum" });
        strict_1.default.equal(m.value, 5000);
    });
    (0, node_test_1.it)("learning sufficient confidence tightens max", () => {
        const base = (0, value_js_1.policyValue)(5000, "admin", "hard");
        const learn = (0, value_js_1.policyValue)(4600, "learning", "hard", { confidence: 0.8 });
        const m = (0, merge_js_1.mergePolicyValues)(base, learn, { section: "limits", field: "max", kind: "maximum" });
        strict_1.default.equal(m.value, 4600);
    });
    (0, node_test_1.it)("empty sources yield neutral unknown", () => {
        const u = (0, value_js_1.unknownValue)();
        strict_1.default.equal(u.value, null);
        strict_1.default.equal((0, value_js_1.unknownTriState)().value, "unknown");
    });
});
