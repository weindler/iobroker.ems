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
(0, node_test_1.describe)("battery intent resolver", () => {
    (0, node_test_1.it)("disabled when addon inactive", () => {
        const r = (0, resolve_js_1.resolveBatteryIntent)({ now: NOW, previous: null, iobroker: null, override: null, active: false });
        strict_1.default.equal(r.intent_state, "disabled");
    });
    (0, node_test_1.it)("target soc 0 and 100 valid", () => {
        for (const soc of [0, 100]) {
            const iobroker = {
                observed_at: ISO,
                operating_request: null,
                target_soc_pct: iobrokerField(soc),
                grid_charge_request: null,
                ev_discharge_allowed: null,
                top_off_requested: null,
                manual_override: null,
                request_id: `b-${soc}`,
            };
            const r = (0, resolve_js_1.resolveBatteryIntent)({ now: NOW, previous: null, iobroker, override: null, active: true });
            strict_1.default.equal(r.target_soc_pct.value, soc);
        }
    });
    (0, node_test_1.it)("grid charge and top_off from request", () => {
        const iobroker = {
            observed_at: ISO,
            operating_request: iobrokerField("hold"),
            target_soc_pct: null,
            grid_charge_request: iobrokerField("deny"),
            ev_discharge_allowed: iobrokerField(false),
            top_off_requested: iobrokerField(true),
            manual_override: null,
            request_id: "b1",
        };
        const r = (0, resolve_js_1.resolveBatteryIntent)({ now: NOW, previous: null, iobroker, override: null, active: true });
        strict_1.default.equal(r.grid_charge_request.value, "deny");
        strict_1.default.equal(r.ev_discharge_allowed.value, false);
        strict_1.default.equal(r.top_off_requested.value, true);
    });
    (0, node_test_1.it)("override only in scope", () => {
        const iobroker = {
            observed_at: ISO,
            operating_request: iobrokerField("charge"),
            target_soc_pct: iobrokerField(80),
            grid_charge_request: null,
            ev_discharge_allowed: null,
            top_off_requested: null,
            manual_override: null,
            request_id: "b2",
        };
        const r = (0, resolve_js_1.resolveBatteryIntent)({
            now: NOW,
            previous: null,
            iobroker,
            override: { active: true, scope: ["target_soc_pct"], source: "iobroker", owner: "user" },
            active: true,
        });
        strict_1.default.equal(r.operating_request.value, "charge");
        strict_1.default.equal(r.target_soc_pct.value, 80);
    });
});
