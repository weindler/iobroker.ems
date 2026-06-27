"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const iobroker_thermal_js_1 = require("./iobroker_thermal.js");
const iobroker_battery_js_1 = require("./iobroker_battery.js");
const ADMIN = { defaultChargeStrategy: null, defaultTargetSocPct: null, timezone: "Europe/Berlin", manualOverrideMaxMinutes: null };
const NOW = new Date("2026-06-27T12:00:00Z");
function baseReq(id) {
    return {
        schema_version: 1,
        request_id: id,
        issued_at: NOW.toISOString(),
        owner: { type: "user" },
    };
}
(0, node_test_1.describe)("iobroker thermal request", () => {
    (0, node_test_1.it)("accepts valid request", () => {
        const out = (0, iobroker_thermal_js_1.processIobrokerThermalRequest)({
            raw: JSON.stringify({ ...baseReq("th-1"), values: { operating_request: "force_on", priority: "before_ev" } }),
            ack: false,
            now: NOW,
            admin: ADMIN,
            lastRequestId: null,
            currentRevision: 0,
            existingSnapshot: null,
        });
        strict_1.default.equal(out.result.status, "accepted");
        strict_1.default.equal(out.snapshot?.operating_request?.value, "force_on");
    });
    (0, node_test_1.it)("duplicate request", () => {
        const raw = JSON.stringify({ ...baseReq("dup-th"), values: { operating_request: "auto" } });
        const input = { raw, ack: false, now: NOW, admin: ADMIN, lastRequestId: "dup-th", currentRevision: 1, existingSnapshot: null };
        strict_1.default.equal((0, iobroker_thermal_js_1.processIobrokerThermalRequest)(input).result.status, "duplicate");
    });
    (0, node_test_1.it)("ack true ignored", () => {
        strict_1.default.equal((0, iobroker_thermal_js_1.processIobrokerThermalRequest)({
            raw: "{}",
            ack: true,
            now: NOW,
            admin: ADMIN,
            lastRequestId: null,
            currentRevision: 0,
            existingSnapshot: null,
        }).result.status, "rejected_invalid");
    });
});
(0, node_test_1.describe)("iobroker battery request", () => {
    (0, node_test_1.it)("accepts partial with invalid soc", () => {
        const out = (0, iobroker_battery_js_1.processIobrokerBatteryRequest)({
            raw: JSON.stringify({ ...baseReq("bat-1"), values: { operating_request: "hold", target_soc_pct: 150 } }),
            ack: false,
            now: NOW,
            admin: ADMIN,
            lastRequestId: null,
            currentRevision: 0,
            existingSnapshot: null,
        });
        strict_1.default.equal(out.result.status, "accepted_partial");
        strict_1.default.equal(out.snapshot?.operating_request?.value, "hold");
    });
    (0, node_test_1.it)("clear field", () => {
        const existing = {
            observed_at: NOW.toISOString(),
            operating_request: null,
            target_soc_pct: {
                value: 80,
                status: "valid",
                origin: { source: "iobroker", owner: "user", change_kind: "manual_explicit" },
                observed_at: NOW.toISOString(),
            },
            grid_charge_request: null,
            ev_discharge_allowed: null,
            top_off_requested: null,
            manual_override: null,
            request_id: "old",
        };
        const out = (0, iobroker_battery_js_1.processIobrokerBatteryRequest)({
            raw: JSON.stringify({ ...baseReq("bat-clear"), clear_fields: ["target_soc_pct"] }),
            ack: false,
            now: NOW,
            admin: ADMIN,
            lastRequestId: null,
            currentRevision: 1,
            existingSnapshot: existing,
        });
        strict_1.default.equal(out.result.status, "accepted");
        strict_1.default.equal(out.snapshot?.target_soc_pct, null);
    });
});
