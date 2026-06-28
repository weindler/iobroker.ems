import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkPowerFault, isRelayChatter, recordChatterEvent, canResetFault } from "./safety.js";
import { immersionDeviceConfigFromAdapter } from "../device_config.js";

const CFG = immersionDeviceConfigFromAdapter({
	ih_set_enabled_target: "r",
	ih_buffer_temp_c_target: "t",
	ih_actual_power_state: "p",
	ih_stage_1_nominal_power_w: 3000,
});

describe("immersion safety", () => {
	it("no measurement yields no fault", () => {
		const r = checkPowerFault({
			nowMs: 100_000,
			executionLive: true,
			commandedOn: true,
			commandedStage: 1,
			nominalPowerW: 3000,
			measuredPowerW: null,
			hasPowerMeasurement: false,
			feedbackActive: false,
			emsOnWriteAtMs: 0,
			emsOffWriteAtMs: null,
			mismatchSinceMs: null,
			config: CFG,
		});
		assert.equal(r.faultCode, "none");
	});

	it("no_power_when_on after delay", () => {
		const r = checkPowerFault({
			nowMs: 100_000,
			executionLive: true,
			commandedOn: true,
			commandedStage: 1,
			nominalPowerW: 3000,
			measuredPowerW: 5,
			hasPowerMeasurement: true,
			feedbackActive: false,
			emsOnWriteAtMs: 0,
			emsOffWriteAtMs: null,
			mismatchSinceMs: null,
			config: CFG,
		});
		assert.equal(r.faultCode, "no_power_when_on");
	});

	it("power_when_off detects stuck relay after EMS wrote off", () => {
		const r = checkPowerFault({
			nowMs: 100_000,
			executionLive: true,
			commandedOn: false,
			commandedStage: 0,
			nominalPowerW: 0,
			measuredPowerW: 500,
			hasPowerMeasurement: true,
			feedbackActive: false,
			emsOnWriteAtMs: null,
			emsOffWriteAtMs: 0,
			mismatchSinceMs: null,
			config: CFG,
		});
		assert.equal(r.faultCode, "power_when_off");
	});

	it("power_when_off also fires on stuck feedback without power measurement", () => {
		const r = checkPowerFault({
			nowMs: 100_000,
			executionLive: true,
			commandedOn: false,
			commandedStage: 0,
			nominalPowerW: 0,
			measuredPowerW: null,
			hasPowerMeasurement: false,
			feedbackActive: true,
			emsOnWriteAtMs: null,
			emsOffWriteAtMs: 0,
			mismatchSinceMs: null,
			config: CFG,
		});
		assert.equal(r.faultCode, "power_when_off");
	});

	it("dryrun never raises a power fault (EMS does not own the relay)", () => {
		const r = checkPowerFault({
			nowMs: 100_000,
			executionLive: false,
			commandedOn: false,
			commandedStage: 0,
			nominalPowerW: 0,
			measuredPowerW: 500,
			hasPowerMeasurement: true,
			feedbackActive: true,
			emsOnWriteAtMs: null,
			emsOffWriteAtMs: 0,
			mismatchSinceMs: null,
			config: CFG,
		});
		assert.equal(r.faultCode, "none");
		assert.equal(r.lockout, false);
	});

	it("power_when_off does not fire before EMS itself wrote off", () => {
		const r = checkPowerFault({
			nowMs: 100_000,
			executionLive: true,
			commandedOn: false,
			commandedStage: 0,
			nominalPowerW: 0,
			measuredPowerW: 500,
			hasPowerMeasurement: true,
			feedbackActive: true,
			emsOnWriteAtMs: null,
			emsOffWriteAtMs: null,
			mismatchSinceMs: null,
			config: CFG,
		});
		assert.equal(r.faultCode, "none");
	});

	it("power_when_off waits for the off-check delay", () => {
		const cfg = immersionDeviceConfigFromAdapter({
			ih_set_enabled_target: "r",
			ih_buffer_temp_c_target: "t",
			ih_actual_power_state: "p",
			ih_stage_1_nominal_power_w: 3000,
			ih_switch_off_check_delay_sec: 30,
		});
		const r = checkPowerFault({
			nowMs: 10_000,
			executionLive: true,
			commandedOn: false,
			commandedStage: 0,
			nominalPowerW: 0,
			measuredPowerW: 500,
			hasPowerMeasurement: true,
			feedbackActive: false,
			emsOnWriteAtMs: null,
			emsOffWriteAtMs: 0,
			mismatchSinceMs: null,
			config: cfg,
		});
		assert.equal(r.faultCode, "none");
	});

	it("relay chatter detection", () => {
		let t: ReturnType<typeof recordChatterEvent> = { timestampsMs: [] };
		for (let i = 0; i < 8; i++) {
			t = recordChatterEvent(t, i * 1000, 300);
		}
		assert.equal(isRelayChatter(t, 6), true);
	});

	it("fault reset rejected with power present", () => {
		const r = canResetFault({
			allStagesOff: true,
			measuredPowerW: 100,
			hasPowerMeasurement: true,
			powerOffThresholdW: 20,
			configValid: true,
			temperatureValid: true,
			chatterActive: false,
		});
		assert.equal(r.ok, false);
	});
});
