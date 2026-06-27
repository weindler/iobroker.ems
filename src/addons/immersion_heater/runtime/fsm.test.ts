import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runImmersionFsm, evaluateTemperature, controlModeToOperatingRequest } from "./fsm.js";
import { immersionDeviceConfigFromAdapter } from "../device_config.js";
import { emptyPersist } from "./persist.js";

const NOW = new Date("2026-06-27T14:00:00Z").getTime();
const CFG = immersionDeviceConfigFromAdapter({
	ih_set_enabled_target: "r",
	ih_buffer_temp_c_target: "t",
	ih_stage_1_nominal_power_w: 3000,
	ih_planning_max_temp_c: 60,
	ih_planning_min_temp_c: 48,
});

describe("immersion fsm", () => {
	it("off prevents heating", () => {
		const r = runImmersionFsm({
			nowMs: NOW,
			addonEnabled: true,
			addonAvailable: true,
			configValid: true,
			executionLive: true,
			failsafeActive: false,
			resolvedMode: "off",
			forceTargetTempC: null,
			forceUntilMs: null,
			temperature: { valueC: 40, status: "valid", observedAtMs: NOW },
			measuredPowerW: 0,
			hasPowerMeasurement: false,
			persist: emptyPersist(),
			config: CFG,
			faultLockout: false,
			faultCode: "none",
		});
		assert.equal(r.commandedStage, 0);
		assert.equal(r.state, "off");
	});

	it("force waits for pause", () => {
		const r = runImmersionFsm({
			nowMs: NOW,
			addonEnabled: true,
			addonAvailable: true,
			configValid: true,
			executionLive: true,
			failsafeActive: false,
			resolvedMode: "force",
			forceTargetTempC: 60,
			forceUntilMs: null,
			temperature: { valueC: 50, status: "valid", observedAtMs: NOW },
			measuredPowerW: 0,
			hasPowerMeasurement: false,
			persist: { ...emptyPersist(), pauseUntilMs: NOW + 120_000 },
			config: CFG,
			faultLockout: false,
			faultCode: "none",
		});
		assert.equal(r.state, "force_waiting_for_pause");
	});

	it("force target already reached reverts", () => {
		const r = runImmersionFsm({
			nowMs: NOW,
			addonEnabled: true,
			addonAvailable: true,
			configValid: true,
			executionLive: true,
			failsafeActive: false,
			resolvedMode: "force",
			forceTargetTempC: 60,
			forceUntilMs: null,
			temperature: { valueC: 61, status: "valid", observedAtMs: NOW },
			measuredPowerW: 0,
			hasPowerMeasurement: false,
			persist: emptyPersist(),
			config: CFG,
			faultLockout: false,
			faultCode: "none",
		});
		assert.equal(r.autoRevertToAuto, true);
	});

	it("stale temperature blocks force", () => {
		const r = runImmersionFsm({
			nowMs: NOW,
			addonEnabled: true,
			addonAvailable: true,
			configValid: true,
			executionLive: true,
			failsafeActive: false,
			resolvedMode: "force",
			forceTargetTempC: 60,
			forceUntilMs: null,
			temperature: evaluateTemperature(50, NOW - 600_000, NOW, CFG),
			measuredPowerW: 0,
			hasPowerMeasurement: false,
			persist: emptyPersist(),
			config: CFG,
			faultLockout: false,
			faultCode: "none",
		});
		assert.equal(r.commandedStage, 0);
		assert.match(r.reason, /stale/);
	});

	it("control mode maps to operating_request", () => {
		assert.equal(controlModeToOperatingRequest("force"), "force_on");
		assert.equal(controlModeToOperatingRequest("off"), "off");
	});
});
