import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	groupContiguousSlotWindows,
	isNowInWinterChargeWindow,
	planBatteryWinterPriceWindows,
} from "./battery_winter_windows.js";
import type { Price15MinSlot } from "../../learning/price_forecast/tibber_parse.js";
import { MS_PER_15MIN } from "../../learning/price_forecast/tibber_parse.js";

const BASE = Date.parse("2026-01-15T18:00:00.000Z");

function slot(offset15m: number, ct: number): Price15MinSlot {
	return { slotStartMs: BASE + offset15m * MS_PER_15MIN, priceCtPerKwh: ct };
}

describe("battery winter price windows", () => {
	it("picks cheapest contiguous block for balanced mode", () => {
		const slots = [slot(0, 30), slot(1, 20), slot(2, 19), slot(3, 21), slot(4, 35)];
		const windows = planBatteryWinterPriceWindows({
			nowMs: BASE,
			slots,
			slotsNeeded: 2,
			deadlineMs: BASE + 5 * MS_PER_15MIN,
			globalMode: "balanced",
		});
		assert.equal(windows.length, 1);
		assert.equal(windows[0].strategy, "contiguous");
		assert.equal(windows[0].slots_15m, 2);
		assert.equal(Date.parse(windows[0].start_iso), slot(1, 0).slotStartMs);
	});

	it("allows split windows in eco mode", () => {
		const slots = [slot(0, 40), slot(1, 15), slot(2, 50), slot(3, 14)];
		const windows = planBatteryWinterPriceWindows({
			nowMs: BASE,
			slots,
			slotsNeeded: 2,
			deadlineMs: BASE + 4 * MS_PER_15MIN,
			globalMode: "eco",
		});
		assert.ok(windows.length >= 1);
		assert.equal(windows[0].strategy, "split");
		assert.equal(
			windows.reduce((n, w) => n + w.slots_15m, 0),
			2,
		);
	});

	it("detects active window for current time", () => {
		const windows = groupContiguousSlotWindows([slot(0, 10), slot(1, 11)], "contiguous");
		const active = isNowInWinterChargeWindow(BASE + MS_PER_15MIN / 2, windows);
		assert.ok(active);
		assert.equal(isNowInWinterChargeWindow(BASE + 3 * MS_PER_15MIN, windows), null);
	});
});
