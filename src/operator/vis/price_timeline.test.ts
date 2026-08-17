import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CONTRIBUTION_IDS } from "../contribution_ids";
import {
	buildVisPriceTimeline,
	VIS_PRICE_LOOKBACK_HOURS,
	VIS_PRICE_MIN_AHEAD_HOURS,
	type VisPriceAllocEntry,
	type VisPriceGridSlot,
} from "./price_timeline";

const NOW = new Date("2026-08-17T12:07:00.000Z");

function slot(startIso: string, priceCt: number | null): VisPriceGridSlot {
	const start = Date.parse(startIso);
	return {
		startIso,
		endIso: new Date(start + 15 * 60_000).toISOString(),
		priceCtPerKwh: priceCt,
	};
}

function hoursAround(now: Date, backH: number, aheadH: number, priceAt: (ms: number) => number | null): VisPriceGridSlot[] {
	const out: VisPriceGridSlot[] = [];
	const start = now.getTime() - backH * 3600_000;
	const end = now.getTime() + aheadH * 3600_000;
	for (let ms = start; ms < end; ms += 15 * 60_000) {
		out.push(slot(new Date(ms).toISOString(), priceAt(ms)));
	}
	return out;
}

function alloc(
	contributionId: string,
	startIso: string,
	allocatedPowerW: number,
	extra: Partial<VisPriceAllocEntry> = {},
): VisPriceAllocEntry {
	return {
		contributionId,
		allocatedPowerW,
		slot: { startIso, endIso: new Date(Date.parse(startIso) + 15 * 60_000).toISOString() },
		...extra,
	};
}

describe("buildVisPriceTimeline (read-only reshape)", () => {
	it("keeps last 4h and at least next 12h from existing grid slots", () => {
		const grid = hoursAround(NOW, 8, 20, () => 24.3);
		const board = buildVisPriceTimeline({
			now: NOW,
			currentPriceCt: 24.3,
			gbMinPriceCt: 30,
			gbPriceAllowed: false,
			gridSlots: grid,
			batteryAlloc: [],
			wallboxAlloc: [],
			immersionAlloc: [],
			climateAlloc: [],
		});
		const first = Date.parse(board.slots[0].startIso);
		const last = Date.parse(board.slots[board.slots.length - 1].endIso);
		assert.ok(NOW.getTime() - first >= (VIS_PRICE_LOOKBACK_HOURS - 0.3) * 3600_000);
		assert.ok(last - NOW.getTime() >= VIS_PRICE_MIN_AHEAD_HOURS * 3600_000 - 15 * 60_000);
		assert.equal(board.slots.every((s) => s.priceCt === 24.3), true);
	});

	it("does not invent prices for missing grid slots", () => {
		const board = buildVisPriceTimeline({
			now: NOW,
			currentPriceCt: null,
			gbMinPriceCt: 30,
			gbPriceAllowed: null,
			gridSlots: [slot("2026-08-17T12:00:00.000Z", 36.7)],
			batteryAlloc: [],
			wallboxAlloc: [],
			immersionAlloc: [],
			climateAlloc: [],
		});
		assert.equal(board.slots.length, 1);
		assert.equal(board.slots[0].priceCt, 36.7);
		assert.equal(board.slots[0].current, true);
	});

	it("marks current 15-min and current local hour", () => {
		const grid = hoursAround(NOW, 2, 2, () => 20);
		const board = buildVisPriceTimeline({
			now: NOW,
			currentPriceCt: 20,
			gbMinPriceCt: 30,
			gbPriceAllowed: false,
			gridSlots: grid,
			batteryAlloc: [],
			wallboxAlloc: [],
			immersionAlloc: [],
			climateAlloc: [],
		});
		const current = board.slots.filter((s) => s.current);
		assert.equal(current.length, 1);
		assert.equal(current[0].currentHour, true);
		assert.ok(board.slots.filter((s) => s.currentHour).length >= 1);
	});

	it("reports calendar-day min/max with timestamps from real prices", () => {
		const grid: VisPriceGridSlot[] = [
			slot("2026-08-17T06:00:00.000Z", 18.1),
			slot("2026-08-17T12:00:00.000Z", 24.3),
			slot("2026-08-17T17:00:00.000Z", 41.9),
			slot("2026-08-16T12:00:00.000Z", 9.9),
		];
		const board = buildVisPriceTimeline({
			now: NOW,
			currentPriceCt: 24.3,
			gbMinPriceCt: 30,
			gbPriceAllowed: false,
			gridSlots: grid,
			batteryAlloc: [],
			wallboxAlloc: [],
			immersionAlloc: [],
			climateAlloc: [],
		});
		assert.equal(board.dayMin?.priceCt, 18.1);
		assert.equal(board.dayMin?.startIso, "2026-08-17T06:00:00.000Z");
		assert.equal(board.dayMax?.priceCt, 41.9);
		assert.equal(board.dayMax?.startIso, "2026-08-17T17:00:00.000Z");
	});

	it("GB price-ok is allowance, not an action; 24.3 blocked, 36.7 allowed", () => {
		const low = buildVisPriceTimeline({
			now: NOW,
			currentPriceCt: 24.3,
			gbMinPriceCt: 30,
			gbPriceAllowed: false,
			gridSlots: [slot("2026-08-17T12:00:00.000Z", 24.3)],
			batteryAlloc: [],
			wallboxAlloc: [],
			immersionAlloc: [],
			climateAlloc: [],
		});
		assert.equal(low.gbPriceAllowed, false);
		assert.equal(low.slots[0].gbPriceOk, false);
		assert.deepEqual(low.slots[0].actions, []);

		const high = buildVisPriceTimeline({
			now: NOW,
			currentPriceCt: 36.7,
			gbMinPriceCt: 30,
			gbPriceAllowed: true,
			gridSlots: [slot("2026-08-17T12:00:00.000Z", 36.7)],
			batteryAlloc: [],
			wallboxAlloc: [],
			immersionAlloc: [],
			climateAlloc: [],
		});
		assert.equal(high.slots[0].gbPriceOk, true);
		assert.deepEqual(high.slots[0].actions, []);
	});

	it("marks battery net-charge, EV, immersion, climate from Daily Plan allocations", () => {
		const start = "2026-08-17T12:00:00.000Z";
		const board = buildVisPriceTimeline({
			now: NOW,
			currentPriceCt: 36.7,
			gbMinPriceCt: 30,
			gbPriceAllowed: true,
			gridSlots: [slot(start, 36.7)],
			batteryAlloc: [
				alloc(CONTRIBUTION_IDS.BATTERY_CHARGE, start, 2500, { energySource: "grid", gridPowerW: 2500 }),
			],
			wallboxAlloc: [alloc(CONTRIBUTION_IDS.WALLBOX_EV_SESSION, start, 7000)],
			immersionAlloc: [alloc(CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, start, 1700)],
			climateAlloc: [alloc("air_conditioning.unit_1", start, 800)],
		});
		assert.deepEqual(board.slots[0].actions, ["battery_grid", "ev", "immersion", "climate"]);
	});

	it("does not treat PV-surplus battery charge as Netzladen", () => {
		const start = "2026-08-17T12:00:00.000Z";
		const board = buildVisPriceTimeline({
			now: NOW,
			currentPriceCt: 10,
			gbMinPriceCt: 30,
			gbPriceAllowed: false,
			gridSlots: [slot(start, 10)],
			batteryAlloc: [
				alloc(CONTRIBUTION_IDS.BATTERY_CHARGE, start, 2000, { energySource: "pv_surplus", gridPowerW: 0 }),
			],
			wallboxAlloc: [],
			immersionAlloc: [],
			climateAlloc: [],
		});
		assert.deepEqual(board.slots[0].actions, []);
	});

	it("ignores sub-floor allocations (no second optimiser)", () => {
		const start = "2026-08-17T12:00:00.000Z";
		const board = buildVisPriceTimeline({
			now: NOW,
			currentPriceCt: 20,
			gbMinPriceCt: 30,
			gbPriceAllowed: false,
			gridSlots: [slot(start, 20)],
			batteryAlloc: [],
			wallboxAlloc: [alloc(CONTRIBUTION_IDS.WALLBOX_EV_SESSION, start, 20)],
			immersionAlloc: [],
			climateAlloc: [],
		});
		assert.deepEqual(board.slots[0].actions, []);
	});
});
