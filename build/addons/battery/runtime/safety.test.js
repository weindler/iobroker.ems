"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const safety_js_1 = require("./safety.js");
function okInput() {
    return {
        targetSocReached: false,
        intentExpired: false,
        intentRevoked: false,
        addonDisabled: false,
        globalLeftLive: false,
        safetyBlocked: false,
        telemetryStale: false,
        communicationLost: false,
        fault: false,
        unloading: false,
        higherPriorityIntent: false,
    };
}
(0, node_test_1.describe)("evaluateStopCondition", () => {
    (0, node_test_1.it)("returns null when nothing applies", () => {
        strict_1.default.equal((0, safety_js_1.evaluateStopCondition)(okInput()), null);
    });
    (0, node_test_1.it)("fault has the highest priority", () => {
        strict_1.default.equal((0, safety_js_1.evaluateStopCondition)({ ...okInput(), fault: true, communicationLost: true, unloading: true }), "fault");
    });
    (0, node_test_1.it)("communication_lost outranks addon_disabled/global_left_live", () => {
        strict_1.default.equal((0, safety_js_1.evaluateStopCondition)({ ...okInput(), communicationLost: true, addonDisabled: true }), "communication_lost");
    });
    (0, node_test_1.it)("adapter_unload outranks addon_disabled", () => {
        strict_1.default.equal((0, safety_js_1.evaluateStopCondition)({ ...okInput(), unloading: true, addonDisabled: true }), "adapter_unload");
    });
    (0, node_test_1.it)("addon_disabled outranks global_left_live", () => {
        strict_1.default.equal((0, safety_js_1.evaluateStopCondition)({ ...okInput(), addonDisabled: true, globalLeftLive: true }), "addon_disabled");
    });
    (0, node_test_1.it)("global_left_live outranks safety_blocked", () => {
        strict_1.default.equal((0, safety_js_1.evaluateStopCondition)({ ...okInput(), globalLeftLive: true, safetyBlocked: true }), "global_left_live");
    });
    (0, node_test_1.it)("safety_blocked (hardware SOC ceiling) outranks telemetry_stale", () => {
        strict_1.default.equal((0, safety_js_1.evaluateStopCondition)({ ...okInput(), safetyBlocked: true, telemetryStale: true }), "safety_blocked");
    });
    (0, node_test_1.it)("telemetry_stale outranks intent_revoked", () => {
        strict_1.default.equal((0, safety_js_1.evaluateStopCondition)({ ...okInput(), telemetryStale: true, intentRevoked: true }), "telemetry_stale");
    });
    (0, node_test_1.it)("intent_revoked outranks intent_expired", () => {
        strict_1.default.equal((0, safety_js_1.evaluateStopCondition)({ ...okInput(), intentRevoked: true, intentExpired: true }), "intent_revoked");
    });
    (0, node_test_1.it)("intent_expired outranks target_soc_reached", () => {
        strict_1.default.equal((0, safety_js_1.evaluateStopCondition)({ ...okInput(), intentExpired: true, targetSocReached: true }), "intent_expired");
    });
    (0, node_test_1.it)("target_soc_reached outranks higher_priority_intent", () => {
        strict_1.default.equal((0, safety_js_1.evaluateStopCondition)({ ...okInput(), targetSocReached: true, higherPriorityIntent: true }), "target_soc_reached");
    });
    (0, node_test_1.it)("higher_priority_intent is the lowest-priority stop reason", () => {
        strict_1.default.equal((0, safety_js_1.evaluateStopCondition)({ ...okInput(), higherPriorityIntent: true }), "higher_priority_intent");
    });
});
