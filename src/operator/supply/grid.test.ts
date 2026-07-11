import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	buildGridSupplyForecast,
	computeEffectiveMaxGridImportW,
	gridSlotsToPrice15Min,
	gridSupplyRevisionPayload,
	resolveFlexibleGridImportAllowed,
	type GridSupplyBuildInput,
} from "./grid";
import { MS_PER_15MIN } from "../../learning/price_forecast/tibber_parse";

function baseInput(overrides: Partial<GridSupplyBuildInput> = {}): GridSupplyBuildInput {
	const now = new Date("2026-07-11T10:00:00.000Z");
	return {
		now,
		globalMode: "balanced",
		policyGridImportAllowed: true,
		configuredMaxGridImportW: 11000,
		configuredHouseFuseLimitW: 13800,
		currentPriceCtPerKwh: 24.5,
		fixedPriceCtPerKwh: null,
		dynamicSlots: [],
		...overrides,
	};
}

describe("grid supply", () => {
	it("normalizes and sorts dynamic slots", () => {
		const t0 = Date.parse("2026-07-11T10:00:00.000Z");
		const t1 = t0 + MS_PER_15MIN;
		const forecast = buildGridSupplyForecast(
			baseInput({
				dynamicSlots: [
					{ slotStartMs: t1, priceCtPerKwh: 30 },
					{ slotStartMs: t0, priceCtPerKwh: 20 },
				],
			}),
		);
		assert.equal(forecast.source, "dynamic_tariff");
		assert.equal(forecast.slots.length, 2);
		assert.ok(forecast.slots[0].startIso < forecast.slots[1].startIso);
		assert.equal(forecast.slots[0].priceCtPerKwh, 20);
		assert.equal(forecast.slots[0].importAllowed, true);
	});

	it("discards invalid slot timestamps", () => {
		const forecast = buildGridSupplyForecast(
			baseInput({
				dynamicSlots: [{ slotStartMs: Number.NaN, priceCtPerKwh: 10 }],
			}),
		);
		assert.equal(forecast.slots.length, 0);
	});

	it("keeps missing prices as null", () => {
		const t0 = Date.parse("2026-07-11T10:00:00.000Z");
		const forecast = buildGridSupplyForecast(
			baseInput({
				dynamicSlots: [{ slotStartMs: t0, priceCtPerKwh: Number.NaN }],
			}),
		);
		assert.equal(forecast.slots.length, 1);
		assert.equal(forecast.slots[0].priceCtPerKwh, null);
	});

	it("policy blocks flexible grid import", () => {
		const forecast = buildGridSupplyForecast(
			baseInput({ policyGridImportAllowed: false }),
		);
		assert.equal(forecast.gridImportAllowed, false);
		assert.equal(forecast.quality.status, "disabled");
		assert.match(forecast.reasonDe, /Policy/);
	});

	it("off mode blocks flexible grid import", () => {
		assert.equal(resolveFlexibleGridImportAllowed("off", true), false);
		const forecast = buildGridSupplyForecast(baseInput({ globalMode: "off" }));
		assert.equal(forecast.gridImportAllowed, false);
		assert.match(forecast.reasonDe, /off/i);
	});

	it("uses minimum valid import limit", () => {
		assert.equal(computeEffectiveMaxGridImportW(11000, 13800), 11000);
		assert.equal(computeEffectiveMaxGridImportW(null, 13800), 13800);
		assert.equal(computeEffectiveMaxGridImportW(11000, null), 11000);
		assert.equal(computeEffectiveMaxGridImportW(null, null), null);
	});

	it("fixed tariff fallback when configured", () => {
		const forecast = buildGridSupplyForecast(
			baseInput({ fixedPriceCtPerKwh: 32.1, currentPriceCtPerKwh: null }),
		);
		assert.equal(forecast.source, "fixed_tariff");
		assert.equal(forecast.currentPriceCtPerKwh, 32.1);
		assert.equal(forecast.slots.length, 0);
	});

	it("missing price source yields source none", () => {
		const forecast = buildGridSupplyForecast(
			baseInput({ currentPriceCtPerKwh: null, fixedPriceCtPerKwh: null }),
		);
		assert.equal(forecast.source, "none");
		assert.equal(forecast.quality.status, "missing");
	});

	it("converts grid slots to Price15Min for battery compatibility", () => {
		const t0 = Date.parse("2026-07-11T10:00:00.000Z");
		const forecast = buildGridSupplyForecast(
			baseInput({
				dynamicSlots: [{ slotStartMs: t0, priceCtPerKwh: 18.2 }],
			}),
		);
		const legacy = gridSlotsToPrice15Min(forecast.slots);
		assert.equal(legacy.length, 1);
		assert.equal(legacy[0].slotStartMs, t0);
		assert.equal(legacy[0].priceCtPerKwh, 18.2);
	});

	it("revision payload changes on slot updates", () => {
		const t0 = Date.parse("2026-07-11T10:00:00.000Z");
		const a = buildGridSupplyForecast(
			baseInput({ dynamicSlots: [{ slotStartMs: t0, priceCtPerKwh: 10 }] }),
		);
		const b = buildGridSupplyForecast(
			baseInput({ dynamicSlots: [{ slotStartMs: t0, priceCtPerKwh: 11 }] }),
		);
		assert.notEqual(gridSupplyRevisionPayload(a), gridSupplyRevisionPayload(b));
	});
});
