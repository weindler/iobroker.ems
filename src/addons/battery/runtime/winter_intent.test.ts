import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deviceIntentFromWinterPlanner, parseWinterWindowsJson } from "./winter_intent.js";

describe("winter battery intent", () => {
	it("builds grid_charge intent inside active window", () => {
		const start = "2026-01-15T20:00:00.000Z";
		const end = "2026-01-15T21:00:00.000Z";
		const intent = deviceIntentFromWinterPlanner(
			{
				active: true,
				socTargetPct: 85,
				maxChargeW: 4200,
				windows: [{ start_iso: start, end_iso: end, slots_15m: 4, strategy: "contiguous" }],
				reasonDe: "Test",
				revision: 3,
			},
			Date.parse("2026-01-15T20:15:00.000Z"),
		);
		assert.ok(intent);
		assert.equal(intent?.action, "grid_charge");
		assert.equal(intent?.energySource, "grid");
		assert.equal(intent?.maxChargeW, 4200);
		assert.equal(intent?.requestId, "winter-planner-3");
	});

	it("returns null outside window", () => {
		const intent = deviceIntentFromWinterPlanner(
			{
				active: true,
				socTargetPct: 85,
				maxChargeW: 4200,
				windows: [
					{
						start_iso: "2026-01-15T20:00:00.000Z",
						end_iso: "2026-01-15T21:00:00.000Z",
						slots_15m: 4,
						strategy: "contiguous",
					},
				],
				reasonDe: "Test",
				revision: 1,
			},
			Date.parse("2026-01-15T22:00:00.000Z"),
		);
		assert.equal(intent, null);
	});

	it("parses windows json", () => {
		const rows = parseWinterWindowsJson(
			JSON.stringify([
				{ start_iso: "a", end_iso: "b", slots_15m: 2, strategy: "split" },
			]),
		);
		assert.equal(rows.length, 1);
		assert.equal(rows[0].strategy, "split");
	});
});
