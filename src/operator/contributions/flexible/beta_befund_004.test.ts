/**
 * Beta-Befund 004: dynamisches Batterie-Endziel + thermische PV-Vorladung.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plannerModePolicyFromGlobalMode } from "../../../planner/mode_policy";
import { planDynamicBatteryEndSoc } from "./battery_end_soc";
import { planBatteryChargeLogic } from "./battery_charge_logic";
import { buildBatteryChargeContribution } from "./battery";
import { resolveThermalPvPrecharge } from "./thermal_pv_precharge";
import { buildImmersionFlexibleContribution } from "./immersion_heater";
import { immersionDeviceConfigFromAdapter } from "../../../addons/immersion_heater/device_config";
import { allocateUnifiedDayPlan } from "../../daily_plan/unified/allocate";
import { golden001Input } from "../../daily_plan/unified/fixtures";
import { operatorQuality } from "../../quality";
import type { GridSupplyForecast } from "../../types";
import type { BatteryContributionBuildInput } from "./battery";
import type { ThermalLearningSignal } from "./thermal_learning";

const NOW = new Date("2026-08-08T12:00:00.000Z");

function gridForecast(): GridSupplyForecast {
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
	};
}

function batBase(overrides: Partial<BatteryContributionBuildInput> = {}): BatteryContributionBuildInput {
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

function ihConfig(maxTempC = 60) {
	return immersionDeviceConfigFromAdapter({
		ih_stage_count: 1,
		ih_stage_1_enabled: true,
		ih_stage_1_nominal_power_w: 1700,
		ih_stage_1_set_state: "virtual.relay",
		ih_planning_min_temp_c: 48,
		ih_planning_max_temp_c: maxTempC,
		ih_forecast_mode_enabled: true,
		ih_forecast_target_fraction_moderate: 0.3,
	});
}

function thermalOk(emptyAt: string): ThermalLearningSignal {
	return {
		status: "valid",
		health: "ok",
		samples: 40,
		coolingRateCPerHAvg: 0.4,
		coolingConstantPerH: null,
		coolingAsymptoteC: null,
		estimatedRemainingHours: 5.7,
		estimatedEmptyAt: emptyAt,
		currentDayTypeRuntimeHoursMedian: 8,
		reasonDe: "ok",
	};
}

describe("Beta-Befund 004 A — guter Morgen-PV → Endziel <100 %", () => {
	it("Nachtbedarf 2.5 kWh + Recovery Tag 1 → Ziel deutlich unter 100", () => {
		const logic = planBatteryChargeLogic({
			now: NOW,
			socPct: 100,
			snowCoverSuspected: false,
			governanceEnabled: true,
			modePolicy: plannerModePolicyFromGlobalMode("balanced"),
			config: {
				enabled: true,
				horizonDays: 3,
				marginKwh: 0.5,
				pvRecoveryRatio: 1.15,
				reserveLowConfidenceFactor: 0.5,
				maxSocPct: 100,
				minSocPct: 10,
				capacityKwh: 10,
			},
			days: [
				{ dayIndex: 0, dateKey: "2026-08-08", pvKwh: 25, loadKwh: 12, pvConfidencePct: 85 },
				{ dayIndex: 1, dateKey: "2026-08-09", pvKwh: 22, loadKwh: 11, pvConfidencePct: 80 },
			],
		});
		assert.equal(logic.active, false);
		const dyn = planDynamicBatteryEndSoc({
			capacityKwh: 10,
			socPct: 100,
			minSocPct: 10,
			maxSocPct: 100,
			modePolicy: plannerModePolicyFromGlobalMode("balanced"),
			avgNightDischargeKwh: 2.5,
			chargeLogic: logic,
		});
		assert.ok(dyn.socTargetPct < 100);
		assert.ok(dyn.socTargetPct < 60, `expected dynamic end SOC <60, got ${dyn.socTargetPct}`);
		assert.ok(dyn.energyTargetKwh >= 2.5);
		assert.equal(dyn.usedPolicyFallback, false);
	});
});

describe("Beta-Befund 004 B — schlechter Morgen-PV → höheres Ziel", () => {
	it("Defizit bis Recovery angehoben", () => {
		const good = planDynamicBatteryEndSoc({
			capacityKwh: 10,
			socPct: 40,
			minSocPct: 10,
			maxSocPct: 100,
			modePolicy: plannerModePolicyFromGlobalMode("balanced"),
			avgNightDischargeKwh: 2.5,
			chargeLogic: {
				active: false,
				forecastActive: true,
				horizonDays: 1,
				bridgeUntilIso: null,
				pvRecoveryDay: 1,
				energyStoredKwh: 4,
				energyDeficitKwh: 0,
				energyReserveKwh: 0.5,
				energyTargetKwh: 4,
				socTargetPct: 40,
				chargeEnergyKwh: null,
				confidenceMinPct: 85,
				reasonDe: "ok",
			},
		});
		const bad = planDynamicBatteryEndSoc({
			capacityKwh: 10,
			socPct: 40,
			minSocPct: 10,
			maxSocPct: 100,
			modePolicy: plannerModePolicyFromGlobalMode("balanced"),
			avgNightDischargeKwh: 2.5,
			chargeLogic: {
				active: true,
				forecastActive: true,
				horizonDays: 3,
				bridgeUntilIso: "2026-08-10T22:00:00.000Z",
				pvRecoveryDay: 3,
				energyStoredKwh: 4,
				energyDeficitKwh: 5,
				energyReserveKwh: 1,
				energyTargetKwh: 10,
				socTargetPct: 100,
				chargeEnergyKwh: 6,
				confidenceMinPct: 40,
				reasonDe: "defizit",
			},
		});
		assert.ok(bad.socTargetPct > good.socTargetPct);
		assert.ok(bad.socTargetPct >= 90);
	});
});

describe("Beta-Befund 004 C — Top-off → 100 %", () => {
	it("topoff fällig erzwingt 100", () => {
		const c = buildBatteryChargeContribution(
			batBase({
				socPct: 70,
				topOffRequested: true,
				batteryLearning: {
					status: "valid",
					sampleDays: 40,
					avgNightDischargeKwh: 2.5,
					avgChargePowerW: 2600,
					maxChargePowerW: 3000,
					topoffDue: false,
					topoffDaysRemaining: 5,
					estimatedRuntimeDays: 4,
					reasonDe: "ok",
				},
			}),
		);
		assert.equal(c.details.targetSocPct, 100);
	});
});

describe("Beta-Befund 004 D — Thermal PV-Vorladung bei emptyAt heute", () => {
	it("starke PV + Batterie satt → Ziel deutlich über 51.6 Richtung Max 63", () => {
		const pre = resolveThermalPvPrecharge({
			now: new Date("2026-08-08T12:00:00.000Z"),
			bufferTempC: 47,
			planningMinTempC: 48,
			planningMaxTempC: 63,
			baseTargetTempC: 51.6,
			coolingRateCPerHAvg: 0.35,
			estimatedEmptyAtIso: "2026-08-08T15:44:00.000Z",
			nextPvHeatOpportunityIso: "2026-08-09T08:00:00.000Z",
			pvTodayKwh: 28,
			pvTomorrowKwh: 24,
			todayPvSurplusKwh: 12,
			batterySocPct: 100,
			batteryEndSocTargetPct: 40,
			vehicleUrgentEnergyKwh: null,
			exportTariffCtPerKwh: 8,
			importTariffCtPerKwh: 32,
			futureElectricalFlexHintKwh: 4,
			globalMode: "balanced",
		});
		assert.equal(pre.active, true);
		assert.ok(pre.targetTempC > 51.6 + 3, `got ${pre.targetTempC}`);
		assert.ok(pre.targetTempC <= 63);
		assert.ok(pre.targetTempC >= 56, `flex storage should push well above 51.6, got ${pre.targetTempC}`);
	});
});

describe("Beta-Befund 004 E — EV dringend → weniger Thermal-Extra", () => {
	it("vehicle urgent + knapper Surplus → keine Extra-Vorladung", () => {
		const pre = resolveThermalPvPrecharge({
			now: new Date("2026-08-08T12:00:00.000Z"),
			bufferTempC: 47,
			planningMinTempC: 48,
			planningMaxTempC: 60,
			baseTargetTempC: 51.6,
			coolingRateCPerHAvg: 0.35,
			estimatedEmptyAtIso: "2026-08-08T15:44:00.000Z",
			nextPvHeatOpportunityIso: "2026-08-09T08:00:00.000Z",
			pvTodayKwh: 10,
			pvTomorrowKwh: 8,
			todayPvSurplusKwh: 3,
			batterySocPct: 50,
			batteryEndSocTargetPct: 80,
			vehicleUrgentEnergyKwh: 12,
			exportTariffCtPerKwh: 8,
			globalMode: "balanced",
		});
		assert.equal(pre.active, false);
	});
});

describe("Beta-Befund 004 F — Batterie satt + Thermal-Defizit", () => {
	it("Immersion contribution raises target with PV precharge", () => {
		const c = buildImmersionFlexibleContribution({
			now: new Date("2026-08-08T12:00:00.000Z"),
			addonEnabled: true,
			governanceEnabled: true,
			globalModeOff: false,
			addonExecutionOff: false,
			modePolicy: plannerModePolicyFromGlobalMode("balanced"),
			config: ihConfig(),
			bufferTempC: 47,
			thermalMode: "auto",
			fault: false,
			lockout: false,
			relayMapped: true,
			pvTodayKwh: 30,
			pvTomorrowKwh: 26,
			pvBiasStatus: "valid",
			forecastModeEnabled: true,
			aiOptimizationAllowed: false,
			thermalLearning: thermalOk("2026-08-08T15:44:00.000Z"),
			todayPvSurplusKwh: 12,
			batterySocPct: 100,
			batteryEndSocTargetPct: 35,
			vehicleUrgentEnergyKwh: null,
			timezone: "Europe/Berlin",
		});
		const target = c.details.targetTempC as number;
		assert.ok(target > 51.6, `target=${target}`);
		assert.equal(c.details.pvPrechargeActive, true);
	});
});

describe("Beta-Befund 004 G — günstiger zukünftiger Netzstrom", () => {
	it("deferForCheapFutureGrid hält Ziel am Nacht-Floor", () => {
		const normal = planDynamicBatteryEndSoc({
			capacityKwh: 10,
			socPct: 50,
			minSocPct: 10,
			maxSocPct: 100,
			modePolicy: plannerModePolicyFromGlobalMode("eco"),
			avgNightDischargeKwh: 2.5,
			chargeLogic: {
				active: false,
				forecastActive: true,
				horizonDays: 2,
				bridgeUntilIso: null,
				pvRecoveryDay: 1,
				energyStoredKwh: 5,
				energyDeficitKwh: 0,
				energyReserveKwh: 0.5,
				energyTargetKwh: 5,
				socTargetPct: 50,
				chargeEnergyKwh: null,
				confidenceMinPct: 80,
				reasonDe: "ok",
			},
			deferForCheapFutureGrid: false,
		});
		const deferred = planDynamicBatteryEndSoc({
			capacityKwh: 10,
			socPct: 50,
			minSocPct: 10,
			maxSocPct: 100,
			modePolicy: plannerModePolicyFromGlobalMode("eco"),
			avgNightDischargeKwh: 2.5,
			chargeLogic: {
				active: false,
				forecastActive: true,
				horizonDays: 2,
				bridgeUntilIso: null,
				pvRecoveryDay: 1,
				energyStoredKwh: 5,
				energyDeficitKwh: 0,
				energyReserveKwh: 0.5,
				energyTargetKwh: 5,
				socTargetPct: 50,
				chargeEnergyKwh: null,
				confidenceMinPct: 80,
				reasonDe: "ok",
			},
			deferForCheapFutureGrid: true,
		});
		assert.ok(deferred.socTargetPct <= normal.socTargetPct);
		assert.match(deferred.reasonDe, /günstiger|Netzstrom/i);
	});
});

describe("Beta-Befund 004 H — keine feste Phasenpriorität", () => {
	it("score allocator remains joint (thermal + battery compete by score)", () => {
		const input = golden001Input();
		input.time.nowIso = "2026-08-04T10:00:00.000Z";
		input.battery = {
			...input.battery,
			socPct: 100,
			endSocTargetPct: 40,
			requiredChargeEnergyKwh: 0,
			nightReserveKwh: 2.5,
		};
		input.thermal = {
			...input.thermal!,
			bufferTempC: 47,
			dayTargetTempC: 58,
			headroomEnergyKwh: 4,
			estimatedEmptyAtIso: "2026-08-04T15:44:00.000Z",
			deadlineIso: "2026-08-04T15:44:00.000Z",
			emptyAtSource: "learned",
		};
		const plan = allocateUnifiedDayPlan(input, { generation: 1 });
		const th = plan.allocations
			.filter((a) => a.kind === "immersion_heater")
			.reduce((s, a) => s + a.allocatedEnergyKwh, 0);
		const bat = plan.allocations
			.filter((a) => a.kind === "battery_charge")
			.reduce((s, a) => s + a.allocatedEnergyKwh, 0);
		// Batterie satt / Ziel 40 % → kaum/keine Charge; Thermal darf PV bekommen
		assert.ok(bat < 0.5, `battery charge should be minimal, got ${bat}`);
		assert.ok(th > 0.5, `thermal should get PV, got ${th}`);
	});
});

describe("Beta-Befund 004 Replay — Beta-Fall SOC100 / emptyAt Abend", () => {
	it("reports dynamic battery + thermal precharge numbers", () => {
		const logic = planBatteryChargeLogic({
			now: new Date("2026-08-08T12:00:00.000Z"),
			socPct: 100,
			snowCoverSuspected: false,
			governanceEnabled: true,
			modePolicy: plannerModePolicyFromGlobalMode("balanced"),
			config: {
				enabled: true,
				horizonDays: 3,
				marginKwh: 0.5,
				pvRecoveryRatio: 1.15,
				reserveLowConfidenceFactor: 0.5,
				maxSocPct: 100,
				minSocPct: 10,
				capacityKwh: 10,
			},
			days: [
				{ dayIndex: 0, dateKey: "2026-08-08", pvKwh: 30, loadKwh: 14, pvConfidencePct: 85 },
				{ dayIndex: 1, dateKey: "2026-08-09", pvKwh: 26, loadKwh: 13, pvConfidencePct: 80 },
			],
		});
		const dyn = planDynamicBatteryEndSoc({
			capacityKwh: 10,
			socPct: 100,
			minSocPct: 10,
			maxSocPct: 100,
			modePolicy: plannerModePolicyFromGlobalMode("balanced"),
			avgNightDischargeKwh: 2.5,
			chargeLogic: logic,
		});
		const ih = buildImmersionFlexibleContribution({
			now: new Date("2026-08-08T12:00:00.000Z"),
			addonEnabled: true,
			governanceEnabled: true,
			globalModeOff: false,
			addonExecutionOff: false,
			modePolicy: plannerModePolicyFromGlobalMode("balanced"),
			config: ihConfig(),
			bufferTempC: 47,
			thermalMode: "auto",
			fault: false,
			lockout: false,
			relayMapped: true,
			pvTodayKwh: 30,
			pvTomorrowKwh: 26,
			pvBiasStatus: "valid",
			forecastModeEnabled: true,
			aiOptimizationAllowed: false,
			thermalLearning: thermalOk("2026-08-08T15:44:00.000Z"),
			todayPvSurplusKwh: 12,
			batterySocPct: 100,
			batteryEndSocTargetPct: dyn.socTargetPct,
			timezone: "Europe/Berlin",
		});

		const report = {
			batterySocPct: 100,
			dynamicEndSocTargetPct: dyn.socTargetPct,
			nightReserveKwh: 2.5,
			bufferTempC: 47,
			thermalTargetTempC: ih.details.targetTempC,
			forecastTargetTempC: ih.details.forecastTargetTempC,
			estimatedEmptyAt: ih.details.estimatedEmptyAt,
			pvPrechargeActive: ih.details.pvPrechargeActive,
			requiredThermalKwh: ih.details.requiredEnergyKwh,
			batteryChargeNeedKwh: Math.max(0, dyn.energyTargetKwh - 10),
			reasonBattery: dyn.reasonDe,
			reasonThermal: ih.details.targetReasonDe,
		};
		assert.ok(report.dynamicEndSocTargetPct < 70);
		assert.ok((report.thermalTargetTempC as number) > (report.forecastTargetTempC as number));
		assert.equal(report.pvPrechargeActive, true);
		assert.equal(report.batteryChargeNeedKwh, 0);
		// Sichtbarer Replay-Output für Abschlussbericht
		console.log("\n=== BETA-004 REPLAY ===\n", JSON.stringify(report, null, 2));
	});
});

describe("Beta-Befund 004 I — Puffer Flexspeicher + Fahrzeug-Replan", () => {
	it("precharge active without vehicle; backs off when vehicle goal arrives", () => {
		const base = {
			now: new Date("2026-08-08T11:00:00.000Z"),
			addonEnabled: true,
			governanceEnabled: true,
			globalModeOff: false,
			addonExecutionOff: false,
			modePolicy: plannerModePolicyFromGlobalMode("balanced"),
			config: ihConfig(63),
			bufferTempC: 47,
			thermalMode: "auto" as const,
			fault: false,
			lockout: false,
			relayMapped: true,
			pvTodayKwh: 30,
			pvTomorrowKwh: 22,
			pvBiasStatus: "valid",
			forecastModeEnabled: true,
			aiOptimizationAllowed: false,
			thermalLearning: thermalOk("2026-08-08T15:44:00.000Z"),
			todayPvSurplusKwh: 14,
			batterySocPct: 92,
			batteryEndSocTargetPct: 38,
			exportTariffCtPerKwh: 8,
			importTariffCtPerKwh: 30,
			futureElectricalFlexHintKwh: 5,
			timezone: "Europe/Berlin",
		};
		const withoutCar = buildImmersionFlexibleContribution({
			...base,
			vehicleUrgentEnergyKwh: null,
		});
		const withCar = buildImmersionFlexibleContribution({
			...base,
			vehicleUrgentEnergyKwh: 10,
		});
		assert.equal(withoutCar.details.pvPrechargeActive, true);
		assert.ok((withoutCar.details.targetTempC as number) >= 56);
		assert.equal(withCar.details.pvPrechargeActive, false);
		assert.ok(
			(withCar.details.targetTempC as number) < (withoutCar.details.targetTempC as number),
			"replan must lower thermal target when vehicle arrives",
		);
	});
});
