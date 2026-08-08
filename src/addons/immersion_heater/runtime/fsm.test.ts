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
			plannerCommandedStage: 0,
			plannerTargetTempC: null,
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
			plannerCommandedStage: 0,
			plannerTargetTempC: null,
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
			plannerCommandedStage: 0,
			plannerTargetTempC: null,
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
			plannerCommandedStage: 0,
			plannerTargetTempC: null,
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

	it("auto planner stage starts heating", () => {
		const r = runImmersionFsm({
			nowMs: NOW,
			addonEnabled: true,
			addonAvailable: true,
			configValid: true,
			executionLive: false,
			failsafeActive: false,
			resolvedMode: "auto",
			forceTargetTempC: null,
			forceUntilMs: null,
			plannerCommandedStage: 1,
			plannerTargetTempC: null,
			temperature: { valueC: 50, status: "valid", observedAtMs: NOW },
			measuredPowerW: 0,
			hasPowerMeasurement: false,
			persist: emptyPersist(),
			config: CFG,
			faultLockout: false,
			faultCode: "none",
		});
		assert.equal(r.state, "auto_heating");
		assert.equal(r.commandedStage, 1);
		assert.equal(r.commandedPowerW, 3000);
	});

	it("auto planner target stops heating below hard max", () => {
		const r = runImmersionFsm({
			nowMs: NOW,
			addonEnabled: true,
			addonAvailable: true,
			configValid: true,
			executionLive: false,
			failsafeActive: false,
			resolvedMode: "auto",
			forceTargetTempC: null,
			forceUntilMs: null,
			plannerCommandedStage: 1,
			plannerTargetTempC: 54,
			temperature: { valueC: 55, status: "valid", observedAtMs: NOW },
			measuredPowerW: 0,
			hasPowerMeasurement: false,
			persist: emptyPersist(),
			config: CFG,
			faultLockout: false,
			faultCode: "none",
		});
		assert.equal(r.state, "auto_ready");
		assert.equal(r.reason, "auto_planning_target_reached");
		assert.equal(r.commandedStage, 0);
	});

	it("auto reheat hysteresis blocks only when planner wants OFF (local/fallback taktschutz)", () => {
		// CFG: ih_temperature_hysteresis_k default = 2 K, autoTargetC = 60 (kein plannerTargetTempC).
		const r = runImmersionFsm({
			nowMs: NOW,
			addonEnabled: true,
			addonAvailable: true,
			configValid: true,
			executionLive: false,
			failsafeActive: false,
			resolvedMode: "auto",
			forceTargetTempC: null,
			forceUntilMs: null,
			plannerCommandedStage: 0,
			plannerTargetTempC: null,
			temperature: { valueC: 59, status: "valid", observedAtMs: NOW },
			measuredPowerW: 0,
			hasPowerMeasurement: false,
			persist: { ...emptyPersist(), autoTargetReached: true },
			config: CFG,
			faultLockout: false,
			faultCode: "none",
		});
		assert.equal(r.state, "auto_ready");
		assert.equal(r.reason, "auto_reheat_hysteresis");
		assert.equal(r.commandedStage, 0);
	});

	it("explicit planner stage > 0 is NOT blocked by reheat hysteresis (unified preload)", () => {
		// Beta-Fall: Buf 49 °C, Re-Enable erst unter 46,6 °C, Unified will 1700 W jetzt.
		const r = runImmersionFsm({
			nowMs: NOW,
			addonEnabled: true,
			addonAvailable: true,
			configValid: true,
			executionLive: true,
			failsafeActive: false,
			resolvedMode: "auto",
			forceTargetTempC: null,
			forceUntilMs: null,
			plannerCommandedStage: 1,
			plannerTargetTempC: 51.6,
			temperature: { valueC: 49, status: "valid", observedAtMs: NOW },
			measuredPowerW: 0,
			hasPowerMeasurement: false,
			persist: { ...emptyPersist(), autoTargetReached: true, commandedStage: 0 },
			config: {
				...CFG,
				temperatureHysteresisK: 5,
				planningMinTempC: 44,
				planningMaxTempC: 63,
			},
			faultLockout: false,
			faultCode: "none",
		});
		assert.equal(r.state, "auto_heating");
		assert.equal(r.commandedStage, 1);
		assert.equal(r.reason, "auto_planner_heating");
		assert.notEqual(r.reason, "auto_reheat_hysteresis");
	});

	it("auto reheat hysteresis does NOT block restart if target was never reached (PV dip before full charge)", () => {
		// Heizstab stoppte z.B. wegen kurzer Überschuss-Lücke bei 59°C, bevor autoTargetC (60) je
		// erreicht wurde. persist.autoTargetReached bleibt false → darf beim nächsten Überschuss
		// sofort weiterheizen statt bis (Ziel − Hysterese) zu warten.
		const r = runImmersionFsm({
			nowMs: NOW,
			addonEnabled: true,
			addonAvailable: true,
			configValid: true,
			executionLive: false,
			failsafeActive: false,
			resolvedMode: "auto",
			forceTargetTempC: null,
			forceUntilMs: null,
			plannerCommandedStage: 1,
			plannerTargetTempC: null,
			temperature: { valueC: 59, status: "valid", observedAtMs: NOW },
			measuredPowerW: 0,
			hasPowerMeasurement: false,
			persist: emptyPersist(),
			config: CFG,
			faultLockout: false,
			faultCode: "none",
		});
		assert.equal(r.state, "auto_heating");
		assert.equal(r.commandedStage, 1);
		assert.equal(r.autoTargetReached, false);
	});

	it("auto reheat hysteresis allows restart once below (target - hysteresis), resetting the reached-flag", () => {
		const r = runImmersionFsm({
			nowMs: NOW,
			addonEnabled: true,
			addonAvailable: true,
			configValid: true,
			executionLive: false,
			failsafeActive: false,
			resolvedMode: "auto",
			forceTargetTempC: null,
			forceUntilMs: null,
			plannerCommandedStage: 1,
			plannerTargetTempC: null,
			temperature: { valueC: 57.9, status: "valid", observedAtMs: NOW },
			measuredPowerW: 0,
			hasPowerMeasurement: false,
			persist: { ...emptyPersist(), autoTargetReached: true },
			config: CFG,
			faultLockout: false,
			faultCode: "none",
		});
		assert.equal(r.state, "auto_heating");
		assert.equal(r.commandedStage, 1);
		assert.equal(r.autoTargetReached, false);
	});

	it("reaching autoTargetC sets autoTargetReached for later hysteresis gating", () => {
		const r = runImmersionFsm({
			nowMs: NOW,
			addonEnabled: true,
			addonAvailable: true,
			configValid: true,
			executionLive: false,
			failsafeActive: false,
			resolvedMode: "auto",
			forceTargetTempC: null,
			forceUntilMs: null,
			plannerCommandedStage: 0,
			plannerTargetTempC: 54,
			temperature: { valueC: 54, status: "valid", observedAtMs: NOW },
			measuredPowerW: 0,
			hasPowerMeasurement: false,
			persist: emptyPersist(),
			config: CFG,
			faultLockout: false,
			faultCode: "none",
		});
		assert.equal(r.reason, "auto_planning_target_reached");
		assert.equal(r.autoTargetReached, true);
	});

	it("auto reheat hysteresis does not interrupt an already-running heating cycle", () => {
		// persist.commandedStage > 0 (bereits am Heizen) → Hysterese-Block greift nicht,
		// normale Weiterführung bis temp >= autoTargetC.
		const r = runImmersionFsm({
			nowMs: NOW,
			addonEnabled: true,
			addonAvailable: true,
			configValid: true,
			executionLive: false,
			failsafeActive: false,
			resolvedMode: "auto",
			forceTargetTempC: null,
			forceUntilMs: null,
			plannerCommandedStage: 1,
			plannerTargetTempC: null,
			temperature: { valueC: 59, status: "valid", observedAtMs: NOW },
			measuredPowerW: 0,
			hasPowerMeasurement: false,
			persist: { ...emptyPersist(), commandedStage: 1 },
			config: CFG,
			faultLockout: false,
			faultCode: "none",
		});
		assert.equal(r.state, "auto_heating");
		assert.equal(r.commandedStage, 1);
	});

	it("control mode maps to operating_request", () => {
		assert.equal(controlModeToOperatingRequest("force"), "force_on");
		assert.equal(controlModeToOperatingRequest("off"), "off");
	});
});
