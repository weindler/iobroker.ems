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
		addonExecutionOff: false,
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
		deficitChargeActive: false,
		...overrides,
	};
}

function wallboxInput(overrides: Partial<Parameters<typeof buildWallboxEvSessionContribution>[0]> = {}) {
	return {
		now: NOW,
		addonEnabled: true,
		governanceEnabled: true,
		globalModeOff: false,
		addonExecutionOff: false,
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
		addonExecutionOff: false,
		modePolicy: plannerModePolicyFromGlobalMode("balanced"),
		config: immersionConfig(),
		bufferTempC: 50,
		boilerTempC: 58,
		boilerSensorDegraded: false,
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
		addonExecutionOff: false,
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
	it("skips EMS charge slots when today's PV surplus covers the SOC gap", () => {
		const c = buildBatteryChargeContribution(
			batteryInput({
				socPct: 55,
				capacityManualKwh: 10,
				todayPvSurplusKwh: 12,
			}),
		);
		// balanced target 95% → 4 kWh gap; surplus 12 ≥ 4
		assert.equal(c.details.pvCoversChargeNeed, true);
		assert.equal(c.details.requiredEnergyKwh, 0);
		assert.equal(c.details.socGapEnergyKwh, 4);
		assert.equal(c.slots.length, 0);
		assert.match(c.reasonDe, /keine EMS-Lade-Slots/);
	});

	it("keeps charge slots when top-off requested despite PV surplus", () => {
		const c = buildBatteryChargeContribution(
			batteryInput({
				socPct: 90,
				topOffRequested: true,
				todayPvSurplusKwh: 50,
			}),
		);
		assert.equal(c.details.pvCoversChargeNeed, false);
		assert.ok((c.details.requiredEnergyKwh as number) > 0);
		assert.equal(c.slots.length, 1);
	});

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
		assert.equal(c.details.batteryLearningStatus, "missing");
	});

	it("reserve exposes learned night discharge and marks top-off target when due", () => {
		const c = buildBatteryReserveContribution(
			batteryInput({
				batteryLearning: {
					status: "valid",
					sampleDays: 40,
					avgNightDischargeKwh: 2.4,
					avgChargePowerW: 2600,
					maxChargePowerW: 3000,
					topoffDue: true,
					topoffDaysRemaining: -3,
					estimatedRuntimeDays: 5,
					reasonDe: "Top-Off fällig",
				},
			}),
		);
		assert.equal(c.details.avgNightDischargeKwh, 2.4);
		assert.equal(c.details.topOffTargetSocPct, 100);
	});

	it("top-off only when requested", () => {
		const off = buildBatteryChargeContribution(batteryInput({ topOffRequested: false }));
		const on = buildBatteryChargeContribution(batteryInput({ topOffRequested: true, socPct: 90 }));
		assert.equal(off.details.topOffRequested, false);
		assert.equal(on.details.targetSocPct, 100);
		assert.equal(on.details.requiredEnergyKwh, 1);
	});

	it("keeps policy target when learning is missing (unchanged behavior)", () => {
		const c = buildBatteryChargeContribution(batteryInput());
		assert.equal(c.details.targetSocPct, plannerModePolicyFromGlobalMode("balanced").chargeTargetSocPct);
		assert.equal(c.details.batteryLearningStatus, "missing");
	});

	it("ignores a degraded learning model for top-off (not belastbar enough)", () => {
		const c = buildBatteryChargeContribution(
			batteryInput({
				batteryLearning: {
					status: "degraded",
					sampleDays: 3,
					avgNightDischargeKwh: 2.4,
					avgChargePowerW: 2600,
					maxChargePowerW: 3000,
					topoffDue: true,
					topoffDaysRemaining: -2,
					estimatedRuntimeDays: 5,
					reasonDe: "wenig Historie",
				},
			}),
		);
		assert.equal(c.details.targetSocPct, plannerModePolicyFromGlobalMode("balanced").chargeTargetSocPct);
	});

	it("raises target to 100% when the learned top-off interval is due", () => {
		const c = buildBatteryChargeContribution(
			batteryInput({
				socPct: 85,
				batteryLearning: {
					status: "valid",
					sampleDays: 40,
					avgNightDischargeKwh: 2.4,
					avgChargePowerW: 2600,
					maxChargePowerW: 3000,
					topoffDue: true,
					topoffDaysRemaining: -3,
					estimatedRuntimeDays: 5,
					reasonDe: "Top-Off fällig",
				},
			}),
		);
		assert.equal(c.details.targetSocPct, 100);
		assert.equal(c.details.topoffDueLearned, true);
		assert.equal(c.details.avgNightDischargeKwh, 2.4);
		assert.match(c.reasonDe, /Top-Off/);
	});

	it("uses dynamic end-SOC from night need when top-off is not due (not policy 95%)", () => {
		const c = buildBatteryChargeContribution(
			batteryInput({
				socPct: 85,
				batteryLearning: {
					status: "valid",
					sampleDays: 40,
					avgNightDischargeKwh: 2.4,
					avgChargePowerW: 2600,
					maxChargePowerW: 3000,
					topoffDue: false,
					topoffDaysRemaining: 10,
					estimatedRuntimeDays: 5,
					reasonDe: "nicht fällig",
				},
				chargeLogic: {
					active: false,
					forecastActive: true,
					horizonDays: 2,
					bridgeUntilIso: null,
					pvRecoveryDay: 1,
					energyStoredKwh: 8.5,
					energyDeficitKwh: 0,
					energyReserveKwh: 0.5,
					energyTargetKwh: 8.5,
					socTargetPct: 85,
					chargeEnergyKwh: null,
					confidenceMinPct: 85,
					reasonDe: "kein Defizit",
				},
			}),
		);
		assert.ok(
			(c.details.targetSocPct as number) < plannerModePolicyFromGlobalMode("balanced").chargeTargetSocPct,
		);
		assert.ok((c.details.targetSocPct as number) < 50);
		assert.equal(c.details.endSocDynamic, true);
	});

	it("grid import blocked in eco without active PV-deficit charge logic", () => {
		const c = buildBatteryChargeContribution(
			batteryInput({ modePolicy: plannerModePolicyFromGlobalMode("eco"), deficitChargeActive: false }),
		);
		assert.equal(c.gridEligible, false);
	});

	it("grid import allowed in eco when PV-deficit charge logic is active", () => {
		const c = buildBatteryChargeContribution(
			batteryInput({ modePolicy: plannerModePolicyFromGlobalMode("eco"), deficitChargeActive: true }),
		);
		assert.equal(c.gridEligible, true);
	});

	it("raises target SOC above the eco policy target and sets a deadline when the PV-deficit charge logic is active", () => {
		const c = buildBatteryChargeContribution(
			batteryInput({
				socPct: 55,
				modePolicy: plannerModePolicyFromGlobalMode("eco"),
				deficitChargeActive: true,
				chargeLogic: {
					active: true,
					forecastActive: true,
					horizonDays: 4,
					bridgeUntilIso: "2026-07-15T22:00:00.000Z",
					pvRecoveryDay: 4,
					energyStoredKwh: 5.5,
					energyDeficitKwh: 3,
					energyReserveKwh: 0.5,
					energyTargetKwh: 9.6,
					socTargetPct: 96,
					chargeEnergyKwh: 4.1,
					confidenceMinPct: 60,
					reasonDe: "PV-Defizit-Horizont 4 Tag(e); Netz-Ziel +4.1 kWh.",
				},
			}),
		);
		assert.equal(c.details.targetSocPct, 96);
		assert.equal(c.deadlineIso, "2026-07-15T22:00:00.000Z");
		assert.equal(c.details.chargeLogicActive, true);
		assert.equal(c.gridEligible, true);
		assert.match(c.reasonDe, /PV-Defizit-Ladelogik/);
	});

	it("does not raise target or set deadline when charge logic is inactive", () => {
		const c = buildBatteryChargeContribution(
			batteryInput({
				socPct: 55,
				chargeLogic: {
					active: false,
					forecastActive: true,
					horizonDays: 7,
					bridgeUntilIso: null,
					pvRecoveryDay: 1,
					energyStoredKwh: 8,
					energyDeficitKwh: 0,
					energyReserveKwh: 0,
					energyTargetKwh: 8,
					socTargetPct: null,
					chargeEnergyKwh: null,
					confidenceMinPct: 90,
					reasonDe: "kein Netzladen nötig",
				},
			}),
		);
		assert.equal(c.details.targetSocPct, plannerModePolicyFromGlobalMode("balanced").chargeTargetSocPct);
		assert.equal(c.deadlineIso, null);
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

	it("prefers remaining energy without capacity", () => {
		const c = buildWallboxEvSessionContribution(
			wallboxInput({
				remainingEnergyKwh: 9.2,
				vehicleCapacityKwh: null,
				vehicleSocPct: null,
				planActive: false,
				planSocPct: 0,
			}),
		);
		assert.equal(c.details.requiredEnergyKwh, 9.2);
		assert.equal(c.quality.status, "valid");
	});

	it("connected with soc and vehicle capacity", () => {
		const c = buildWallboxEvSessionContribution(
			wallboxInput({ vehicleCapacityKwh: 60, vehicleSocPct: 40, planSocPct: 80 }),
		);
		assert.equal(c.details.requiredEnergyKwh, 24);
	});

	it("ignores planSoc 0 when plan inactive", () => {
		const c = buildWallboxEvSessionContribution(
			wallboxInput({
				vehicleCapacityKwh: 60,
				vehicleSocPct: 40,
				planSocPct: 0,
				planActive: false,
				remainingEnergyKwh: null,
			}),
		);
		assert.equal(c.details.requiredEnergyKwh, null);
		assert.match(c.reasonDe, /Ladeziel|Restenergie|Kapazität/i);
	});

	it("uses effectiveLimitSoc fallback when plan inactive", () => {
		const c = buildWallboxEvSessionContribution(
			wallboxInput({
				vehicleCapacityKwh: 50,
				vehicleSocPct: 40,
				planSocPct: 0,
				planActive: false,
				effectiveLimitSocPct: 80,
				remainingEnergyKwh: null,
			}),
		);
		assert.equal(c.details.requiredEnergyKwh, 20);
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
	it("mandatory below boiler min includes energy slot (not buffer alone)", () => {
		const [mandatory] = buildImmersionHeaterContributions(
			immersionInput({ bufferTempC: 55, boilerTempC: 45, thermalMode: "auto" }),
		);
		assert.equal(mandatory.contributionId, CONTRIBUTION_IDS.IMMERSION_MANDATORY);
		assert.equal(mandatory.enabled, true);
		assert.equal(mandatory.details.mandatory, true);
		assert.ok((mandatory.details.requiredEnergyKwh as number) > 0);
		assert.equal(mandatory.slots.length, 1);
		assert.equal(mandatory.slots[0].mandatory, true);
	});

	it("cold buffer alone does not create mandatory hard demand", () => {
		const [mandatory] = buildImmersionHeaterContributions(
			immersionInput({ bufferTempC: 40, boilerTempC: 58, thermalMode: "auto" }),
		);
		assert.equal(mandatory.enabled, false);
	});

	it("flexible demand in auto mode", () => {
		const [, flexible] = buildImmersionHeaterContributions(immersionInput());
		assert.equal(flexible.contributionId, CONTRIBUTION_IDS.IMMERSION_FLEXIBLE);
		assert.equal(flexible.flexible, true);
		assert.equal(flexible.gridEligible, false);
		assert.ok(typeof flexible.details.requiredEnergyKwh === "number");
		assert.ok((flexible.details.requiredEnergyKwh as number) > 0);
		assert.equal(flexible.slots.length, 1);
		assert.equal(flexible.slots[0].maxPowerW, 2000);
	});

	it("no flexible demand when target reached", () => {
		const [, flexible] = buildImmersionHeaterContributions(
			immersionInput({ bufferTempC: 62 }),
		);
		assert.equal(flexible.enabled, false);
	});

	it("keeps strategic headroom while reheat hysteresis is runtime-active", () => {
		const [, flexible] = buildImmersionHeaterContributions(
			immersionInput({
				/** Soft-Ziel liegt knapp über Ist → Hysterese greift bei autoTargetReached. */
				bufferTempC: 56,
				autoTargetReached: true,
				config: immersionDeviceConfigFromAdapter({
					ih_stage_count: 1,
					ih_stage_1_set_state: "relay.0.heater",
					ih_stage_1_nominal_power_w: 2000,
					ih_buffer_temp_c_target: "sensor.0.temp",
					ih_buffer_temp_c_enabled: true,
					ih_temperature_hysteresis_k: 5,
					ih_planning_min_temp_c: 44,
					ih_planning_max_temp_c: 63,
				}),
			}),
		);
		assert.equal(flexible.enabled, true);
		assert.equal(flexible.slots.length, 1);
		assert.ok((flexible.details.requiredEnergyKwh as number) > 0);
		assert.equal(flexible.details.reheatHysteresisActive, true);
		assert.equal(flexible.details.reheatHysteresisRuntimeOnly, true);
		assert.match(flexible.reasonDe, /Runtime-Hysterese/);
	});

	it("flexible demand returns after cooling below hysteresis band", () => {
		const [, flexible] = buildImmersionHeaterContributions(
			immersionInput({
				bufferTempC: 46,
				autoTargetReached: true,
				config: immersionDeviceConfigFromAdapter({
					ih_stage_count: 1,
					ih_stage_1_set_state: "relay.0.heater",
					ih_stage_1_nominal_power_w: 2000,
					ih_buffer_temp_c_target: "sensor.0.temp",
					ih_buffer_temp_c_enabled: true,
					ih_temperature_hysteresis_k: 5,
					ih_planning_min_temp_c: 44,
					ih_planning_max_temp_c: 63,
				}),
			}),
		);
		assert.equal(flexible.enabled, true);
		assert.equal(flexible.slots.length, 1);
		assert.equal(flexible.details.reheatHysteresisActive, false);
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

	it("has no deadline without thermal-runtime learning (unchanged behavior)", () => {
		const [, flexible] = buildImmersionHeaterContributions(immersionInput());
		assert.equal(flexible.deadlineIso, null);
	});

	it("buffer empty_at is ignored — no flexible Hard-Deadline, no Daily-Plan degrade", () => {
		const [, flexible] = buildImmersionHeaterContributions(
			immersionInput({
				bufferTempC: 49,
				thermalLearning: {
					status: "degraded",
					health: "degraded",
					samples: 0,
					coolingRateCPerHAvg: 1.1,
					coolingConstantPerH: null,
					coolingAsymptoteC: null,
					estimatedRemainingHours: 4,
					estimatedEmptyAt: "2026-07-26T14:00:00.000Z",
					currentDayTypeRuntimeHoursMedian: null,
					reasonDe: "wenige Zyklen",
				},
			}),
		);
		assert.equal(flexible.enabled, true);
		assert.equal(flexible.deadlineIso, null);
		assert.equal(flexible.details.bufferEstimatedEmptyAt, null);
		assert.equal(flexible.details.emptyAtPlanningUsable, false);
		assert.equal(flexible.quality.status, "valid");
		assert.equal(flexible.details.thermalLearningStatus, "missing");
		assert.equal(flexible.details.bufferLearningModel, "unused");
	});

	it("A1: Newton buffer empty_at is unused; Daily Plan does not degrade", () => {
		const [, flexible] = buildImmersionHeaterContributions(
			immersionInput({
				bufferTempC: 49,
				thermalLearning: {
					status: "degraded",
					health: "degraded",
					samples: 0,
					coolingRateCPerHAvg: null,
					coolingConstantPerH: 0.09,
					coolingAsymptoteC: 40,
					estimatedRemainingHours: 4,
					estimatedEmptyAt: "2026-07-26T14:00:00.000Z",
					currentDayTypeRuntimeHoursMedian: null,
					reasonDe: "Newton ohne Zyklen",
				},
			}),
		);
		assert.equal(flexible.enabled, true);
		assert.equal(flexible.deadlineIso, null);
		assert.equal(flexible.details.bufferEstimatedEmptyAt, null);
		assert.equal(flexible.details.thermalLearningModel, "none");
		assert.equal(flexible.details.bufferLearningModel, "unused");
		assert.equal(flexible.details.hardThermalSource, "boiler");
		assert.equal(flexible.details.softThermalSource, "buffer_cap");
		assert.equal(flexible.quality.status, "valid");
		assert.equal(flexible.details.thermalLearningStatus, "missing");
		assert.equal(flexible.details.thermalLearningDegradedCauseDe, null);
	});

	it("boiler empty_at usable sets Hard-Deadline fields; flexible deadline stays null", () => {
		const [, flexible] = buildImmersionHeaterContributions(
			immersionInput({
				bufferTempC: 49,
				boilerLearning: {
					status: "valid",
					health: "ok",
					samples: 12,
					coolingRateCPerHAvg: 1.1,
					coolingConstantPerH: 0.04,
					coolingAsymptoteC: 18,
					estimatedRemainingHours: 4,
					estimatedEmptyAt: "2026-07-26T14:00:00.000Z",
					currentDayTypeRuntimeHoursMedian: 12,
					reasonDe: "belastbares Boiler-Modell",
				},
				thermalLearning: {
					status: "valid",
					health: "ok",
					samples: 12,
					coolingRateCPerHAvg: 1.1,
					coolingConstantPerH: 0.04,
					coolingAsymptoteC: 18,
					estimatedRemainingHours: 4,
					estimatedEmptyAt: "2026-07-26T18:00:00.000Z",
					currentDayTypeRuntimeHoursMedian: 12,
					reasonDe: "Puffer-Modell",
				},
			}),
		);
		assert.equal(flexible.deadlineIso, null);
		assert.equal(flexible.details.boilerEstimatedEmptyAt, "2026-07-26T14:00:00.000Z");
		assert.equal(flexible.details.estimatedEmptyAt, "2026-07-26T14:00:00.000Z");
		assert.equal(flexible.details.emptyAtSource, "learned");
		assert.equal(flexible.details.emptyAtPlanningUsable, true);
		assert.equal(flexible.details.bufferEstimatedEmptyAt, null);
	});

	it("soft preload remains without Hard-Deadline when buffer learning valid", () => {
		const [, flexible] = buildImmersionHeaterContributions(
			immersionInput({
				bufferTempC: 52,
				thermalLearning: {
					status: "valid",
					health: "ok",
					samples: 12,
					coolingRateCPerHAvg: 1.1,
					coolingConstantPerH: 0.04,
					coolingAsymptoteC: 18,
					estimatedRemainingHours: 8,
					estimatedEmptyAt: "2026-07-26T14:00:00.000Z",
					currentDayTypeRuntimeHoursMedian: 12,
					reasonDe: "belastbares Modell",
				},
			}),
		);
		assert.equal(flexible.enabled, true);
		assert.equal(flexible.deadlineIso, null);
		assert.equal(flexible.details.bufferEstimatedEmptyAt, null);
	});

	it("boiler Newton without cycles is not Hard-usable and does not degrade Daily Plan", () => {
		const [, flexible] = buildImmersionHeaterContributions(
			immersionInput({
				bufferTempC: 49,
				boilerLearning: {
					status: "degraded",
					health: "degraded",
					samples: 0,
					coolingRateCPerHAvg: null,
					coolingConstantPerH: 0.09,
					coolingAsymptoteC: 40,
					estimatedRemainingHours: 18,
					estimatedEmptyAt: "2026-07-26T08:46:00.000Z",
					currentDayTypeRuntimeHoursMedian: null,
					reasonDe: "Newton-Fallback",
				},
			}),
		);
		assert.equal(flexible.enabled, true);
		assert.equal(flexible.deadlineIso, null);
		assert.equal(flexible.quality.status, "valid");
		assert.equal(flexible.details.thermalLearningStatus, "missing");
		assert.equal(flexible.details.thermalLearningDegradedCauseDe, null);
		assert.equal(flexible.details.boilerLearningModel, "newton");
		assert.equal(flexible.details.emptyAtPlanningUsable, false);
		assert.equal(flexible.details.boilerEstimatedEmptyAt, null);
	});

	it("night bridge raises soft target from boiler cycles; no Hard-Deadline", () => {
		const now = new Date("2026-08-04T12:00:00.000Z"); // 14:00 CEST
		const [, flexible] = buildImmersionHeaterContributions(
			immersionInput({
				now,
				bufferTempC: 47,
				boilerTempC: 47,
				timezone: "Europe/Berlin",
				config: immersionDeviceConfigFromAdapter({
					ih_stage_count: 1,
					ih_stage_1_set_state: "relay.0.heater",
					ih_stage_1_nominal_power_w: 2000,
					ih_buffer_temp_c_target: "sensor.0.temp",
					ih_buffer_temp_c_enabled: true,
					ih_planning_min_temp_c: 44,
					ih_planning_max_temp_c: 63,
					ih_boiler_min_temp_c: 50,
				}),
				boilerLearning: {
					status: "valid",
					health: "ok",
					samples: 12,
					coolingRateCPerHAvg: 1.0,
					coolingConstantPerH: 0.04,
					coolingAsymptoteC: 18,
					estimatedRemainingHours: 3.5,
					estimatedEmptyAt: "2026-08-04T18:26:00.000Z",
					currentDayTypeRuntimeHoursMedian: 12,
					reasonDe: "belastbares Boiler-Modell",
				},
			}),
		);
		assert.equal(flexible.enabled, true);
		assert.equal(flexible.deadlineIso, null);
		assert.equal(flexible.details.nightBridgeActive, true);
		assert.ok((flexible.details.targetTempC as number) > 51.6);
		assert.ok((flexible.details.requiredEnergyKwh as number) > 1);
		assert.match(flexible.reasonDe, /Nachtbrücke/);
	});

	it("does not set a deadline when the flexible contribution is disabled anyway", () => {
		const [, flexible] = buildImmersionHeaterContributions(
			immersionInput({
				bufferTempC: 62,
				thermalLearning: {
					status: "valid",
					health: "ok",
					samples: 12,
					coolingRateCPerHAvg: 1.1,
					coolingConstantPerH: 0.04,
					coolingAsymptoteC: 18,
					estimatedRemainingHours: 4,
					estimatedEmptyAt: "2026-07-26T14:00:00.000Z",
					currentDayTypeRuntimeHoursMedian: 12,
					reasonDe: "belastbares Modell",
				},
			}),
		);
		assert.equal(flexible.enabled, false);
		assert.equal(flexible.deadlineIso, null);
	});

	it("exposes missing learning status in details when no thermal-runtime signal is supplied", () => {
		const [mandatory, flexible] = buildImmersionHeaterContributions(immersionInput());
		assert.equal(mandatory.details.thermalLearningStatus, "missing");
		assert.equal(flexible.details.thermalLearningStatus, "missing");
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
		assert.ok((unit1?.details.requiredEnergyKwh as number) > 0);
		assert.equal(unit1?.details.timeAllocation, false);
		assert.equal(unit1?.slots.length, 0);
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

	it("runtime no longer documents governance gap after v0.1.130", () => {
		const unit1 = buildAirConditioningContributions(acInput()).find(
			(c) => c.contributionId === "air_conditioning.unit_1",
		);
		assert.equal(unit1?.details.runtimeGovernanceGap, undefined);
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
