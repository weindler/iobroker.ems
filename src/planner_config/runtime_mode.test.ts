import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	parsePlannerRuntimeMode,
	plannerRuntimeModeFromConfig,
	PLANNER_RUNTIME_MODE_DEFAULT,
} from "./runtime_mode.js";

describe("planner_config runtime mode", () => {
	it("defaults to off", () => {
		assert.equal(PLANNER_RUNTIME_MODE_DEFAULT, "off");
		assert.equal(parsePlannerRuntimeMode(undefined).mode, "off");
		assert.equal(parsePlannerRuntimeMode(null).mode, "off");
		assert.equal(parsePlannerRuntimeMode("").mode, "off");
	});

	it("clamps invalid values to off", () => {
		const parsed = parsePlannerRuntimeMode("live");
		assert.equal(parsed.mode, "off");
		assert.equal(parsed.clamped, true);
	});

	it("accepts shadow_manual and shadow_auto", () => {
		assert.equal(parsePlannerRuntimeMode("shadow_manual").mode, "shadow_manual");
		assert.equal(parsePlannerRuntimeMode("shadow_auto").mode, "shadow_auto");
	});

	it("reads from config object", () => {
		assert.equal(plannerRuntimeModeFromConfig({ planner_runtime_mode: "shadow_auto" }).mode, "shadow_auto");
		assert.equal(plannerRuntimeModeFromConfig({}).mode, "off");
	});
});
