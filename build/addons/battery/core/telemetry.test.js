"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const telemetry_js_1 = require("./telemetry.js");
(0, node_test_1.describe)("battery telemetry normalization", () => {
    (0, node_test_1.it)("positive_charge: positive power = charging", () => {
        const p = (0, telemetry_js_1.normalizeBatteryPower)(1500, "positive_charge");
        strict_1.default.equal(p.powerW, 1500);
        strict_1.default.equal(p.chargingPowerW, 1500);
        strict_1.default.equal(p.dischargingPowerW, 0);
    });
    (0, node_test_1.it)("positive_discharge: positive power = discharging (sign flipped)", () => {
        const p = (0, telemetry_js_1.normalizeBatteryPower)(1500, "positive_discharge");
        strict_1.default.equal(p.powerW, -1500);
        strict_1.default.equal(p.chargingPowerW, 0);
        strict_1.default.equal(p.dischargingPowerW, 1500);
    });
    (0, node_test_1.it)("missing power is not 0", () => {
        const { telemetry, quality } = (0, telemetry_js_1.normalizeTelemetry)({
            reading: {
                socPct: 50,
                powerW: null,
                capacityNetKwh: 10,
                operatingMode: "self_consumption",
                online: true,
                updatedAtMs: Date.now(),
            },
            signConvention: "positive_charge",
            nowMs: Date.now(),
        });
        strict_1.default.equal(telemetry.powerW, null);
        strict_1.default.equal(quality.powerValid, false);
    });
    (0, node_test_1.it)("real 0 W is a valid standstill", () => {
        const { telemetry, quality } = (0, telemetry_js_1.normalizeTelemetry)({
            reading: {
                socPct: 50,
                powerW: 0,
                capacityNetKwh: 10,
                operatingMode: "idle",
                online: true,
                updatedAtMs: Date.now(),
            },
            signConvention: "positive_charge",
            nowMs: Date.now(),
        });
        strict_1.default.equal(telemetry.powerW, 0);
        strict_1.default.equal(quality.powerValid, true);
    });
    (0, node_test_1.it)("stale when older than max age", () => {
        const now = 1_000_000_000_000;
        const { telemetry } = (0, telemetry_js_1.normalizeTelemetry)({
            reading: {
                socPct: 50,
                powerW: 0,
                capacityNetKwh: 10,
                operatingMode: "idle",
                online: true,
                updatedAtMs: now - 200_000,
            },
            signConvention: "positive_charge",
            nowMs: now,
            maxAgeMs: 120_000,
        });
        strict_1.default.equal(telemetry.stale, true);
    });
    (0, node_test_1.it)("missing required values reported", () => {
        const { quality } = (0, telemetry_js_1.normalizeTelemetry)({
            reading: {
                socPct: null,
                powerW: null,
                capacityNetKwh: null,
                operatingMode: "unknown",
                online: null,
                updatedAtMs: null,
            },
            signConvention: "positive_charge",
            nowMs: Date.now(),
            requiredValues: ["soc", "power"],
        });
        strict_1.default.deepEqual(quality.missingRequiredValues.sort(), ["power", "soc"]);
    });
});
