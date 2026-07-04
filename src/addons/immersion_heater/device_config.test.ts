import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { immersionDeviceConfigFromAdapter } from "./device_config.js";

describe("immersion device config", () => {
	it("migrates set_enabled to stage 1", () => {
		const cfg = immersionDeviceConfigFromAdapter({
			ih_set_enabled_target: "mqtt.0.heater.switch",
			ih_buffer_temp_c_target: "mqtt.0.temp",
			ih_buffer_temp_c_enabled: true,
		});
		assert.equal(cfg.stages[0].setStateId, "mqtt.0.heater.switch");
		assert.equal(cfg.stageCount, 1);
		assert.equal(cfg.stages[0].nominalPowerW, 1700);
		assert.equal(cfg.stages[0].name, "Ein/Aus");
		assert.equal(cfg.planningMinTempC, 48);
		assert.equal(cfg.planningMaxTempC, 60);
	});

	it("multi-stage requires explicit nominal on stage 2", () => {
		const cfg = immersionDeviceConfigFromAdapter({
			ih_stage_count: 2,
			ih_stage_1_set_state: "a.0.s1",
			ih_stage_1_nominal_power_w: 2000,
			ih_stage_2_set_state: "a.0.s2",
			ih_buffer_temp_c_target: "a.0.temp",
			ih_buffer_temp_c_enabled: true,
		});
		assert.equal(cfg.stages[1].nominalPowerW, 0);
	});
});
