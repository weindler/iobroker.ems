import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { immersionDeviceConfigFromAdapter } from "./device_config.js";
import { validateImmersionDeviceConfig } from "./validate_config.js";

describe("immersion config validation", () => {
	it("rejects invalid temperature window", () => {
		const cfg = immersionDeviceConfigFromAdapter({
			ih_planning_min_temp_c: 60,
			ih_planning_max_temp_c: 48,
			ih_set_enabled_target: "x",
			ih_buffer_temp_c_target: "t",
			ih_stage_1_nominal_power_w: 2000,
		});
		const v = validateImmersionDeviceConfig(cfg);
		assert.equal(v.valid, false);
		assert.ok(v.errors.includes("planning_min_temp_c_must_be_below_max"));
	});

	it("accepts migrated single-stage config with power", () => {
		const cfg = immersionDeviceConfigFromAdapter({
			ih_set_enabled_target: "relay.0",
			ih_buffer_temp_c_target: "temp.0",
			ih_stage_1_nominal_power_w: 3000,
		});
		const v = validateImmersionDeviceConfig(cfg);
		assert.equal(v.valid, true);
	});
});
