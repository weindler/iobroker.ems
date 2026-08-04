import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	nextBridgeUntilIso,
	resolveImmersionNightBridge,
} from "./immersion_night_bridge";

describe("immersion night bridge", () => {
	it("nextBridgeUntilIso uses today morning when still before 08:00 local", () => {
		// 2026-08-04 06:00 CEST
		const now = new Date("2026-08-04T04:00:00.000Z");
		assert.equal(nextBridgeUntilIso(now, "Europe/Berlin", 8), "2026-08-04T06:00:00.000Z");
	});

	it("nextBridgeUntilIso rolls to tomorrow after morning hour", () => {
		// 2026-08-04 17:00 CEST
		const now = new Date("2026-08-04T15:00:00.000Z");
		assert.equal(nextBridgeUntilIso(now, "Europe/Berlin", 8), "2026-08-05T06:00:00.000Z");
	});

	it("inactive when empty_at already after next morning", () => {
		const now = new Date("2026-08-04T12:00:00.000Z"); // 14:00 CEST
		const r = resolveImmersionNightBridge({
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
		assert.equal(r.active, false);
		assert.equal(r.deadlineIso, null);
		assert.equal(r.effectiveTargetTempC, 51.6);
	});

	it("raises target and sets deadline when empty_at is before next morning", () => {
		const now = new Date("2026-08-04T12:00:00.000Z"); // 14:00 CEST
		// Leer Di 20:26 CEST = 18:26Z; Morgen Mi 08:00 CEST = 06:00Z
		const r = resolveImmersionNightBridge({
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
		assert.equal(r.active, true);
		assert.equal(r.deadlineIso, "2026-08-04T18:26:00.000Z");
		assert.equal(r.bridgeUntilIso, "2026-08-05T06:00:00.000Z");
		// shortfall ≈ (06:00Z - 18:26Z) + 1h = 11.566+1 ≈ 12.567 h → +12.6 °C → 59.6
		assert.ok(r.bridgeTargetTempC !== null && r.bridgeTargetTempC > 51.6);
		assert.ok(r.effectiveTargetTempC >= r.bridgeTargetTempC!);
		assert.ok(r.effectiveTargetTempC > 51.6);
		assert.match(r.reasonDe, /Nachtbrücke/);
	});

	it("clamps bridge target to planning max", () => {
		const now = new Date("2026-08-04T12:00:00.000Z");
		const r = resolveImmersionNightBridge({
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
		assert.equal(r.active, true);
		assert.equal(r.bridgeTargetTempC, 55);
		assert.equal(r.effectiveTargetTempC, 55);
	});
});
