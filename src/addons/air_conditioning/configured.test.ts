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

	it("ignores disabled unit even with mapping targets (ensure only enabled)", () => {
		const cfg = {
			ac_u1_enabled: false,
			ac_u1_feedback_switch_target: "smartthings.0.devices.x.switch",
			ac_u2_enabled: true,
		};
		assert.equal(isAcUnitConfigured(cfg, 1), false);
		assert.equal(isAcUnitConfigured(cfg, 2), true);
		assert.deepEqual(configuredAcUnitIndexes(cfg), [2]);
	});

	it("limits mapping commands to enabled units with mapped roles only", () => {
		const cmds = acMappingCommandsForConfiguredUnits({
			ac_u1_enabled: true,
			ac_u1_cmd_switch_off_target: "ac.0.off",
			ac_u1_cmd_switch_off_enabled: true,
			ac_u2_enabled: true,
			ac_u2_room_temp_target: "temp.0.x",
			ac_u3_enabled: false,
			ac_u3_room_temp_target: "temp.0.y",
		});
		assert.deepEqual(cmds.sort(), ["unit_1_cmd_switch_off", "unit_2_room_temp"].sort());
		assert.ok(!cmds.some((c) => c.startsWith("unit_3_")));
	});

	it("enabled unit without mappings yields no mapping commands", () => {
		assert.deepEqual(acMappingCommandsForConfiguredUnits({ ac_u1_enabled: true }), []);
	});

	it("acMappingFromConfig only emits enabled units with mapped roles", async () => {
		const { acMappingFromConfig } = await import("./mapping_config.js");
		const entries = acMappingFromConfig({
			ac_u1_enabled: true,
			ac_u1_room_temp_enabled: true,
			ac_u1_room_temp_target: "temp.0.a",
			ac_u3_enabled: false,
			ac_u3_room_temp_enabled: true,
			ac_u3_room_temp_target: "temp.0.x",
		});
		assert.ok(Object.keys(entries).every((k) => k.startsWith("unit_1_")));
		assert.equal(entries["unit_3_room_temp"], undefined);
	});
});
