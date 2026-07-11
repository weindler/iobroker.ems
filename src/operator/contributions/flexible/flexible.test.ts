import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { acGlobalConfigFromAdapter } from "../../../addons/air_conditioning/config";
import { AC_UNIT_COUNT } from "../../../addons/air_conditioning/constants";
import { immersionDeviceConfigFromAdapter } from "../../../addons/immersion_heater/device_config";
import { plannerModePolicyFromGlobalMode } from "../../../planner/mode_policy";
import { operatorQuality } from "../../quality";
import type { GridSupplyForecast } from "../../types";
import { CONTRIBUTION_IDS } from "../../contribution_ids";
import {
	buildBatteryChargeContribution,
	buildBatteryContributions,
	buildBatteryDischargeContribution,
	buildBatteryReserveContribution,
} from "./battery";
import { buildWallboxEvSessionContribution } from "./wallbox";
import { buildImmersionHeaterContributions } from "./immersion_heater";
import { buildAirConditioningContributions } from "./air_conditioning";
import { buildFlexibleContributions } from "./build";
import { evaluateParticipation, flexibleContributionsRevisionPayload } from "./types";

const NOW = new Date("2026-07-11T10:00:00.000Z");

function gridForecast(overrides: Partial<GridSupplyForecast> = {}): GridSupplyForecast {
	return {
		generatedAt: NOW.toISOString(),
		validUntil: null,
		source: "dynamic_tariff",
		currentPriceCtPerKwh: 24,
		gridImportAllowed: true,
		configuredMaxGridImportW: 11000,
		configuredHouseFuseLimitW: 13800,
		effectiveMaxGridImportW: 11000,
		slots: [],
		quality: operatorQuality("valid", "OK"),
		reasonDe: "OK",
		...overrides,
	};
}

function batteryInput(overrides: Partial<Parameters<typeof buildBatteryChargeContribution>[0]> = {}) {
	return {
		now: NOW,
		addonEnabled: true,
		governanceEnabled: true,
		globalModeOff: false,
		modePolicy: plannerModePolicyFromGlobalMode("balanced"),
		gridForecast: gridForecast(),
		profileId: "sonnen_em",
		socPct: 55,
		capacityManualKwh: 10,
		capacityMappedKwh: null,
		capacitySource: "manual",
		minSocPct: 10,
		maxSocPct: 100,
		maxChargeW: 5000,
		chargeCapable: true,
		dischargeCapable: false,
		fault: false,
		lockout: false,
		telemetryValid: true,
		telemetryStale: false,
		mappingsReady: true,
		topOffRequested: false,
		ownershipActive: false,
		winterGridActive: false,
		...overrides,
	};
}

function wallboxInput(overrides: Partial<Parameters<typeof buildWallboxEvSessionContribution>[0]> = {}) {
	return {
		now: NOW,
		addonEnabled: true,
		governanceEnabled: true,
		globalModeOff: false,
		modePolicy: plannerModePolicyFromGlobalMode("balanced"),
		gridForecast: gridForecast(),
		connected: true,
		charging: false,
		vehicleSocPct: 40,
		planSocPct: 80,
		planActive: true,
		sessionEnergyKwh: null,
		remainingEnergyKwh: null,
		vehicleCapacityKwh: null,
		deadlineIso: "2026-07-11T18:00:00.000Z",
		activePhases: 3,
		maxCurrentA: 16,
		evccConfigured: true,
		...overrides,
	};
}

function immersionConfig() {
	return immersionDeviceConfigFromAdapter({
		ih_stage_count: 1,
		ih_stage_1_set_state: "relay.0.heater",
		ih_stage_1_nominal_power_w: 2000,
		ih_buffer_temp_c_target: "sensor.0.temp",
		ih_buffer_temp_c_enabled: true,
	});
}

function immersionInput(overrides: Partial<Parameters<typeof buildImmersionHeaterContributions>[0]> = {}) {
	return {
		now: NOW,
		addonEnabled: true,
		governanceEnabled: true,
		globalModeOff: false,
		modePolicy: plannerModePolicyFromGlobalMode("balanced"),
		config: immersionConfig(),
		bufferTempC: 50,
		thermalMode: "auto" as const,
		fault: false,
		lockout: false,
		relayMapped: true,
		pvTodayKwh: 12,
		pvTomorrowKwh: 15,
		pvBiasStatus: "ready",
		forecastModeEnabled: true,
		aiOptimizationAllowed: false,
		...overrides,
	};
}

function acInput(overrides: Partial<Parameters<typeof buildAirConditioningContributions>[0]> = {}) {
	const acConfig = acGlobalConfigFromAdapter({
		ac_u1_enabled: true,
		ac_u1_on_temp_c: 26,
		ac_u1_off_temp_c: 24,
		ac_u1_estimated_power_w: 900,
	});
	return {
		now: NOW,
		addonEnabled: true,
		governanceEnabled: true,
		globalModeOff: false,
		modePolicy: plannerModePolicyFromGlobalMode("balanced"),
		acConfig,
		outdoorTempC: 32,
		units: acConfig.units.map((unit) => ({
			unit,
			roomTempC: unit.enabled ? 28 : null,
			consumerStats: undefined,
			mappingsReady: unit.enabled,
			fault: false,
			lockout: false,
			cleaningBlocked: false,
		})),
		...overrides,
	};
}

describe("flexible participation", () => {
	it("maps disabled addon", () => {
		const r = evaluateParticipation({
			addonEnabled: false,
			governanceEnabled: true,
			configured: true,
			mappingsReady: true,
			fault: false,
			lockout: false,
			globalModeOff: false,
		});
		assert.equal(r.status, "disabled");
	});

	it("maps fault to blocked", () => {
		const r = evaluateParticipation({
			addonEnabled: true,
			governanceEnabled: true,
			configured: true,
			mappingsReady: true,
			fault: true,
			lockout: false,
			globalModeOff: false,
		});
		assert.equal(r.status, "blocked");
	});

	it("maps unsupported profile capability", () => {
		const r = evaluateParticipation({
			addonEnabled: true,
			governanceEnabled: true,
			configured: true,
			mappingsReady: true,
			fault: false,
			lockout: false,
			globalModeOff: false,
			unsupported: true,
		});
		assert.equal(r.status, "unsupported");
	});
});

describe("battery contributions", () => {
	it("builds valid charge contribution", () => {
		const c = buildBatteryChargeContribution(batteryInput());
		assert.equal(c.contributionId, CONTRIBUTION_IDS.BATTERY_CHARGE);
		assert.equal(c.flow, "consume");
		assert.deepEqual(c.roles, ["storage", "demand_flex", "dispatch"]);
		assert.equal(c.enabled, true);
		assert.equal(c.details.requiredEnergyKwh, 4);
	});

	it("degrades when soc missing", () => {
		const c = buildBatteryChargeContribution(batteryInput({ socPct: null }));
		assert.equal(c.quality.status, "degraded");
		assert.equal(c.details.requiredEnergyKwh, null);
	});

	it("degrades when capacity missing", () => {
		const c = buildBatteryChargeContribution(
			batteryInput({ capacityManualKwh: null, capacityMappedKwh: null }),
		);
		assert.equal(c.quality.status, "degraded");
	});

	it("handles soc above max target as zero need", () => {
		const c = buildBatteryChargeContribution(
			batteryInput({ socPct: 98, modePolicy: plannerModePolicyFromGlobalMode("comfort") }),
		);
		assert.equal(c.details.requiredEnergyKwh, 0);
	});

	it("builds reserve constraint", () => {
		const c = buildBatteryReserveContribution(batteryInput());
		assert.equal(c.contributionId, CONTRIBUTION_IDS.BATTERY_RESERVE);
		assert.equal(c.flow, "constraint");
		assert.equal(c.details.minSocPct, 10);
	});

	it("top-off only when requested", () => {
		const off = buildBatteryChargeContribution(batteryInput({ topOffRequested: false }));
		const on = buildBatteryChargeContribution(batteryInput({ topOffRequested: true, socPct: 90 }));
		assert.equal(off.details.topOffRequested, false);
		assert.equal(on.details.targetSocPct, 100);
		assert.equal(on.details.requiredEnergyKwh, 1);
	});

	it("grid import blocked in eco without winter grid", () => {
		const c = buildBatteryChargeContribution(
			batteryInput({ modePolicy: plannerModePolicyFromGlobalMode("eco"), winterGridActive: false }),
		);
		assert.equal(c.gridEligible, false);
	});

	it("global mode off disables charge", () => {
		const c = buildBatteryChargeContribution(
			batteryInput({ globalModeOff: true, modePolicy: plannerModePolicyFromGlobalMode("off") }),
		);
		assert.equal(c.enabled, false);
	});

	it("fault blocks charge", () => {
		const c = buildBatteryChargeContribution(batteryInput({ fault: true }));
		assert.equal(c.enabled, false);
		assert.equal(c.quality.status, "blocked");
	});

	it("sonnen_em discharge is unsupported", () => {
		const c = buildBatteryDischargeContribution(batteryInput({ profileId: "sonnen_em" }));
		assert.equal(c.contributionId, CONTRIBUTION_IDS.BATTERY_DISCHARGE);
		assert.equal(c.flow, "provide");
		assert.equal(c.enabled, false);
		assert.equal(c.quality.status, "unsupported");
		assert.equal(c.slots.length, 0);
		assert.equal(c.details.passiveSelfConsumptionOnly, true);
	});

	it("returns three stable battery contributions", () => {
		const all = buildBatteryContributions(batteryInput());
		assert.equal(all.length, 3);
		const ids = all.map((c) => c.contributionId);
		assert.deepEqual(ids, [
			CONTRIBUTION_IDS.BATTERY_CHARGE,
			CONTRIBUTION_IDS.BATTERY_DISCHARGE,
			CONTRIBUTION_IDS.BATTERY_RESERVE,
		]);
	});
});

describe("wallbox contribution", () => {
	it("connected false disables active session", () => {
		const c = buildWallboxEvSessionContribution(wallboxInput({ connected: false, vehicleSocPct: 0 }));
		assert.equal(c.enabled, false);
		assert.equal(c.quality.status, "disabled");
		assert.match(c.reasonDe, /nicht verbunden/i);
		assert.equal(c.details.vehicleSocPct, 0);
	});

	it("connected with remaining energy", () => {
		const c = buildWallboxEvSessionContribution(
			wallboxInput({ remainingEnergyKwh: 18.5, vehicleSocPct: null }),
		);
		assert.equal(c.enabled, true);
		assert.equal(c.details.requiredEnergyKwh, 18.5);
	});

	it("connected with soc and vehicle capacity", () => {
		const c = buildWallboxEvSessionContribution(
			wallboxInput({ vehicleCapacityKwh: 60, vehicleSocPct: 40, planSocPct: 80 }),
		);
		assert.equal(c.details.requiredEnergyKwh, 24);
	});

	it("unknown capacity yields null energy need", () => {
		const c = buildWallboxEvSessionContribution(
			wallboxInput({ vehicleCapacityKwh: null, remainingEnergyKwh: null }),
		);
		assert.equal(c.details.requiredEnergyKwh, null);
	});

	it("missing soc with remaining energy stays valid", () => {
		const c = buildWallboxEvSessionContribution(
			wallboxInput({ vehicleSocPct: null, remainingEnergyKwh: 5 }),
		);
		assert.equal(c.enabled, true);
		assert.equal(c.quality.status, "valid");
	});

	it("preserves deadline when present", () => {
		const c = buildWallboxEvSessionContribution(
			wallboxInput({ deadlineIso: "2026-07-11T20:00:00.000Z" }),
		);
		assert.equal(c.deadlineIso, "2026-07-11T20:00:00.000Z");
	});

	it("null deadline when absent", () => {
		const c = buildWallboxEvSessionContribution(wallboxInput({ deadlineIso: null }));
		assert.equal(c.deadlineIso, null);
	});

	it("grid import blocked", () => {
		const c = buildWallboxEvSessionContribution(
			wallboxInput({ gridForecast: gridForecast({ gridImportAllowed: false }) }),
		);
		assert.equal(c.gridEligible, false);
	});

	it("marks runtime read-only", () => {
		const c = buildWallboxEvSessionContribution(wallboxInput());
		assert.equal(c.details.runtimeControlAvailable, false);
	});
});

describe("immersion heater contributions", () => {
	it("mandatory below planning min temp", () => {
		const [mandatory] = buildImmersionHeaterContributions(
			immersionInput({ bufferTempC: 45, thermalMode: "auto" }),
		);
		assert.equal(mandatory.contributionId, CONTRIBUTION_IDS.IMMERSION_MANDATORY);
		assert.equal(mandatory.enabled, true);
		assert.equal(mandatory.details.mandatory, true);
	});

	it("flexible demand in auto mode", () => {
		const [, flexible] = buildImmersionHeaterContributions(immersionInput());
		assert.equal(flexible.contributionId, CONTRIBUTION_IDS.IMMERSION_FLEXIBLE);
		assert.equal(flexible.flexible, true);
		assert.equal(flexible.gridEligible, false);
	});

	it("no flexible demand when target reached", () => {
		const [, flexible] = buildImmersionHeaterContributions(
			immersionInput({ bufferTempC: 62 }),
		);
		assert.equal(flexible.enabled, false);
	});

	it("blocks on fault", () => {
		const [, flexible] = buildImmersionHeaterContributions(immersionInput({ fault: true }));
		assert.equal(flexible.enabled, false);
		assert.equal(flexible.quality.status, "blocked");
	});

	it("blocks on missing mapping", () => {
		const [, flexible] = buildImmersionHeaterContributions(immersionInput({ relayMapped: false }));
		assert.equal(flexible.enabled, false);
		assert.equal(flexible.quality.status, "missing");
	});

	it("governance off disables flexible", () => {
		const [, flexible] = buildImmersionHeaterContributions(
			immersionInput({ governanceEnabled: false }),
		);
		assert.equal(flexible.enabled, false);
	});
});

describe("air conditioning contributions", () => {
	it("creates five unit contributions", () => {
		const all = buildAirConditioningContributions(acInput());
		assert.equal(all.length, AC_UNIT_COUNT);
		assert.equal(all[0].contributionId, "air_conditioning.unit_1");
		assert.equal(all[4].contributionId, "air_conditioning.unit_5");
	});

	it("excludes disabled unit", () => {
		const all = buildAirConditioningContributions(
			acInput({
				acConfig: acGlobalConfigFromAdapter({ ac_u2_enabled: false }),
			}),
		);
		const unit2 = all.find((c) => c.contributionId === "air_conditioning.unit_2");
		assert.equal(unit2?.enabled, false);
	});

	it("unit with cooling demand enabled", () => {
		const all = buildAirConditioningContributions(acInput());
		const unit1 = all.find((c) => c.contributionId === "air_conditioning.unit_1");
		assert.equal(unit1?.flow, "consume");
		assert.ok(unit1?.details.expectedKwhToday !== undefined);
	});

	it("degrades when room temp missing", () => {
		const input = acInput();
		input.units[0].roomTempC = null;
		const unit1 = buildAirConditioningContributions(input).find(
			(c) => c.contributionId === "air_conditioning.unit_1",
		);
		assert.equal(unit1?.quality.status, "degraded");
	});

	it("governance off excludes active units", () => {
		const all = buildAirConditioningContributions(acInput({ governanceEnabled: false }));
		assert.ok(all.every((c) => !c.enabled));
	});

	it("documents runtime governance gap", () => {
		const unit1 = buildAirConditioningContributions(acInput()).find(
			(c) => c.contributionId === "air_conditioning.unit_1",
		);
		assert.equal(unit1?.details.runtimeGovernanceGap, true);
	});
});

describe("flexible build orchestration", () => {
	it("produces unique contribution ids", () => {
		const all = buildFlexibleContributions({
			battery: batteryInput(),
			wallbox: wallboxInput(),
			immersion: immersionInput(),
			airConditioning: acInput(),
		});
		const ids = all.map((c) => c.contributionId);
		assert.equal(new Set(ids).size, ids.length);
	});

	it("revision payload ignores generatedAt", () => {
		const input = {
			battery: batteryInput(),
			wallbox: wallboxInput(),
			immersion: immersionInput(),
			airConditioning: acInput(),
		};
		const a = buildFlexibleContributions(input);
		const contributionsWithNewTimestamp = buildFlexibleContributions(input).map((c) => ({
			...c,
			generatedAt: new Date("2026-07-11T10:05:00.000Z").toISOString(),
		}));
		assert.equal(
			flexibleContributionsRevisionPayload(a),
			flexibleContributionsRevisionPayload(contributionsWithNewTimestamp),
		);
	});
});
