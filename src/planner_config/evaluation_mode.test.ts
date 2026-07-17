import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	parsePlannerTakeoverEvaluationMode,
	plannerTakeoverEvaluationModeFromConfig,
	PLANNER_TAKEOVER_EVALUATION_MODE_DEFAULT,
} from "./evaluation_mode.js";

describe("planner_config evaluation mode", () => {
	it("default is disabled", () => {
		assert.equal(PLANNER_TAKEOVER_EVALUATION_MODE_DEFAULT, "disabled");
	});

	it("missing migrates to disabled", () => {
		assert.equal(plannerTakeoverEvaluationModeFromConfig({}).mode, "disabled");
		assert.equal(parsePlannerTakeoverEvaluationMode(null).mode, "disabled");
	});

	it("invalid clamps to disabled", () => {
		const p = parsePlannerTakeoverEvaluationMode("on");
		assert.equal(p.mode, "disabled");
		assert.equal(p.clamped, true);
	});

	it("observe is accepted", () => {
		const p = plannerTakeoverEvaluationModeFromConfig({
			planner_takeover_evaluation_mode: "observe",
		});
		assert.equal(p.mode, "observe");
		assert.equal(p.clamped, false);
	});
});
