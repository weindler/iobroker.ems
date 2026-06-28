import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeBatteryPower, normalizeTelemetry } from "./telemetry.js";

describe("battery telemetry normalization", () => {
	it("positive_charge: positive power = charging", () => {
		const p = normalizeBatteryPower(1500, "positive_charge");
		assert.equal(p.powerW, 1500);
		assert.equal(p.chargingPowerW, 1500);
		assert.equal(p.dischargingPowerW, 0);
	});

	it("positive_discharge: positive power = discharging (sign flipped)", () => {
		const p = normalizeBatteryPower(1500, "positive_discharge");
		assert.equal(p.powerW, -1500);
		assert.equal(p.chargingPowerW, 0);
		assert.equal(p.dischargingPowerW, 1500);
	});

	it("missing power is not 0", () => {
		const { telemetry, quality } = normalizeTelemetry({
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
		assert.equal(telemetry.powerW, null);
		assert.equal(quality.powerValid, false);
	});

	it("real 0 W is a valid standstill", () => {
		const { telemetry, quality } = normalizeTelemetry({
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
		assert.equal(telemetry.powerW, 0);
		assert.equal(quality.powerValid, true);
	});

	it("stale when older than max age", () => {
		const now = 1_000_000_000_000;
		const { telemetry } = normalizeTelemetry({
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
		assert.equal(telemetry.stale, true);
	});

	it("missing required values reported", () => {
		const { quality } = normalizeTelemetry({
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
		assert.deepEqual(quality.missingRequiredValues.sort(), ["power", "soc"]);
	});
});
