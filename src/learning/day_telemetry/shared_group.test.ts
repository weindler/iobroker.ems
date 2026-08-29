import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { advanceClimateSegment, closeClimateSegment } from "./climate_segments.js";
import { resolveActiveSharedPowerGroupId } from "./sources.js";
import type { ClimateRunSegment } from "./types.js";

describe("day_telemetry shared power group", () => {
	it("unbekannte Gruppe erzeugt kein lernfähiges default-Segment", () => {
		const active = [true, false, false, false, false];
		const r = resolveActiveSharedPowerGroupId(active, {}, null);
		assert.equal(r.groupId, null);
		assert.equal(r.rejectReason, "shared_power_group_unknown");

		let list: ClimateRunSegment[] = [];
		const step = advanceClimateSegment(
			null,
			1_000,
			{
				sharedPowerGroupId: r.groupId,
				mode: "cool",
				activeUnitCombination: "1",
				valid: false,
			},
			0.1,
			60,
			r.rejectReason,
			list,
		);
		list = closeClimateSegment(step.open, 2_000, step.list);
		assert.equal(list.length, 1);
		assert.equal(list[0].sharedPowerGroupId, null);
		assert.equal(list[0].valid, false);
		assert.equal(list[0].rejectReason, "shared_power_group_unknown");
		assert.equal(list.some((s) => s.sharedPowerGroupId === "default"), false);
	});

	it("bekannte outdoor_1-Gruppe wird korrekt persistiert", () => {
		const active = [true, true, false, false, false];
		const config = {
			ac_u1_shared_power_group_id: "outdoor_1",
			ac_u2_shared_power_group_id: "outdoor_1",
		};
		const r = resolveActiveSharedPowerGroupId(active, config, null);
		assert.equal(r.groupId, "outdoor_1");
		assert.equal(r.rejectReason, null);

		let list: ClimateRunSegment[] = [];
		const step = advanceClimateSegment(
			null,
			1_000,
			{
				sharedPowerGroupId: r.groupId,
				mode: "cool",
				activeUnitCombination: "1+2",
				valid: true,
			},
			0.2,
			120,
			null,
			list,
		);
		list = closeClimateSegment(step.open, 2_000, step.list);
		assert.equal(list[0].sharedPowerGroupId, "outdoor_1");
		assert.equal(list[0].valid, true);
	});

	it("Wechsel unknown → outdoor_1 schließt/öffnet Segmente sauber ohne Umetikettierung", () => {
		let list: ClimateRunSegment[] = [];
		const unknown = advanceClimateSegment(
			null,
			1_000,
			{
				sharedPowerGroupId: null,
				mode: "cool",
				activeUnitCombination: "1",
				valid: false,
			},
			0.05,
			30,
			"shared_power_group_unknown",
			list,
		);
		const next = advanceClimateSegment(
			unknown.open,
			2_000,
			{
				sharedPowerGroupId: "outdoor_1",
				mode: "cool",
				activeUnitCombination: "1",
				valid: true,
			},
			0.1,
			30,
			null,
			unknown.list,
		);
		list = closeClimateSegment(next.open, 3_000, next.list);
		assert.equal(list.length, 2);
		assert.equal(list[0].sharedPowerGroupId, null);
		assert.equal(list[0].rejectReason, "shared_power_group_unknown");
		assert.equal(list[0].valid, false);
		assert.equal(list[1].sharedPowerGroupId, "outdoor_1");
		assert.equal(list[1].valid, true);
		/* Erstes Segment bleibt unknown — keine rückwirkende Umbenennung */
		assert.notEqual(list[0].sharedPowerGroupId, "outdoor_1");
	});
});
