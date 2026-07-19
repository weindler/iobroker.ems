import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	acMappingCommandsForConfiguredUnits,
	configuredAcUnitIndexes,
	isAcUnitConfigured,
} from "./configured.js";

describe("ac unit configured detection", () => {
	it("treats empty default slots as not configured", () => {
		assert.equal(isAcUnitConfigured({}, 1), false);
		assert.deepEqual(configuredAcUnitIndexes({}), []);
		assert.deepEqual(acMappingCommandsForConfiguredUnits({}), []);
	});

	it("treats enabled unit as configured even without mappings", () => {
		assert.equal(isAcUnitConfigured({ ac_u2_enabled: true }, 2), true);
		assert.deepEqual(configuredAcUnitIndexes({ ac_u2_enabled: true }), [2]);
	});

	it("treats disabled unit with mapping target as configured", () => {
		const cfg = {
			ac_u1_enabled: false,
			ac_u1_feedback_switch_target: "smartthings.0.devices.x.switch",
		};
		assert.equal(isAcUnitConfigured(cfg, 1), true);
		assert.equal(isAcUnitConfigured(cfg, 3), false);
	});

	it("limits mapping commands to configured units only", () => {
		const cmds = acMappingCommandsForConfiguredUnits({ ac_u1_enabled: true });
		assert.ok(cmds.every((c) => c.startsWith("unit_1_")));
		assert.ok(cmds.includes("unit_1_cmd_switch_off"));
		assert.ok(!cmds.some((c) => c.startsWith("unit_2_")));
	});
});
