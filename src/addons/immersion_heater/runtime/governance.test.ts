import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runImmersionFsm } from "./fsm.js";
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

describe("immersion governance fsm", () => {
	it("disabled addon prevents heating even in force mode", () => {
		const r = runImmersionFsm({
			nowMs: NOW,
			addonEnabled: false,
			addonAvailable: true,
			configValid: true,
			executionLive: true,
			failsafeActive: false,
			resolvedMode: "force",
			forceTargetTempC: 60,
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
	});
});
