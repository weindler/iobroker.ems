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
			powerObservedAtMs: 100_000,
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
			powerObservedAtMs: 100_000,
			mismatchSinceMs: null,
			config: CFG,
		});
		assert.equal(r.faultCode, "no_power_when_on");
	});

	it("no_power_when_on waits for power reading updated after EMS switch-on", () => {
		const r = checkPowerFault({
			nowMs: 50_000,
			executionLive: true,
			commandedOn: true,
			commandedStage: 1,
			nominalPowerW: 3000,
			measuredPowerW: 0,
			hasPowerMeasurement: true,
			feedbackActive: false,
			emsOnWriteAtMs: 10_000,
			emsOffWriteAtMs: null,
			powerObservedAtMs: 5_000,
			mismatchSinceMs: null,
			config: CFG,
		});
		assert.equal(r.faultCode, "none");
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
			powerObservedAtMs: null,
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
			powerObservedAtMs: null,
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
			powerObservedAtMs: null,
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
			powerObservedAtMs: null,
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
			powerObservedAtMs: null,
			mismatchSinceMs: null,
			config: cfg,
		});
		assert.equal(r.faultCode, "none");
	});

	it("power_when_off waits for power reading updated after EMS switch-off", () => {
		const r = checkPowerFault({
			nowMs: 80_000,
			executionLive: true,
			commandedOn: false,
			commandedStage: 0,
			nominalPowerW: 0,
			measuredPowerW: 1700,
			hasPowerMeasurement: true,
			feedbackActive: false,
			emsOnWriteAtMs: 0,
			emsOffWriteAtMs: 50_000,
			powerObservedAtMs: 40_000,
			mismatchSinceMs: null,
			config: CFG,
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

	it("relay_chatter fault reset allowed while chatter tracker still active", () => {
		const r = canResetFault({
			allStagesOff: true,
			measuredPowerW: 0,
			hasPowerMeasurement: true,
			powerOffThresholdW: 20,
			configValid: true,
			temperatureValid: true,
			chatterActive: true,
			faultCode: "relay_chatter",
		});
		assert.equal(r.ok, true);
	});

	it("fault reset blocked while relay chatter active for other faults", () => {
		const r = canResetFault({
			allStagesOff: true,
			measuredPowerW: 0,
			hasPowerMeasurement: true,
			powerOffThresholdW: 20,
			configValid: true,
			temperatureValid: true,
			chatterActive: true,
			faultCode: "power_when_off",
		});
		assert.equal(r.ok, false);
		assert.equal(r.reason, "relay_chatter_active");
	});
});
