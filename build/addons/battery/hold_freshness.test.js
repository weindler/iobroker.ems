"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const hold_freshness_js_1 = require("./hold_freshness.js");
const grid_balance_contract_js_1 = require("./grid_balance_contract.js");
const write_allowlist_js_1 = require("../wallbox/ev_foundation/write_allowlist.js");
const SRC = (0, node_path_1.join)(__dirname, "..", "..", "..", "src", "addons", "battery");
const TICK_SRC = (0, node_path_1.join)(__dirname, "..", "..", "..", "src", "operator", "daily_plan", "tick.ts");
const NOW = Date.parse("2026-08-17T12:00:00.000Z");
(0, node_test_1.describe)("grid balance hold freshness", () => {
    (0, node_test_1.it)("stale constraint true + live holds false → hold_detected false", () => {
        const r = (0, hold_freshness_js_1.resolveGridBalanceHoldSignals)({
            nowMs: NOW,
            constraintHoldState: { val: true, ts: NOW - 40 * 24 * 3600_000 },
            deviceIntentHold: false,
            batteryHoldForEvCharge: false,
            evccBatteryMode: "normal",
            evccDischargeControl: false,
        });
        strict_1.default.equal(r.constraintHoldFresh, false);
        strict_1.default.equal(r.holdActive, false);
        strict_1.default.equal(r.holdDetected, false);
    });
    (0, node_test_1.it)("constraint true without ts is not current", () => {
        strict_1.default.equal((0, hold_freshness_js_1.isFreshTrue)({ val: true }, NOW), false);
        strict_1.default.equal((0, hold_freshness_js_1.isFreshTrue)({ val: true, ts: Number.NaN }, NOW), false);
        strict_1.default.equal((0, hold_freshness_js_1.isFreshTrue)(null, NOW), false);
    });
    (0, node_test_1.it)("fresh constraint true is a current hold", () => {
        const r = (0, hold_freshness_js_1.resolveGridBalanceHoldSignals)({
            nowMs: NOW,
            constraintHoldState: { val: true, ts: NOW - 60_000 },
            deviceIntentHold: false,
            batteryHoldForEvCharge: false,
            evccBatteryMode: "normal",
            evccDischargeControl: false,
        });
        strict_1.default.equal(r.constraintHoldFresh, true);
        strict_1.default.equal(r.holdDetected, true);
    });
    (0, node_test_1.it)("fresh true older than max age is stale", () => {
        strict_1.default.equal((0, hold_freshness_js_1.isFreshTrue)({ val: true, ts: NOW - hold_freshness_js_1.PLANNER_HOLD_CONSTRAINT_MAX_AGE_MS - 1 }, NOW), false);
        strict_1.default.equal((0, hold_freshness_js_1.isFreshTrue)({ val: true, ts: NOW - hold_freshness_js_1.PLANNER_HOLD_CONSTRAINT_MAX_AGE_MS }, NOW), true);
    });
    (0, node_test_1.it)("live EV-charge hold is current even if constraint is stale", () => {
        const r = (0, hold_freshness_js_1.resolveGridBalanceHoldSignals)({
            nowMs: NOW,
            constraintHoldState: { val: true, ts: NOW - 40 * 24 * 3600_000 },
            deviceIntentHold: false,
            batteryHoldForEvCharge: true,
            evccBatteryMode: "normal",
            evccDischargeControl: false,
        });
        strict_1.default.equal(r.constraintHoldFresh, false);
        strict_1.default.equal(r.holdDetected, true);
    });
    (0, node_test_1.it)("deviceIntent hold is current", () => {
        const r = (0, hold_freshness_js_1.resolveGridBalanceHoldSignals)({
            nowMs: NOW,
            constraintHoldState: { val: false, ts: NOW },
            deviceIntentHold: true,
            batteryHoldForEvCharge: false,
            evccBatteryMode: "normal",
            evccDischargeControl: false,
        });
        strict_1.default.equal(r.holdPlanned, true);
        strict_1.default.equal(r.holdDetected, true);
    });
    (0, node_test_1.it)("EVCC battery_mode hold and holdcharge are current holds", () => {
        strict_1.default.equal((0, hold_freshness_js_1.isEvccBatteryHoldMode)("hold"), true);
        strict_1.default.equal((0, hold_freshness_js_1.isEvccBatteryHoldMode)("holdcharge"), true);
        strict_1.default.equal((0, hold_freshness_js_1.isEvccBatteryHoldMode)("HOLDCHARGE"), true);
        strict_1.default.equal((0, hold_freshness_js_1.isEvccBatteryHoldMode)("normal"), false);
        strict_1.default.equal((0, hold_freshness_js_1.isEvccBatteryHoldMode)(""), false);
        const r = (0, hold_freshness_js_1.resolveGridBalanceHoldSignals)({
            nowMs: NOW,
            constraintHoldState: { val: false, ts: NOW },
            deviceIntentHold: false,
            batteryHoldForEvCharge: false,
            evccBatteryMode: "holdcharge",
            evccDischargeControl: false,
        });
        strict_1.default.equal(r.evccBatteryModeHold, true);
        strict_1.default.equal(r.holdDetected, true);
    });
    (0, node_test_1.it)("daily plan always refreshes hold constraints; GB ignores stale ts", () => {
        const tick = (0, node_fs_1.readFileSync)(TICK_SRC, "utf8");
        strict_1.default.match(tick, /host\.setStateAsync\(\s*"planner\.constraints\.battery_hold_active"/);
        strict_1.default.match(tick, /host\.setStateAsync\(\s*"planner\.constraints\.evcc_battery_hold"/);
        strict_1.default.equal(tick.includes('setStateIfChanged(host, "planner.constraints.battery_hold_active"'), false);
        strict_1.default.equal(tick.includes('setStateIfChanged(host, "planner.constraints.evcc_battery_hold"'), false);
        const idx = (0, node_fs_1.readFileSync)((0, node_path_1.join)(SRC, "index.ts"), "utf8");
        strict_1.default.match(idx, /resolveGridBalanceHoldSignals/);
        strict_1.default.match(idx, /constraintHoldState/);
        strict_1.default.equal(grid_balance_contract_js_1.GRID_BALANCE_EXECUTION_ENABLED, false);
        strict_1.default.equal(write_allowlist_js_1.EV_EXECUTION_PHASE5_ENABLED, false);
    });
});
