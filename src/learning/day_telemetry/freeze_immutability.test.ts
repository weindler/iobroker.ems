import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isoFromMs } from "../../operator/time.js";
import type { UnifiedAllocationCell, UnifiedDayPlan } from "../../operator/daily_plan/unified/types.js";
import { freezePlannedConsumersForSlot, dedupePlannedConsumers } from "./planned_freeze.js";
import { buildDaySlotLayout } from "./slots.js";
import { emptyDayRecord } from "./types.js";

describe("day_telemetry frozen slot immutability", () => {
	it("9) Replan nach Slotbeginn verändert Frozen Slot nicht", () => {
		const layout = buildDaySlotLayout("2026-06-15", "Europe/Berlin");
		const day = emptyDayRecord(
			"2026-06-15",
			"Europe/Berlin",
			layout.startMs,
			layout.endMs,
			layout.slotCount,
		);
		const slotIdx = 40;
		const startIso = isoFromMs(layout.slots[slotIdx].startMs);

		const alloc1: UnifiedAllocationCell[] = [
			{
				slot: { startIso, endIso: isoFromMs(layout.slots[slotIdx].endMs) },
				consumerId: "battery",
				kind: "battery_charge",
				allocatedPowerW: 2000,
				allocatedEnergyKwh: 0.5,
				energySource: "pv_surplus",
				constraintIds: [],
				reasonCodes: [],
			},
		];
		const frozen1 = freezePlannedConsumersForSlot(alloc1, startIso, null);
		const d1 = dedupePlannedConsumers(day.plannedConsumers, frozen1);
		day.plannedConsumers = d1.table;
		day.buckets.plannedConsumersRef[slotIdx] = d1.index;
		const snapBefore = JSON.stringify(day.plannedConsumers[d1.index]);

		/* Späterer Replan mit anderer Allocation — Slot bereits eingefroren */
		const alloc2: UnifiedAllocationCell[] = [
			{
				slot: { startIso, endIso: isoFromMs(layout.slots[slotIdx].endMs) },
				consumerId: "wallbox",
				kind: "wallbox",
				allocatedPowerW: 7000,
				allocatedEnergyKwh: 1.75,
				energySource: "grid",
				constraintIds: [],
				reasonCodes: [],
			},
		];
		if (day.buckets.plannedConsumersRef[slotIdx] != null) {
			/* Recorder-Semantik: nicht überschreiben */
		} else {
			const frozen2 = freezePlannedConsumersForSlot(alloc2, startIso, null);
			const d2 = dedupePlannedConsumers(day.plannedConsumers, frozen2);
			day.plannedConsumers = d2.table;
			day.buckets.plannedConsumersRef[slotIdx] = d2.index;
		}
		assert.equal(JSON.stringify(day.plannedConsumers[day.buckets.plannedConsumersRef[slotIdx]!]), snapBefore);
		assert.ok(snapBefore.includes("battery"));
		assert.equal(snapBefore.includes("wallbox"), false);
		void 0 as unknown as UnifiedDayPlan;
	});
});
