import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildControlThermalRequest, parseControlMode, validateForceTarget } from "./control.js";

describe("thermal control", () => {
	it("parses control modes", () => {
		assert.equal(parseControlMode("force"), "force");
		assert.equal(parseControlMode("OFF"), "off");
		assert.equal(parseControlMode("weird"), null);
	});

	it("force maps to force_on in request", () => {
		const req = buildControlThermalRequest({
			mode: "force",
			forceTargetTempC: 58,
			forceUntil: null,
			config: { ih_planning_max_temp_c: 60, ih_planning_min_temp_c: 48 },
			issuedAt: "2026-06-27T12:00:00Z",
		});
		const values = req.values as Record<string, unknown>;
		assert.equal(values.operating_request, "force_on");
		assert.equal(values.target_temperature_c, 58);
	});

	it("rejects force target above max", () => {
		const r = validateForceTarget(65, { ih_planning_max_temp_c: 60, ih_planning_min_temp_c: 48 });
		assert.equal(r.ok, false);
	});

	it("defaults force target to planning max", () => {
		const r = validateForceTarget("", { ih_planning_max_temp_c: 60, ih_planning_min_temp_c: 48 });
		assert.equal(r.ok, true);
		if (r.ok) assert.equal(r.value, 60);
	});
});
