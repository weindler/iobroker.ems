import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	parsePlannerTakeoverAuthorizationMode,
	plannerTakeoverAuthorizationModeFromConfig,
	PLANNER_TAKEOVER_AUTHORIZATION_MODE_DEFAULT,
} from "./authorization_mode.js";

describe("planner_config authorization mode", () => {
	it("default is disabled", () => {
		assert.equal(PLANNER_TAKEOVER_AUTHORIZATION_MODE_DEFAULT, "disabled");
	});
	it("missing migrates to disabled", () => {
		assert.equal(plannerTakeoverAuthorizationModeFromConfig({}).mode, "disabled");
	});
	it("invalid clamps", () => {
		assert.equal(parsePlannerTakeoverAuthorizationMode("yes").clamped, true);
	});
	it("manual_prepare accepted", () => {
		assert.equal(
			plannerTakeoverAuthorizationModeFromConfig({
				planner_takeover_authorization_mode: "manual_prepare",
			}).mode,
			"manual_prepare",
		);
	});
});
