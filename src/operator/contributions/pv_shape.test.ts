import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPvShapeForDay, clearSkyWeight, solarElevationDeg } from "./pv_shape";

// München-ähnliche Koordinaten, Sommer.
const LAT = 48.14;
const LON = 11.58;
const SUMMER_NOON_UTC = new Date("2026-07-11T10:00:00.000Z"); // ~12:00 lokale Solarzeit
const SUMMER_MIDNIGHT_UTC = new Date("2026-07-11T22:00:00.000Z");

function quarterSlotsForDay(dateKey: string): Array<{ startIso: string; endIso: string }> {
	const slots: Array<{ startIso: string; endIso: string }> = [];
	const dayStart = Date.parse(`${dateKey}T00:00:00.000Z`);
	for (let i = 0; i < 96; i++) {
		const startMs = dayStart + i * 15 * 60_000;
		const endMs = startMs + 15 * 60_000;
		slots.push({ startIso: new Date(startMs).toISOString(), endIso: new Date(endMs).toISOString() });
	}
	return slots;
}

describe("solarElevationDeg", () => {
	it("is high around local solar noon in summer", () => {
		const elevation = solarElevationDeg(SUMMER_NOON_UTC, LAT, LON);
		assert.ok(elevation > 50, `expected high elevation at noon, got ${elevation}`);
	});

	it("is negative at night", () => {
		const elevation = solarElevationDeg(SUMMER_MIDNIGHT_UTC, LAT, LON);
		assert.ok(elevation < 0, `expected negative elevation at night, got ${elevation}`);
	});
});

describe("clearSkyWeight", () => {
	it("is zero below the horizon", () => {
		assert.equal(clearSkyWeight(-5), 0);
		assert.equal(clearSkyWeight(0), 0);
	});

	it("increases with elevation", () => {
		assert.ok(clearSkyWeight(10) < clearSkyWeight(60));
	});
});

describe("buildPvShapeForDay", () => {
	const slots = quarterSlotsForDay("2026-07-11");

	it("returns empty without valid daily kWh", () => {
		assert.deepEqual(buildPvShapeForDay(slots, null, LAT, LON, [], null), []);
		assert.deepEqual(buildPvShapeForDay(slots, 0, LAT, LON, [], null), []);
		assert.deepEqual(buildPvShapeForDay(slots, -5, LAT, LON, [], null), []);
	});

	it("returns empty without lat/lon", () => {
		assert.deepEqual(buildPvShapeForDay(slots, 30, null, LON, [], null), []);
		assert.deepEqual(buildPvShapeForDay(slots, 30, LAT, null, [], null), []);
	});

	it("distributes the daily kWh so the sum matches (clear-sky only)", () => {
		const result = buildPvShapeForDay(slots, 30, LAT, LON, [], null);
		assert.equal(result.length, 96);
		const energyKwh = result.reduce((sum, r) => sum + (r.pvPowerW * 0.25) / 1000, 0);
		assert.ok(Math.abs(energyKwh - 30) < 0.5, `expected ~30 kWh, got ${energyKwh}`);
	});

	it("is zero at night and peaks around midday", () => {
		const result = buildPvShapeForDay(slots, 30, LAT, LON, [], null);
		const nightSlot = result.find((r) => r.slot.startIso === "2026-07-11T00:00:00.000Z");
		const noonSlot = result.find((r) => r.slot.startIso === "2026-07-11T10:00:00.000Z");
		assert.equal(nightSlot?.pvPowerW, 0);
		assert.ok((noonSlot?.pvPowerW ?? 0) > 0);
		const maxPower = Math.max(...result.map((r) => r.pvPowerW));
		const peakSlot = result.find((r) => r.pvPowerW === maxPower);
		// Sonnenhöchststand bei lon≈11.6° liegt nahe 11:13 UTC — Peak muss im Vormittagsfenster liegen.
		assert.ok(
			peakSlot && peakSlot.slot.startIso >= "2026-07-11T09:00:00.000Z" && peakSlot.slot.startIso <= "2026-07-11T13:00:00.000Z",
			`expected peak near midday, got ${peakSlot?.slot.startIso}`,
		);
	});

	it("dampens a cloudy hour relative to a clear hour on the same day", () => {
		const clear = buildPvShapeForDay(slots, 30, LAT, LON, [], null);
		const cloudy = buildPvShapeForDay(
			slots,
			30,
			LAT,
			LON,
			[{ hourStartIso: "2026-07-11T10:00:00.000Z", cloudPct: 90, solarEstimateKwh: null }],
			null,
		);
		const clearNoon = clear.find((r) => r.slot.startIso === "2026-07-11T10:00:00.000Z")?.pvPowerW ?? 0;
		const cloudyNoon = cloudy.find((r) => r.slot.startIso === "2026-07-11T10:00:00.000Z")?.pvPowerW ?? 0;
		assert.ok(cloudyNoon < clearNoon, `expected cloudy (${cloudyNoon}) < clear (${clearNoon})`);
		// total day energy stays normalized to dailyKwh even though one hour is redistributed
		const cloudyEnergyKwh = cloudy.reduce((sum, r) => sum + (r.pvPowerW * 0.25) / 1000, 0);
		assert.ok(Math.abs(cloudyEnergyKwh - 30) < 0.5);
	});

	it("prefers solar_estimate over cloud_cover for the same hour when both given", () => {
		const withEstimate = buildPvShapeForDay(
			slots,
			30,
			LAT,
			LON,
			[{ hourStartIso: "2026-07-11T10:00:00.000Z", cloudPct: 90, solarEstimateKwh: 5 }],
			null,
		);
		const withCloudOnly = buildPvShapeForDay(
			slots,
			30,
			LAT,
			LON,
			[{ hourStartIso: "2026-07-11T10:00:00.000Z", cloudPct: 90, solarEstimateKwh: null }],
			null,
		);
		const estimateNoon = withEstimate.find((r) => r.slot.startIso === "2026-07-11T10:00:00.000Z")?.pvPowerW ?? 0;
		const cloudOnlyNoon = withCloudOnly.find((r) => r.slot.startIso === "2026-07-11T10:00:00.000Z")?.pvPowerW ?? 0;
		assert.notEqual(estimateNoon, cloudOnlyNoon);
	});

	it("caps power at the configured kWp ceiling", () => {
		const uncapped = buildPvShapeForDay(slots, 30, LAT, LON, [], null);
		const maxUncapped = Math.max(...uncapped.map((r) => r.pvPowerW));
		const capW = Math.round(maxUncapped * 0.5);
		const capped = buildPvShapeForDay(slots, 30, LAT, LON, [], capW);
		assert.ok(Math.max(...capped.map((r) => r.pvPowerW)) <= capW);
		const energyKwh = capped.reduce((sum, r) => sum + (r.pvPowerW * 0.25) / 1000, 0);
		assert.ok(energyKwh < 30, "capping should reduce total energy below the daily target");
	});

	it("returns empty for an empty slot list", () => {
		assert.deepEqual(buildPvShapeForDay([], 30, LAT, LON, [], null), []);
	});
});
