import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { operatorQuality } from "../../quality";
import {
	buildFlexibleDemandSlot,
	estimateImmersionRequiredEnergyKwh,
	IMMERSION_DEFAULT_KWH_PER_DEGREE_C,
} from "./flex_demand";

describe("flex demand slots", () => {
	it("estimates immersion energy from temperature delta", () => {
		const kwh = estimateImmersionRequiredEnergyKwh(50, 60, 1700);
		assert.equal(kwh, round3(10 * IMMERSION_DEFAULT_KWH_PER_DEGREE_C));
	});

	it("returns zero when already at target", () => {
		assert.equal(estimateImmersionRequiredEnergyKwh(60, 60, 1700), 0);
	});

	it("caps by max power and day window", () => {
		const kwh = estimateImmersionRequiredEnergyKwh(10, 100, 1700);
		assert.equal(kwh, round3((1700 / 1000) * 18));
	});

	it("adds a learned loss margin when the thermal model is valid", () => {
		const base = estimateImmersionRequiredEnergyKwh(50, 60, 1700);
		const withMargin = estimateImmersionRequiredEnergyKwh(50, 60, 1700, {
			status: "valid",
			coolingRateCPerHAvg: 1.2,
		});
		assert.ok(withMargin > base);
		assert.equal(withMargin, round3(base + round3(1.2 * 0.25) * IMMERSION_DEFAULT_KWH_PER_DEGREE_C));
	});

	it("ignores the learning margin when the model is degraded or missing", () => {
		const base = estimateImmersionRequiredEnergyKwh(50, 60, 1700);
		const degraded = estimateImmersionRequiredEnergyKwh(50, 60, 1700, {
			status: "degraded",
			coolingRateCPerHAvg: 1.2,
		});
		const missing = estimateImmersionRequiredEnergyKwh(50, 60, 1700, {
			status: "missing",
			coolingRateCPerHAvg: null,
		});
		assert.equal(degraded, base);
		assert.equal(missing, base);
	});

	it("still returns zero at target even with a learning margin supplied", () => {
		const kwh = estimateImmersionRequiredEnergyKwh(60, 60, 1700, {
			status: "valid",
			coolingRateCPerHAvg: 1.2,
		});
		assert.equal(kwh, 0);
	});

	it("builds a single demand slot when energy and power are valid", () => {
		const quality = operatorQuality("valid", "OK");
		const slots = buildFlexibleDemandSlot({
			generatedAt: "2026-07-11T10:00:00.000Z",
			requiredEnergyKwh: 2.5,
			maxPowerW: 1700,
			available: true,
			quality,
			reasonDe: "OK",
		});
		assert.equal(slots.length, 1);
		assert.equal(slots[0].requiredEnergyKwh, 2.5);
		assert.equal(slots[0].maxPowerW, 1700);
	});

	it("returns empty slots when unavailable", () => {
		const quality = operatorQuality("disabled", "Aus");
		const slots = buildFlexibleDemandSlot({
			generatedAt: "2026-07-11T10:00:00.000Z",
			requiredEnergyKwh: 2.5,
			maxPowerW: 1700,
			available: false,
			quality,
			reasonDe: "Aus",
		});
		assert.equal(slots.length, 0);
	});
});

function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}
