"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Beta-Befund 004: dynamisches Batterie-Endziel + thermische PV-Vorladung.
 */
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const mode_policy_1 = require("../../../planner/mode_policy");
const battery_end_soc_1 = require("./battery_end_soc");
const battery_charge_logic_1 = require("./battery_charge_logic");
const battery_1 = require("./battery");
const thermal_pv_precharge_1 = require("./thermal_pv_precharge");
const immersion_heater_1 = require("./immersion_heater");
const device_config_1 = require("../../../addons/immersion_heater/device_config");
const allocate_1 = require("../../daily_plan/unified/allocate");
const fixtures_1 = require("../../daily_plan/unified/fixtures");
const quality_1 = require("../../quality");
const NOW = new Date("2026-08-08T12:00:00.000Z");
function gridForecast() {
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
        quality: (0, quality_1.operatorQuality)("valid", "OK"),
        reasonDe: "OK",
    };
}
function batBase(overrides = {}) {
    return {
        now: NOW,
        addonEnabled: true,
        governanceEnabled: true,
        globalModeOff: false,
        addonExecutionOff: false,
        modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("balanced"),
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
    return (0, device_config_1.immersionDeviceConfigFromAdapter)({
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
function thermalOk(emptyAt) {
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
(0, node_test_1.describe)("Beta-Befund 004 A — guter Morgen-PV → Endziel <100 %", () => {
    (0, node_test_1.it)("Nachtbedarf 2.5 kWh + Recovery Tag 1 → Ziel deutlich unter 100", () => {
        const logic = (0, battery_charge_logic_1.planBatteryChargeLogic)({
            now: NOW,
            socPct: 100,
            snowCoverSuspected: false,
            governanceEnabled: true,
            modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("balanced"),
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
        strict_1.default.equal(logic.active, false);
        const dyn = (0, battery_end_soc_1.planDynamicBatteryEndSoc)({
            capacityKwh: 10,
            socPct: 100,
            minSocPct: 10,
            maxSocPct: 100,
            modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("balanced"),
            avgNightDischargeKwh: 2.5,
            chargeLogic: logic,
        });
        strict_1.default.ok(dyn.socTargetPct < 100);
        strict_1.default.ok(dyn.socTargetPct < 60, `expected dynamic end SOC <60, got ${dyn.socTargetPct}`);
        strict_1.default.ok(dyn.energyTargetKwh >= 2.5);
        strict_1.default.equal(dyn.usedPolicyFallback, false);
    });
});
(0, node_test_1.describe)("Beta-Befund 004 B — schlechter Morgen-PV → höheres Ziel", () => {
    (0, node_test_1.it)("Defizit bis Recovery angehoben", () => {
        const good = (0, battery_end_soc_1.planDynamicBatteryEndSoc)({
            capacityKwh: 10,
            socPct: 40,
            minSocPct: 10,
            maxSocPct: 100,
            modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("balanced"),
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
        const bad = (0, battery_end_soc_1.planDynamicBatteryEndSoc)({
            capacityKwh: 10,
            socPct: 40,
            minSocPct: 10,
            maxSocPct: 100,
            modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("balanced"),
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
        strict_1.default.ok(bad.socTargetPct > good.socTargetPct);
        strict_1.default.ok(bad.socTargetPct >= 90);
    });
});
(0, node_test_1.describe)("Beta-Befund 004 C — Top-off → 100 %", () => {
    (0, node_test_1.it)("topoff fällig erzwingt 100", () => {
        const c = (0, battery_1.buildBatteryChargeContribution)(batBase({
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
        }));
        strict_1.default.equal(c.details.targetSocPct, 100);
    });
});
(0, node_test_1.describe)("Beta-Befund 004 D — Thermal PV-Vorladung bei emptyAt heute", () => {
    (0, node_test_1.it)("starke PV + Batterie satt → Ziel deutlich über 51.6 Richtung Max 63", () => {
        const pre = (0, thermal_pv_precharge_1.resolveThermalPvPrecharge)({
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
        strict_1.default.equal(pre.active, true);
        strict_1.default.ok(pre.targetTempC > 51.6 + 3, `got ${pre.targetTempC}`);
        strict_1.default.ok(pre.targetTempC <= 63);
        strict_1.default.ok(pre.targetTempC >= 56, `flex storage should push well above 51.6, got ${pre.targetTempC}`);
    });
});
(0, node_test_1.describe)("Beta-Befund 004 E — EV dringend → weniger Thermal-Extra", () => {
    (0, node_test_1.it)("vehicle urgent + knapper Surplus → keine Extra-Vorladung", () => {
        const pre = (0, thermal_pv_precharge_1.resolveThermalPvPrecharge)({
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
        strict_1.default.equal(pre.active, false);
    });
});
(0, node_test_1.describe)("Beta-Befund 004 F — Batterie satt + Thermal-Defizit", () => {
    (0, node_test_1.it)("Immersion contribution raises target with PV precharge", () => {
        const c = (0, immersion_heater_1.buildImmersionFlexibleContribution)({
            now: new Date("2026-08-08T12:00:00.000Z"),
            addonEnabled: true,
            governanceEnabled: true,
            globalModeOff: false,
            addonExecutionOff: false,
            modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("balanced"),
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
        const target = c.details.targetTempC;
        strict_1.default.ok(target > 51.6, `target=${target}`);
        strict_1.default.equal(c.details.pvPrechargeActive, true);
    });
});
(0, node_test_1.describe)("Beta-Befund 004 G — günstiger zukünftiger Netzstrom", () => {
    (0, node_test_1.it)("deferForCheapFutureGrid hält Ziel am Nacht-Floor", () => {
        const normal = (0, battery_end_soc_1.planDynamicBatteryEndSoc)({
            capacityKwh: 10,
            socPct: 50,
            minSocPct: 10,
            maxSocPct: 100,
            modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("eco"),
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
        const deferred = (0, battery_end_soc_1.planDynamicBatteryEndSoc)({
            capacityKwh: 10,
            socPct: 50,
            minSocPct: 10,
            maxSocPct: 100,
            modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("eco"),
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
        strict_1.default.ok(deferred.socTargetPct <= normal.socTargetPct);
        strict_1.default.match(deferred.reasonDe, /günstiger|Netzstrom/i);
    });
});
(0, node_test_1.describe)("Beta-Befund 004 H — keine feste Phasenpriorität", () => {
    (0, node_test_1.it)("score allocator remains joint (thermal + battery compete by score)", () => {
        const input = (0, fixtures_1.golden001Input)();
        input.time.nowIso = "2026-08-04T10:00:00.000Z";
        input.battery = {
            ...input.battery,
            socPct: 100,
            endSocTargetPct: 40,
            requiredChargeEnergyKwh: 0,
            nightReserveKwh: 2.5,
        };
        input.thermal = {
            ...input.thermal,
            bufferTempC: 47,
            dayTargetTempC: 58,
            headroomEnergyKwh: 4,
            estimatedEmptyAtIso: "2026-08-04T15:44:00.000Z",
            deadlineIso: "2026-08-04T15:44:00.000Z",
            emptyAtSource: "learned",
        };
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input, { generation: 1 });
        const th = plan.allocations
            .filter((a) => a.kind === "immersion_heater")
            .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
        const bat = plan.allocations
            .filter((a) => a.kind === "battery_charge")
            .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
        // Batterie satt / Ziel 40 % → kaum/keine Charge; Thermal darf PV bekommen
        strict_1.default.ok(bat < 0.5, `battery charge should be minimal, got ${bat}`);
        strict_1.default.ok(th > 0.5, `thermal should get PV, got ${th}`);
    });
});
(0, node_test_1.describe)("Beta-Befund 004 Replay — Beta-Fall SOC100 / emptyAt Abend", () => {
    (0, node_test_1.it)("reports dynamic battery + thermal precharge numbers", () => {
        const logic = (0, battery_charge_logic_1.planBatteryChargeLogic)({
            now: new Date("2026-08-08T12:00:00.000Z"),
            socPct: 100,
            snowCoverSuspected: false,
            governanceEnabled: true,
            modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("balanced"),
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
        const dyn = (0, battery_end_soc_1.planDynamicBatteryEndSoc)({
            capacityKwh: 10,
            socPct: 100,
            minSocPct: 10,
            maxSocPct: 100,
            modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("balanced"),
            avgNightDischargeKwh: 2.5,
            chargeLogic: logic,
        });
        const ih = (0, immersion_heater_1.buildImmersionFlexibleContribution)({
            now: new Date("2026-08-08T12:00:00.000Z"),
            addonEnabled: true,
            governanceEnabled: true,
            globalModeOff: false,
            addonExecutionOff: false,
            modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("balanced"),
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
        strict_1.default.ok(report.dynamicEndSocTargetPct < 70);
        strict_1.default.ok(report.thermalTargetTempC > report.forecastTargetTempC);
        strict_1.default.equal(report.pvPrechargeActive, true);
        strict_1.default.equal(report.batteryChargeNeedKwh, 0);
        // Sichtbarer Replay-Output für Abschlussbericht
        console.log("\n=== BETA-004 REPLAY ===\n", JSON.stringify(report, null, 2));
    });
});
(0, node_test_1.describe)("Beta-Befund 004 I — Puffer Flexspeicher + Fahrzeug-Replan", () => {
    (0, node_test_1.it)("precharge active without vehicle; backs off when vehicle goal arrives", () => {
        const base = {
            now: new Date("2026-08-08T11:00:00.000Z"),
            addonEnabled: true,
            governanceEnabled: true,
            globalModeOff: false,
            addonExecutionOff: false,
            modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("balanced"),
            config: ihConfig(63),
            bufferTempC: 47,
            thermalMode: "auto",
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
        const withoutCar = (0, immersion_heater_1.buildImmersionFlexibleContribution)({
            ...base,
            vehicleUrgentEnergyKwh: null,
        });
        const withCar = (0, immersion_heater_1.buildImmersionFlexibleContribution)({
            ...base,
            vehicleUrgentEnergyKwh: 10,
        });
        strict_1.default.equal(withoutCar.details.pvPrechargeActive, true);
        strict_1.default.ok(withoutCar.details.targetTempC >= 56);
        strict_1.default.equal(withCar.details.pvPrechargeActive, false);
        strict_1.default.ok(withCar.details.targetTempC < withoutCar.details.targetTempC, "replan must lower thermal target when vehicle arrives");
    });
});
