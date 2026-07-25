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
