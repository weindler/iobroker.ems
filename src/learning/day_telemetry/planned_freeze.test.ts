import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { UnifiedAllocationCell } from "../../operator/daily_plan/unified/types.js";
import {
	dedupePlannedConsumers,
	freezePlannedConsumersForSlot,
	sharedGroupMapFromClimateUnits,
} from "./planned_freeze.js";

function cell(
	startIso: string,
	consumerId: string,
	kind: UnifiedAllocationCell["kind"],
	energyKwh: number,
): UnifiedAllocationCell {
	return {
		slot: { startIso, endIso: "x" },
		consumerId,
		kind,
		allocatedPowerW: energyKwh * 4000,
		allocatedEnergyKwh: energyKwh,
		energySource: "pv_surplus",
		constraintIds: [],
		reasonCodes: [],
	};
}

describe("day_telemetry planned freeze", () => {
	const start = "2026-06-15T12:00:00.000Z";

	it("10) mehrere gleichzeitig geplante Verbraucher", () => {
		const allocs = [
			cell(start, "battery", "battery_charge", 0.5),
			cell(start, "wallbox", "wallbox", 1.2),
			cell(start, "immersion", "immersion_heater", 0.4),
			cell(start, "u1", "climate", 0.3),
			cell(start, "u2", "climate", 0.5),
		];
		const map = sharedGroupMapFromClimateUnits([
			{ unitId: "u1", sharedPowerGroupId: "outdoor_1" },
			{ unitId: "u2", sharedPowerGroupId: "outdoor_1" },
		]);
		const frozen = freezePlannedConsumersForSlot(allocs, start, map);
		assert.ok(frozen.some((f) => f.consumerId === "battery"));
		assert.ok(frozen.some((f) => f.consumerId === "wallbox"));
		assert.ok(frozen.some((f) => f.consumerId === "immersion"));
		assert.ok(frozen.some((f) => f.kind === "climate" && f.consumerId === "u1"));
		assert.ok(frozen.some((f) => f.kind === "climate" && f.consumerId === "u2"));
	});

	it("11) Shared AC elektrisch nur einmal (max)", () => {
		const allocs = [
			cell(start, "u1", "climate", 0.3),
			cell(start, "u2", "climate", 0.5),
		];
		const map = sharedGroupMapFromClimateUnits([
			{ unitId: "u1", sharedPowerGroupId: "outdoor_1" },
			{ unitId: "u2", sharedPowerGroupId: "outdoor_1" },
		]);
		const frozen = freezePlannedConsumersForSlot(allocs, start, map);
		const elec = frozen.filter((f) => f.kind === "climate_shared_electric");
		assert.equal(elec.length, 1);
		assert.equal(elec[0].consumerId, "outdoor_1");
		assert.equal(elec[0].energyKwh, 0.5);
	});

	it("Dedup plannedConsumers table", () => {
		let table: ReturnType<typeof freezePlannedConsumersForSlot>[] = [];
		const a = freezePlannedConsumersForSlot(
			[cell(start, "battery", "battery_charge", 0.1)],
			start,
			null,
		);
		const d1 = dedupePlannedConsumers(table, a);
		table = d1.table;
		const d2 = dedupePlannedConsumers(table, a);
		assert.equal(d1.index, d2.index);
		assert.equal(d2.table.length, 1);
	});
});
