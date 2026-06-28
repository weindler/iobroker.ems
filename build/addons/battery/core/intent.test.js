"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const intent_js_1 = require("./intent.js");
const types_js_1 = require("../../../intent/battery/types.js");
const NOW = new Date("2026-06-28T10:00:00Z");
function resolved(over) {
    return { ...(0, types_js_1.emptyResolvedBatteryIntent)(NOW, "main"), ...over };
}
function validField(value) {
    return {
        value,
        status: "valid",
        origin: { source: "iobroker", owner: "user", change_kind: "manual_explicit" },
        observed_at: NOW.toISOString(),
    };
}
(0, node_test_1.describe)("device intent translation", () => {
    (0, node_test_1.it)("charge request → charge action", () => {
        const r = (0, intent_js_1.deviceIntentFromResolved)(resolved({ operating_request: validField("charge") }));
        strict_1.default.equal(r.rejected, null);
        strict_1.default.equal(r.intent?.action, "charge");
    });
    (0, node_test_1.it)("grid charge allow → grid_charge action", () => {
        const r = (0, intent_js_1.deviceIntentFromResolved)(resolved({ operating_request: validField("charge"), grid_charge_request: validField("allow") }));
        strict_1.default.equal(r.intent?.action, "grid_charge");
        strict_1.default.equal(r.intent?.energySource, "grid");
    });
    (0, node_test_1.it)("top_off → topoff action", () => {
        const r = (0, intent_js_1.deviceIntentFromResolved)(resolved({ top_off_requested: validField(true) }));
        strict_1.default.equal(r.intent?.action, "topoff");
    });
    (0, node_test_1.it)("discharge structurally rejected", () => {
        const r = (0, intent_js_1.deviceIntentFromResolved)(resolved({ operating_request: validField("discharge") }));
        strict_1.default.equal(r.intent, null);
        strict_1.default.equal(r.rejected, "discharge_not_supported");
    });
    (0, node_test_1.it)("classifies charging and safe-default actions", () => {
        strict_1.default.equal((0, intent_js_1.isChargingAction)("charge"), true);
        strict_1.default.equal((0, intent_js_1.isChargingAction)("topoff"), true);
        strict_1.default.equal((0, intent_js_1.isChargingAction)("self_consumption"), false);
        strict_1.default.equal((0, intent_js_1.isSafeDefaultAction)("self_consumption"), true);
    });
});
