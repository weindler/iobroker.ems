import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDaySlotLayout, slotIndexForMs } from "./slots.js";

describe("day_telemetry slots DST", () => {
	it("1) normaler Tag = 96 Slots (Europe/Berlin, kein DST-Wechsel)", () => {
		const layout = buildDaySlotLayout("2026-06-15", "Europe/Berlin");
		assert.equal(layout.slotCount, 96);
		assert.equal(layout.slots.length, 96);
		assert.equal(layout.endMs - layout.startMs, 96 * 15 * 60 * 1000);
	});

	it("2) DST Frühjahr = 92 Slots (2026-03-29 Europe/Berlin)", () => {
		const layout = buildDaySlotLayout("2026-03-29", "Europe/Berlin");
		assert.equal(layout.slotCount, 92);
		assert.equal(layout.slots.length, 92);
	});

	it("3) DST Herbst = 100 Slots (2026-10-25 Europe/Berlin)", () => {
		const layout = buildDaySlotLayout("2026-10-25", "Europe/Berlin");
		assert.equal(layout.slotCount, 100);
		assert.equal(layout.slots.length, 100);
		/* Doppelte lokale 02:xx — zwei verschiedene startMs */
		const starts = new Set(layout.slots.map((s) => s.startMs));
		assert.equal(starts.size, 100);
	});

	it("Slot-Index über absolute ms eindeutig", () => {
		const layout = buildDaySlotLayout("2026-10-25", "Europe/Berlin");
		const mid = layout.slots[50];
		assert.equal(slotIndexForMs(layout, mid.startMs), 50);
		assert.equal(slotIndexForMs(layout, mid.endMs - 1), 50);
		assert.equal(slotIndexForMs(layout, layout.startMs - 1), null);
	});
});
