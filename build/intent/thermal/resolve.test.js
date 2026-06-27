"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const resolve_js_1 = require("./resolve.js");
const NOW = new Date("2026-06-27T12:00:00Z");
const ISO = NOW.toISOString();
function iobrokerField(value) {
    return {
        value,
        status: "valid",
        origin: { source: "iobroker", owner: "user", change_kind: "manual_explicit" },
        observed_at: ISO,
        changed_at: ISO,
    };
}
(0, node_test_1.describe)("thermal intent resolver", () => {
    (0, node_test_1.it)("disabled when addon inactive", () => {
        const r = (0, resolve_js_1.resolveThermalIntent)({ now: NOW, previous: null, iobroker: null, override: null, active: false });
        strict_1.default.equal(r.intent_state, "disabled");
    });
    (0, node_test_1.it)("accepts valid operating_request from iobroker", () => {
        const iobroker = {
            observed_at: ISO,
            operating_request: iobrokerField("force_on"),
            target_temperature_c: null,
            ready_at: null,
            priority: null,
            manual_override: null,
            request_id: "t1",
        };
        const r = (0, resolve_js_1.resolveThermalIntent)({ now: NOW, previous: null, iobroker, override: null, active: true });
        strict_1.default.equal(r.operating_request.value, "force_on");
        strict_1.default.equal(r.intent_state, "partial");
    });
    (0, node_test_1.it)("override only affects scoped field", () => {
        const iobroker = {
            observed_at: ISO,
            operating_request: iobrokerField("auto"),
            target_temperature_c: iobrokerField(55),
            ready_at: null,
            priority: null,
            manual_override: null,
            request_id: "t2",
        };
        const r = (0, resolve_js_1.resolveThermalIntent)({
            now: NOW,
            previous: null,
            iobroker,
            override: { active: true, scope: ["operating_request"], source: "iobroker", owner: "user" },
            active: true,
        });
        strict_1.default.equal(r.operating_request.value, "auto");
        strict_1.default.equal(r.target_temperature_c.value, 55);
    });
    (0, node_test_1.it)("unknown operating mode stays unknown", () => {
        const iobroker = {
            observed_at: ISO,
            operating_request: iobrokerField("unknown"),
            target_temperature_c: null,
            ready_at: null,
            priority: null,
            manual_override: null,
            request_id: "t3",
        };
        const r = (0, resolve_js_1.resolveThermalIntent)({ now: NOW, previous: null, iobroker, override: null, active: true });
        strict_1.default.equal(r.operating_request.value, "unknown");
    });
});
