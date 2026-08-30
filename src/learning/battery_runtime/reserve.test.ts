import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	NIGHT_RESERVE_SAFETY_MARGIN_FRACTION,
	resolveRequiredSocAtPvEndPct,
} from "./reserve.js";

describe("dynamic battery reserve (Phase 1d)", () => {
	it("derives requiredSocAtPvEndPct from predicted night consumption + capacity + margin", () => {
		const r = resolveRequiredSocAtPvEndPct({
			predictedNightConsumptionKwh: 5,
			usableCapacityKwh: 20,
		});
		// 5 * 1.2 = 6 kWh; 6/20*100 = 30 %.
		assert.equal(r.requiredReserveKwh, 6);
		assert.equal(r.requiredSocAtPvEndPct, 30);
		assert.match(r.reasonDe, /Reserve 6\.0 kWh \(30 %\)/);
	});

	it("respects a custom safety margin", () => {
		const r = resolveRequiredSocAtPvEndPct({
			predictedNightConsumptionKwh: 10,
			usableCapacityKwh: 20,
			safetyMarginFraction: 0.5,
		});
		// 10 * 1.5 = 15 kWh; 15/20*100 = 75 %.
		assert.equal(r.requiredReserveKwh, 15);
		assert.equal(r.requiredSocAtPvEndPct, 75);
	});

	it("clamps to 100 % when required reserve exceeds capacity", () => {
		const r = resolveRequiredSocAtPvEndPct({
			predictedNightConsumptionKwh: 50,
			usableCapacityKwh: 10,
		});
		assert.equal(r.requiredSocAtPvEndPct, 100);
		assert.equal(r.requiredReserveKwh, 10);
		assert.match(r.reasonDe, /Kapazität/);
	});

	it("returns null (no hidden fixed fallback) when night consumption is unknown", () => {
		const r = resolveRequiredSocAtPvEndPct({
			predictedNightConsumptionKwh: null,
			usableCapacityKwh: 20,
		});
		assert.equal(r.requiredSocAtPvEndPct, null);
		assert.equal(r.requiredReserveKwh, null);
		assert.match(r.reasonDe, /Nachtverbrauch/);
	});

	it("returns null when usable capacity is unknown", () => {
		const r = resolveRequiredSocAtPvEndPct({
			predictedNightConsumptionKwh: 5,
			usableCapacityKwh: null,
		});
		assert.equal(r.requiredSocAtPvEndPct, null);
		assert.match(r.reasonDe, /[Kk]apazität/);
	});

	it("returns null when usable capacity is zero/negative", () => {
		const r = resolveRequiredSocAtPvEndPct({
			predictedNightConsumptionKwh: 5,
			usableCapacityKwh: 0,
		});
		assert.equal(r.requiredSocAtPvEndPct, null);
	});

	it("treats zero predicted consumption as valid (no reserve needed), not as unknown", () => {
		const r = resolveRequiredSocAtPvEndPct({
			predictedNightConsumptionKwh: 0,
			usableCapacityKwh: 20,
		});
		assert.equal(r.requiredSocAtPvEndPct, 0);
		assert.equal(r.requiredReserveKwh, 0);
	});

	it("exports the default margin as a named, documented constant (not hidden)", () => {
		assert.equal(NIGHT_RESERVE_SAFETY_MARGIN_FRACTION, 0.2);
	});
});
