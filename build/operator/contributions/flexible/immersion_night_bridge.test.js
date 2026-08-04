"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const immersion_night_bridge_1 = require("./immersion_night_bridge");
(0, node_test_1.describe)("immersion night bridge", () => {
    (0, node_test_1.it)("nextBridgeUntilIso uses today morning when still before 08:00 local", () => {
        // 2026-08-04 06:00 CEST
        const now = new Date("2026-08-04T04:00:00.000Z");
        strict_1.default.equal((0, immersion_night_bridge_1.nextBridgeUntilIso)(now, "Europe/Berlin", 8), "2026-08-04T06:00:00.000Z");
    });
    (0, node_test_1.it)("nextBridgeUntilIso rolls to tomorrow after morning hour", () => {
        // 2026-08-04 17:00 CEST
        const now = new Date("2026-08-04T15:00:00.000Z");
        strict_1.default.equal((0, immersion_night_bridge_1.nextBridgeUntilIso)(now, "Europe/Berlin", 8), "2026-08-05T06:00:00.000Z");
    });
    (0, node_test_1.it)("inactive when empty_at already after next morning", () => {
        const now = new Date("2026-08-04T12:00:00.000Z"); // 14:00 CEST
        const r = (0, immersion_night_bridge_1.resolveImmersionNightBridge)({
            now,
            bufferTempC: 52,
            planningMinTempC: 44,
            planningMaxTempC: 63,
            forecastTargetTempC: 51.6,
            coolingRateCPerHAvg: 1.0,
            estimatedEmptyAtIso: "2026-08-06T10:00:00.000Z",
            timezone: "Europe/Berlin",
            safetyHours: 1,
        });
        strict_1.default.equal(r.active, false);
        strict_1.default.equal(r.deadlineIso, null);
        strict_1.default.equal(r.effectiveTargetTempC, 51.6);
    });
    (0, node_test_1.it)("raises target and sets deadline when empty_at is before next morning", () => {
        const now = new Date("2026-08-04T12:00:00.000Z"); // 14:00 CEST
        // Leer Di 20:26 CEST = 18:26Z; Morgen Mi 08:00 CEST = 06:00Z
        const r = (0, immersion_night_bridge_1.resolveImmersionNightBridge)({
            now,
            bufferTempC: 47,
            planningMinTempC: 44,
            planningMaxTempC: 63,
            forecastTargetTempC: 51.6,
            coolingRateCPerHAvg: 1.0,
            estimatedEmptyAtIso: "2026-08-04T18:26:00.000Z",
            timezone: "Europe/Berlin",
            safetyHours: 1,
        });
        strict_1.default.equal(r.active, true);
        strict_1.default.equal(r.deadlineIso, "2026-08-04T18:26:00.000Z");
        strict_1.default.equal(r.bridgeUntilIso, "2026-08-05T06:00:00.000Z");
        // shortfall ≈ (06:00Z - 18:26Z) + 1h = 11.566+1 ≈ 12.567 h → +12.6 °C → 59.6
        strict_1.default.ok(r.bridgeTargetTempC !== null && r.bridgeTargetTempC > 51.6);
        strict_1.default.ok(r.effectiveTargetTempC >= r.bridgeTargetTempC);
        strict_1.default.ok(r.effectiveTargetTempC > 51.6);
        strict_1.default.match(r.reasonDe, /Nachtbrücke/);
    });
    (0, node_test_1.it)("clamps bridge target to planning max", () => {
        const now = new Date("2026-08-04T12:00:00.000Z");
        const r = (0, immersion_night_bridge_1.resolveImmersionNightBridge)({
            now,
            bufferTempC: 50,
            planningMinTempC: 44,
            planningMaxTempC: 55,
            forecastTargetTempC: 51.6,
            coolingRateCPerHAvg: 2.0,
            estimatedEmptyAtIso: "2026-08-04T16:00:00.000Z",
            timezone: "Europe/Berlin",
            safetyHours: 1,
        });
        strict_1.default.equal(r.active, true);
        strict_1.default.equal(r.bridgeTargetTempC, 55);
        strict_1.default.equal(r.effectiveTargetTempC, 55);
    });
});
