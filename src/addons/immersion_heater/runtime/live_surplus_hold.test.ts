import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { immersionDeviceConfigFromAdapter } from "../device_config.js";
import {
	computeEffectivePvSurplusW,
	computeImmersionLiveSurplusHold,
} from "./live_surplus_hold.js";

const CFG = immersionDeviceConfigFromAdapter({
	ih_stage_count: 1,
	ih_stage_1_nominal_power_w: 1700,
	ih_stage_1_set_state: "s1",
	ih_stage_1_enabled: true,
	ih_planning_max_temp_c: 65,
});

describe("immersion live surplus hold", () => {
	it("adds running IH power back into surplus (house load includes heater)", () => {
		assert.equal(computeEffectivePvSurplusW(5000, 4000, 1700), 2700);
		assert.equal(computeEffectivePvSurplusW(5000, 4000, null), 1000);
	});

	it("holds when surplus covers min stage and buffer below target", () => {
		const r = computeImmersionLiveSurplusHold({
			pvPowerW: 5000,
			houseLoadW: 4000,
			immersionOnPowerW: 1700,
			bufferTempC: 45,
			targetTempC: 58,
			planningMaxTempC: 65,
			continueHeating: true,
			config: CFG,
		});
		assert.equal(r.active, true);
		assert.equal(r.stageIndex, 1);
		assert.equal(r.stagePowerW, 1700);
		assert.match(r.reasonDe, /Durchlauf/);
	});

	it("inactive without continueHeating", () => {
		const r = computeImmersionLiveSurplusHold({
			pvPowerW: 5000,
			houseLoadW: 1000,
			immersionOnPowerW: null,
			bufferTempC: 45,
			targetTempC: 58,
			planningMaxTempC: 65,
			continueHeating: false,
			config: CFG,
		});
		assert.equal(r.active, false);
	});

	it("inactive when surplus too low", () => {
		const r = computeImmersionLiveSurplusHold({
			pvPowerW: 2000,
			houseLoadW: 1900,
			immersionOnPowerW: null,
			bufferTempC: 45,
			targetTempC: 58,
			planningMaxTempC: 65,
			continueHeating: true,
			config: CFG,
		});
		assert.equal(r.active, false);
		assert.match(r.reasonDe, /unter Stufe/);
	});

	it("inactive at planning target", () => {
		const r = computeImmersionLiveSurplusHold({
			pvPowerW: 5000,
			houseLoadW: 1000,
			immersionOnPowerW: null,
			bufferTempC: 58,
			targetTempC: 58,
			planningMaxTempC: 65,
			continueHeating: true,
			config: CFG,
		});
		assert.equal(r.active, false);
		assert.match(r.reasonDe, /Tagesziel/);
	});
});
