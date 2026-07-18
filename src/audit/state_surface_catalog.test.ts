import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { STATE_SURFACE_FAMILIES, summarizeStateSurfaceCatalog } from "./state_surface_catalog.js";

describe("state surface audit catalog", () => {
	it("covers required planner and addon families", () => {
		const ids = new Set(STATE_SURFACE_FAMILIES.map((f) => f.id));
		for (const required of [
			"global",
			"planner_core",
			"planner_coordinator",
			"planner_authority",
			"planner_takeover",
			"forecast_plan",
			"daily_plan",
			"allocations",
			"contributions",
			"learning",
			"wallbox",
			"vehicle_profiles",
			"battery",
			"immersion_heater",
			"air_conditioning",
		]) {
			assert.ok(ids.has(required), required);
		}
	});

	it("summarizes without mutating anything", () => {
		const before = STATE_SURFACE_FAMILIES.length;
		const summary = summarizeStateSurfaceCatalog();
		assert.equal(STATE_SURFACE_FAMILIES.length, before);
		assert.ok(summary.estimatedStaticTotal > 500);
		assert.ok(summary.byClass.A_core_user > 0);
		assert.ok(summary.byClass.C_temporary_diagnostics > 0);
		assert.ok(summary.byClass.D_internal_file_data > 0);
	});
});
