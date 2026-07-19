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

	it("limits mapping commands to enabled units only", () => {
		const cmds = acMappingCommandsForConfiguredUnits({
			ac_u1_enabled: true,
			ac_u2_enabled: true,
			ac_u3_enabled: false,
			ac_u3_room_temp_target: "temp.0.x",
		});
		assert.ok(cmds.every((c) => c.startsWith("unit_1_") || c.startsWith("unit_2_")));
		assert.ok(cmds.includes("unit_1_cmd_switch_off"));
		assert.ok(!cmds.some((c) => c.startsWith("unit_3_")));
	});

	it("acMappingFromConfig only emits enabled units", async () => {
		const { acMappingFromConfig } = await import("./mapping_config.js");
		const entries = acMappingFromConfig({
			ac_u1_enabled: true,
			ac_u1_room_temp_enabled: true,
			ac_u3_enabled: false,
			ac_u3_room_temp_enabled: true,
			ac_u3_room_temp_target: "temp.0.x",
		});
		assert.ok(Object.keys(entries).every((k) => k.startsWith("unit_1_")));
		assert.equal(entries["unit_3_room_temp"], undefined);
	});
});
