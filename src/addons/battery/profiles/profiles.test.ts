import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { batteryConfigFromAdapter } from "../config.js";
import { batteryMappingFromConfig } from "../mapping.js";
import { getBatteryProfile } from "./registry.js";

const FULL_SONNEN = {
	battery_profile: "sonnen_em",
	bat_hw_max_charge_w: 5000,
	bat_hw_max_discharge_w: 5000,
	bat_hw_min_soc_pct: 5,
	bat_hw_max_soc_pct: 100,
	bat_soc_target: "sonnen.0.status.soc",
	bat_power_target: "sonnen.0.status.power",
	bat_operating_mode_target: "sonnen.0.configurations.EM_OperatingMode",
	bat_battery_charging_target: "sonnen.0.control.charge",
};

describe("generic_readonly profile", () => {
	const profile = getBatteryProfile("generic_readonly");
	const config = batteryConfigFromAdapter({ battery_profile: "generic_readonly", bat_soc_target: "x.soc" });
	const mapping = batteryMappingFromConfig({ battery_profile: "generic_readonly", bat_soc_target: "x.soc" });
	const input = { config, mapping, limits: config.limits };

	it("reads telemetry, no control / live", () => {
		const caps = profile.buildCapabilities(input);
		assert.equal(caps.read_soc.available, true);
		assert.equal(caps.set_charge_power.available, false);
		assert.equal(caps.set_operating_mode.available, false);
		assert.equal(caps.live_control.available, false);
		assert.equal(profile.supportsLive, false);
	});

	it("never live-ready", () => {
		const r = profile.computeReadiness(input);
		assert.equal(r.liveReady, false);
		assert.equal(r.controlReady, false);
	});
});

describe("sonnen_em profile", () => {
	const profile = getBatteryProfile("sonnen_em");
	const config = batteryConfigFromAdapter(FULL_SONNEN);
	const mapping = batteryMappingFromConfig(FULL_SONNEN);
	const input = { config, mapping, limits: config.limits };

	it("normalizes sonnen mode numbers", () => {
		assert.equal(profile.normalizeOperatingMode(1, input), "manual");
		assert.equal(profile.normalizeOperatingMode(2, input), "self_consumption");
		assert.equal(profile.normalizeOperatingMode(7, input), "unknown");
	});

	it("capability matrix correct for full config", () => {
		const caps = profile.buildCapabilities(input);
		assert.equal(caps.set_operating_mode.available, true);
		assert.equal(caps.set_charge_power.available, true);
		assert.equal(caps.live_control.available, true);
		assert.equal(caps.safe_restore.available, true);
	});

	it("discharge not supported", () => {
		const caps = profile.buildCapabilities(input);
		assert.equal(caps.set_discharge_power.supported, false);
		assert.equal(caps.set_discharge_power.available, false);
	});

	it("missing write mapping prevents live readiness", () => {
		const cfgNoWrite = { ...FULL_SONNEN, bat_battery_charging_target: "" };
		const m = batteryMappingFromConfig(cfgNoWrite);
		const c = batteryConfigFromAdapter(cfgNoWrite);
		const r = profile.computeReadiness({ config: c, mapping: m, limits: c.limits });
		assert.equal(r.liveReady, false);
		assert.equal(r.telemetryReady, true);
	});
});
