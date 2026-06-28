import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { batteryConfigFromAdapter } from "../config.js";
import { batteryMappingFromConfig } from "../mapping.js";
import { getBatteryProfile } from "../profiles/registry.js";
import { validateBatteryIntent } from "./validation.js";
import type { BatteryDeviceIntent } from "./types.js";

const CFG = {
	battery_profile: "sonnen_em",
	bat_hw_max_charge_w: 5000,
	bat_hw_max_discharge_w: 5000,
	bat_hw_min_soc_pct: 5,
	bat_hw_max_soc_pct: 95,
	bat_soc_target: "x.soc",
	bat_power_target: "x.power",
	bat_operating_mode_target: "x.mode",
	bat_battery_charging_target: "x.charge",
};

const config = batteryConfigFromAdapter(CFG);
const mapping = batteryMappingFromConfig(CFG);
const profile = getBatteryProfile("sonnen_em");
const capabilities = profile.buildCapabilities({ config, mapping, limits: config.limits });

function intent(over: Partial<BatteryDeviceIntent>): BatteryDeviceIntent {
	return {
		requestId: "r1",
		action: "charge",
		targetSocPct: null,
		maxChargeW: 3000,
		maxDischargeW: null,
		energySource: "any",
		validFrom: null,
		validUntil: null,
		issuedAt: null,
		reason: "",
		source: "test",
		...over,
	};
}

const base = {
	limits: config.limits,
	capabilities,
	governanceEnabled: true,
	telemetrySocValid: true,
	telemetryFreshForAction: true,
	fault: false,
	lockout: false,
};

describe("battery intent validation", () => {
	it("clamps charge power to hardware max", () => {
		const r = validateBatteryIntent({ ...base, intent: intent({ maxChargeW: 9000 }) });
		assert.equal(r.accepted, true);
		assert.equal(r.effectiveChargeW, 5000);
		assert.ok(r.clamps.some((c) => c.reason === "hardware_max_charge_w"));
	});

	it("clamps target soc to hardware max", () => {
		const r = validateBatteryIntent({ ...base, intent: intent({ targetSocPct: 100 }) });
		assert.equal(r.effectiveTargetSocPct, 95);
		assert.ok(r.clamps.some((c) => c.reason === "hardware_max_soc_pct"));
	});

	it("rejects when governance disabled", () => {
		const r = validateBatteryIntent({ ...base, governanceEnabled: false, intent: intent({}) });
		assert.equal(r.accepted, false);
		assert.equal(r.rejectCode, "addon_disabled");
	});

	it("rejects charge when telemetry stale", () => {
		const r = validateBatteryIntent({ ...base, telemetryFreshForAction: false, intent: intent({}) });
		assert.equal(r.accepted, false);
		assert.equal(r.rejectCode, "telemetry_stale");
	});

	it("rejects when limits invalid", () => {
		const badCfg = batteryConfigFromAdapter({ ...CFG, bat_hw_max_charge_w: 0 });
		const r = validateBatteryIntent({ ...base, limits: badCfg.limits, intent: intent({}) });
		assert.equal(r.accepted, false);
	});

	it("rejects fault and lockout", () => {
		assert.equal(validateBatteryIntent({ ...base, fault: true, intent: intent({}) }).rejectCode, "fault");
		assert.equal(validateBatteryIntent({ ...base, lockout: true, intent: intent({}) }).rejectCode, "lockout");
	});
});
