import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DeviceWriteHost } from "../../../device_write";
import {
	GENERIC_AC_PROFILE,
	getAcProfile,
	SAMSUNG_LOCALTHINGS_HASS_PROFILE,
	SAMSUNG_SMARTTHINGS_PROFILE,
} from "../profiles/registry.js";
import {
	localthingsFanModePayload,
	localthingsHvacModePayload,
	localthingsTemperaturePayload,
	stringifyLocalthingsPayload,
} from "../profiles/localthings_payload.js";
import { resolveLocalthingsMeasuredPowerW } from "../profiles/localthings_power.js";
import {
	formatLocalthingsFilterSummary,
	parseLocalthingsFilterStatus,
} from "../profiles/localthings_filter.js";
import { localthingsMappingsValid, validateAcUnitMappings } from "../profiles/validate_localthings.js";
import {
	buildLocalthingsPrefillPatch,
	mergeLocalthingsPrefillIntoConfig,
} from "../profiles/localthings_prefill.js";
import { deriveLocalthingsMappingsFromClimateBase } from "../profiles/localthings_presets.js";
import { executeAcWriteSteps, type AcMappingTable } from "./sequences.js";
import { switchIsOff, switchIsOn } from "./time.js";
import { isCleaningOperatingActive } from "./cleaning.js";
import type { AcUnitConfig } from "../types.js";

const UNIT: AcUnitConfig = {
	index: 1,
	enabled: true,
	name: "Test",
	profileId: "samsung_localthings_hass",
	activeFrom: "08:00",
	activeUntil: "20:00",
	hardOffAt: "20:00",
	estimatedPowerW: 800,
	onTempC: 26,
	offTempC: 24,
	maxHumidityPct: null,
	humidityOffHysteresisPct: 3,
	coolingSetpointC: 23,
	modeWhenCooling: "cool",
	fanModeWhenCooling: "auto",
	fanSpeedWhenCooling: "",
	modeWhenDehumidify: "dry",
	fanModeWhenDehumidify: "auto",
	modeWhenFanOnly: "fan_only",
	fanModeWhenFanOnly: "auto",
	modeWhenHeating: "heat",
	fanModeWhenHeating: "auto",
	heatSetpointC: 21,
	cleaningAfterRun: true,
	cleaningAfterCooling: true,
	cleaningAfterDehumidify: true,
	cleaningAfterHeating: false,
	cleaningDelayMin: 5,
	cleaningDurationMin: 35,
	statsEnabled: true,
	statsTrackRuntime: true,
	statsTrackEnergy: true,
	statsRuntimeOffsetSec: 0,
	statsEnergyOffsetKwh: 0,
};

function hassTable(): AcMappingTable {
	return {
		unit_1_cmd_switch_on: { enabled: true, targetStateId: "hass.0.entities.climate.x.turn_on" },
		unit_1_cmd_switch_off: { enabled: true, targetStateId: "hass.0.entities.climate.x.turn_off" },
		unit_1_cmd_set_mode: { enabled: true, targetStateId: "hass.0.entities.climate.x.set_hvac_mode" },
		unit_1_cmd_set_cool_setpoint: {
			enabled: true,
			targetStateId: "hass.0.entities.climate.x.set_temperature",
		},
		unit_1_cmd_set_fan_mode: { enabled: true, targetStateId: "hass.0.entities.climate.x.set_fan_mode" },
		unit_1_cmd_cleaning_start: {
			enabled: true,
			targetStateId: "hass.0.entities.switch.x_clean.turn_on",
		},
		unit_1_cmd_cleaning_off: {
			enabled: true,
			targetStateId: "hass.0.entities.switch.x_clean.turn_off",
		},
	};
}

describe("AC LocalThings / SmartThings profile abstraction", () => {
	it("1) SmartThings profile unchanged (id + refresh in start)", () => {
		assert.equal(SAMSUNG_SMARTTHINGS_PROFILE.id, "samsung_smartthings");
		const steps = SAMSUNG_SMARTTHINGS_PROFILE.coolingStartSequence(UNIT, "cooling");
		assert.ok(steps.some((s) => s.kind === "toggle" && s.role === "cmd_refresh"));
		assert.ok(steps.some((s) => s.kind === "set" && s.role === "cmd_set_mode"));
		assert.ok(!steps.some((s) => s.kind === "set_json"));
	});

	it("2–6) LocalThings turn_on/off + HVAC/temp/fan JSON writes", async () => {
		const writes: Array<{ id: string; val: unknown }> = [];
		const host: DeviceWriteHost = {
			getForeignStateAsync: async () => ({ val: false, ack: true, ts: 0, lc: 0, from: "t" }),
			setForeignStateAsync: async (id, state) => {
				if (state && typeof state === "object" && "val" in state) {
					writes.push({ id, val: state.val });
				}
			},
		};
		const table = hassTable();
		const profile = getAcProfile("samsung_localthings_hass");
		assert.equal(profile.id, SAMSUNG_LOCALTHINGS_HASS_PROFILE.id);

		const steps = profile.coolingStartSequence(UNIT, "cooling").filter((s) => s.kind !== "delay_ms");
		await executeAcWriteSteps(host, 1, table, steps, true);
		const tempW = writes.find((w) => String(w.id).includes("set_temperature"));
		const modeW = writes.find((w) => String(w.id).includes("set_hvac_mode"));
		const fanW = writes.find((w) => String(w.id).includes("set_fan_mode"));
		const onW = writes.find((w) => String(w.id).includes("turn_on") && w.val === true);
		assert.equal(tempW?.val, stringifyLocalthingsPayload(localthingsTemperaturePayload(23)));
		assert.equal(modeW?.val, stringifyLocalthingsPayload(localthingsHvacModePayload("cool")));
		assert.equal(fanW?.val, stringifyLocalthingsPayload(localthingsFanModePayload("auto")));
		assert.ok(onW);
		assert.ok(!writes.some((w) => w.id.includes("set_temperature") && w.val === true));
		assert.ok(!writes.some((w) => w.id.includes("set_hvac_mode") && w.val === true));

		writes.length = 0;
		await executeAcWriteSteps(host, 1, table, profile.coolingStopSequence?.() ?? [], true);
		assert.ok(writes.some((w) => String(w.id).includes("turn_off") && w.val === true));
	});

	it("7) Feedback off/cool via switchIsOn/Off", () => {
		assert.equal(switchIsOff("off"), true);
		assert.equal(switchIsOn("cool"), true);
		assert.equal(switchIsOn("heat"), true);
		assert.equal(switchIsOn(true), true);
		assert.equal(switchIsOff(false), true);
		assert.equal(switchIsOn("off"), false);
	});

	it("8) missing optional sensors do not invalidate core", () => {
		assert.equal(
			localthingsMappingsValid("samsung_localthings_hass", {
				feedback_switch: "hass.0.entities.climate.x.state_boolean",
				cmd_switch_on: "hass.0.entities.climate.x.turn_on",
				cmd_switch_off: "hass.0.entities.climate.x.turn_off",
				cmd_set_cool_setpoint: "hass.0.entities.climate.x.set_temperature",
				cmd_set_mode: "hass.0.entities.climate.x.set_hvac_mode",
				room_temp: "hass.0.entities.climate.x.current_temperature",
			}),
			true,
		);
	});

	it("9) Power 0 while AC on → learned fallback (no measured)", () => {
		const d = resolveLocalthingsMeasuredPowerW({ rawPowerW: 0, acConfirmedOn: true });
		assert.equal(d.useMeasured, false);
		assert.equal(d.reason, "implausible_zero_while_on");
	});

	it("10) Power >0 → measured usable", () => {
		const d = resolveLocalthingsMeasuredPowerW({ rawPowerW: 720, acConfirmedOn: true });
		assert.equal(d.useMeasured, true);
		if (d.useMeasured) assert.equal(d.powerW, 720);
	});

	it("11) LocalThings without refresh is valid", () => {
		const issues = validateAcUnitMappings({
			unitIndex: 1,
			profileId: "samsung_localthings_hass",
			targets: {
				feedback_switch: "h.state_boolean",
				cmd_switch_on: "h.turn_on",
				cmd_switch_off: "h.turn_off",
				cmd_set_cool_setpoint: "h.set_temperature",
				cmd_set_mode: "h.set_hvac_mode",
				room_temp: "h.current_temperature",
			},
		});
		assert.equal(issues.filter((i) => i.severity === "error").length, 0);
	});

	it("12) Auto-Clean switch sequences use toggle on/off roles", () => {
		const start = SAMSUNG_LOCALTHINGS_HASS_PROFILE.cleaningStartSequence();
		const stop = SAMSUNG_LOCALTHINGS_HASS_PROFILE.cleaningStopSequence();
		assert.deepEqual(start, [{ kind: "toggle", role: "cmd_cleaning_start" }]);
		assert.deepEqual(stop, [{ kind: "toggle", role: "cmd_cleaning_off" }]);
		assert.equal(isCleaningOperatingActive(true), true);
		assert.equal(isCleaningOperatingActive(false), false);
	});

	it("13) Filter status normal/wash/replace", () => {
		assert.equal(parseLocalthingsFilterStatus("normal"), "normal");
		assert.equal(parseLocalthingsFilterStatus("wash"), "wash");
		assert.equal(parseLocalthingsFilterStatus("replace"), "replace");
		assert.match(formatLocalthingsFilterSummary({ usagePct: 75, usageHours: 375, statusRaw: "normal" }), /75 %/);
		assert.match(formatLocalthingsFilterSummary({ usagePct: 75, usageHours: 375, statusRaw: "wash" }), /Reinigung/);
	});

	it("14) Prefill does not overwrite existing hass user config", () => {
		const cfg = {
			ac_u1_profile: "samsung_localthings_hass",
			ac_u1_enabled: true,
			ac_u1_feedback_switch_target: "hass.0.entities.climate.custom.state_boolean",
			ac_u1_cmd_switch_on_target: "hass.0.entities.climate.custom.turn_on",
			ac_u1_cmd_set_mode_target: "hass.0.entities.climate.custom.set_hvac_mode",
			ac_u1_cmd_set_cool_setpoint_target: "hass.0.entities.climate.custom.set_temperature",
		};
		assert.equal(buildLocalthingsPrefillPatch(cfg), null);
	});

	it("15) Switching back to SmartThings restores SmartThings write contract", () => {
		const st = getAcProfile("samsung_smartthings");
		const lt = getAcProfile("samsung_localthings_hass");
		const stSteps = st.coolingStartSequence(UNIT, "cooling");
		const ltSteps = lt.coolingStartSequence(UNIT, "cooling");
		assert.ok(stSteps.some((s) => s.kind === "set"));
		assert.ok(ltSteps.some((s) => s.kind === "set_json"));
		assert.ok(stSteps.some((s) => s.kind === "toggle" && s.role === "cmd_refresh"));
		assert.ok(!ltSteps.some((s) => s.kind === "toggle" && s.role === "cmd_refresh"));
	});

	it("16) Installations without new profile start unchanged (generic fallback + SmartThings default id)", () => {
		assert.equal(getAcProfile("unknown_profile").id, GENERIC_AC_PROFILE.id);
		assert.equal(getAcProfile("samsung_smartthings").id, "samsung_smartthings");
	});

	it("Prefill fills site presets when profile LocalThings and SmartThings paths present", () => {
		const cfg = {
			ac_u1_enabled: true,
			ac_u1_profile: "samsung_localthings_hass",
			ac_u1_feedback_switch_target: "smartthings.0.dev.status.switch.switch.value",
			ac_u1_cmd_switch_on_target: "smartthings.0.dev.capabilities.switch-on",
			ac_u2_enabled: true,
			ac_u2_profile: "samsung_localthings_hass",
			ac_u2_feedback_switch_target: "smartthings.0.other.status.switch.switch.value",
			ac_u2_cmd_switch_on_target: "smartthings.0.other.capabilities.switch-on",
		};
		const merged = mergeLocalthingsPrefillIntoConfig(cfg);
		assert.match(String(merged.ac_u1_cmd_switch_on_target), /wohnzimmer_eg.*turn_on/);
		assert.match(String(merged.ac_u2_cmd_switch_on_target), /josef_zimmer.*turn_on/);
		assert.match(String(merged.ac_u1_cmd_set_cool_setpoint_target), /set_temperature/);
		assert.equal(merged.ac_u1_cmd_cleaning_off_enabled, true);
	});

	it("scheduleLocalthingsPrefillPersist does not call updateConfig before bootstrap complete", async () => {
		const { resetBootstrapBarrierForTest, markBootstrapComplete } = await import(
			"../../../bootstrap/barrier.js"
		);
		const { scheduleLocalthingsPrefillPersist, clearLocalthingsPrefillPersistTimer } = await import(
			"../profiles/localthings_prefill.js"
		);
		resetBootstrapBarrierForTest();
		clearLocalthingsPrefillPersistTimer();
		let calls = 0;
		scheduleLocalthingsPrefillPersist(
			{
				log: { info: () => undefined, warn: () => undefined },
				updateConfig: async () => {
					calls += 1;
				},
			},
			{ ac_u1_profile: "samsung_localthings_hass" },
		);
		await new Promise((r) => setTimeout(r, 50));
		assert.equal(calls, 0, "kein updateConfig während Bootstrap");
		clearLocalthingsPrefillPersistTimer();
		markBootstrapComplete();
	});

	it("derive mappings from climate entity base", () => {
		const d = deriveLocalthingsMappingsFromClimateBase(
			"hass.0.entities.climate.foo_bar.state",
		);
		assert.equal(d.cmd_switch_on, "hass.0.entities.climate.foo_bar.turn_on");
		assert.equal(d.cmd_set_mode, "hass.0.entities.climate.foo_bar.set_hvac_mode");
	});

	it("payload helpers", () => {
		assert.equal(JSON.stringify(localthingsHvacModePayload("cool")), '{"hvac_mode":"cool"}');
		assert.equal(JSON.stringify(localthingsTemperaturePayload(23)), '{"temperature":23}');
	});
});
