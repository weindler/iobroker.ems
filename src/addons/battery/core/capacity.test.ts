import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveEnergy, isValidCapacityKwh, resolveCapacity } from "./capacity.js";

describe("battery capacity", () => {
	it("manual value used when source manual", () => {
		const r = resolveCapacity({ source: "manual", manualKwh: 10, mappedKwh: 7 });
		assert.equal(r.effectiveKwh, 10);
		assert.equal(r.source, "manual");
		assert.equal(r.valid, true);
	});

	it("mapped value preferred when source mapped and valid", () => {
		const r = resolveCapacity({ source: "mapped", manualKwh: 10, mappedKwh: 7 });
		assert.equal(r.effectiveKwh, 7);
		assert.equal(r.source, "mapped");
	});

	it("falls back to manual when mapped invalid", () => {
		const r = resolveCapacity({ source: "mapped", manualKwh: 10, mappedKwh: 0 });
		assert.equal(r.effectiveKwh, 10);
		assert.equal(r.source, "manual");
	});

	it("invalid values rejected (null/NaN/Infinity/<=0)", () => {
		for (const bad of [null, NaN, Infinity, 0, -5]) {
			assert.equal(isValidCapacityKwh(bad as number), false);
		}
		const r = resolveCapacity({ source: "manual", manualKwh: -1, mappedKwh: null });
		assert.equal(r.valid, false);
		assert.equal(r.effectiveKwh, null);
		assert.equal(r.source, "unknown");
	});

	it("missing capacity never treated as 0", () => {
		const e = deriveEnergy(50, null, 5);
		assert.equal(e.energyStoredKwh, null);
		assert.equal(e.energyFreeToFullKwh, null);
	});

	it("derives energy only when soc and capacity valid", () => {
		const e = deriveEnergy(50, 10, 5);
		assert.equal(e.energyStoredKwh, 5);
		assert.equal(e.energyFreeToFullKwh, 5);
		assert.equal(e.energyAboveTechnicalMinKwh, 4.5);
	});
});
