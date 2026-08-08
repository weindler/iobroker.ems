"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const config_1 = require("../../../addons/air_conditioning/config");
const constants_1 = require("../../../addons/air_conditioning/constants");
const device_config_1 = require("../../../addons/immersion_heater/device_config");
const mode_policy_1 = require("../../../planner/mode_policy");
const quality_1 = require("../../quality");
const contribution_ids_1 = require("../../contribution_ids");
const battery_1 = require("./battery");
const wallbox_1 = require("./wallbox");
const immersion_heater_1 = require("./immersion_heater");
const air_conditioning_1 = require("./air_conditioning");
const build_1 = require("./build");
const types_1 = require("./types");
const NOW = new Date("2026-07-11T10:00:00.000Z");
function gridForecast(overrides = {}) {
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
        ...overrides,
    };
}
function batteryInput(overrides = {}) {
    return {
        now: NOW,
        addonEnabled: true,
        governanceEnabled: true,
        globalModeOff: false,
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
function wallboxInput(overrides = {}) {
    return {
        now: NOW,
        addonEnabled: true,
        governanceEnabled: true,
        globalModeOff: false,
        modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("balanced"),
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
    return (0, device_config_1.immersionDeviceConfigFromAdapter)({
        ih_stage_count: 1,
        ih_stage_1_set_state: "relay.0.heater",
        ih_stage_1_nominal_power_w: 2000,
        ih_buffer_temp_c_target: "sensor.0.temp",
        ih_buffer_temp_c_enabled: true,
    });
}
function immersionInput(overrides = {}) {
    return {
        now: NOW,
        addonEnabled: true,
        governanceEnabled: true,
        globalModeOff: false,
        modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("balanced"),
        config: immersionConfig(),
        bufferTempC: 50,
        thermalMode: "auto",
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
function acInput(overrides = {}) {
    const acConfig = (0, config_1.acGlobalConfigFromAdapter)({
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
        modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("balanced"),
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
(0, node_test_1.describe)("flexible participation", () => {
    (0, node_test_1.it)("maps disabled addon", () => {
        const r = (0, types_1.evaluateParticipation)({
            addonEnabled: false,
            governanceEnabled: true,
            configured: true,
            mappingsReady: true,
            fault: false,
            lockout: false,
            globalModeOff: false,
        });
        strict_1.default.equal(r.status, "disabled");
    });
    (0, node_test_1.it)("maps fault to blocked", () => {
        const r = (0, types_1.evaluateParticipation)({
            addonEnabled: true,
            governanceEnabled: true,
            configured: true,
            mappingsReady: true,
            fault: true,
            lockout: false,
            globalModeOff: false,
        });
        strict_1.default.equal(r.status, "blocked");
    });
    (0, node_test_1.it)("maps unsupported profile capability", () => {
        const r = (0, types_1.evaluateParticipation)({
            addonEnabled: true,
            governanceEnabled: true,
            configured: true,
            mappingsReady: true,
            fault: false,
            lockout: false,
            globalModeOff: false,
            unsupported: true,
        });
        strict_1.default.equal(r.status, "unsupported");
    });
});
(0, node_test_1.describe)("battery contributions", () => {
    (0, node_test_1.it)("skips EMS charge slots when today's PV surplus covers the SOC gap", () => {
        const c = (0, battery_1.buildBatteryChargeContribution)(batteryInput({
            socPct: 55,
            capacityManualKwh: 10,
            todayPvSurplusKwh: 12,
        }));
        // balanced target 95% → 4 kWh gap; surplus 12 ≥ 4
        strict_1.default.equal(c.details.pvCoversChargeNeed, true);
        strict_1.default.equal(c.details.requiredEnergyKwh, 0);
        strict_1.default.equal(c.details.socGapEnergyKwh, 4);
        strict_1.default.equal(c.slots.length, 0);
        strict_1.default.match(c.reasonDe, /keine EMS-Lade-Slots/);
    });
    (0, node_test_1.it)("keeps charge slots when top-off requested despite PV surplus", () => {
        const c = (0, battery_1.buildBatteryChargeContribution)(batteryInput({
            socPct: 90,
            topOffRequested: true,
            todayPvSurplusKwh: 50,
        }));
        strict_1.default.equal(c.details.pvCoversChargeNeed, false);
        strict_1.default.ok(c.details.requiredEnergyKwh > 0);
        strict_1.default.equal(c.slots.length, 1);
    });
    (0, node_test_1.it)("builds valid charge contribution", () => {
        const c = (0, battery_1.buildBatteryChargeContribution)(batteryInput());
        strict_1.default.equal(c.contributionId, contribution_ids_1.CONTRIBUTION_IDS.BATTERY_CHARGE);
        strict_1.default.equal(c.flow, "consume");
        strict_1.default.deepEqual(c.roles, ["storage", "demand_flex", "dispatch"]);
        strict_1.default.equal(c.enabled, true);
        strict_1.default.equal(c.details.requiredEnergyKwh, 4);
    });
    (0, node_test_1.it)("degrades when soc missing", () => {
        const c = (0, battery_1.buildBatteryChargeContribution)(batteryInput({ socPct: null }));
        strict_1.default.equal(c.quality.status, "degraded");
        strict_1.default.equal(c.details.requiredEnergyKwh, null);
    });
    (0, node_test_1.it)("degrades when capacity missing", () => {
        const c = (0, battery_1.buildBatteryChargeContribution)(batteryInput({ capacityManualKwh: null, capacityMappedKwh: null }));
        strict_1.default.equal(c.quality.status, "degraded");
    });
    (0, node_test_1.it)("handles soc above max target as zero need", () => {
        const c = (0, battery_1.buildBatteryChargeContribution)(batteryInput({ socPct: 98, modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("comfort") }));
        strict_1.default.equal(c.details.requiredEnergyKwh, 0);
    });
    (0, node_test_1.it)("builds reserve constraint", () => {
        const c = (0, battery_1.buildBatteryReserveContribution)(batteryInput());
        strict_1.default.equal(c.contributionId, contribution_ids_1.CONTRIBUTION_IDS.BATTERY_RESERVE);
        strict_1.default.equal(c.flow, "constraint");
        strict_1.default.equal(c.details.minSocPct, 10);
        strict_1.default.equal(c.details.batteryLearningStatus, "missing");
    });
    (0, node_test_1.it)("reserve exposes learned night discharge and marks top-off target when due", () => {
        const c = (0, battery_1.buildBatteryReserveContribution)(batteryInput({
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
        }));
        strict_1.default.equal(c.details.avgNightDischargeKwh, 2.4);
        strict_1.default.equal(c.details.topOffTargetSocPct, 100);
    });
    (0, node_test_1.it)("top-off only when requested", () => {
        const off = (0, battery_1.buildBatteryChargeContribution)(batteryInput({ topOffRequested: false }));
        const on = (0, battery_1.buildBatteryChargeContribution)(batteryInput({ topOffRequested: true, socPct: 90 }));
        strict_1.default.equal(off.details.topOffRequested, false);
        strict_1.default.equal(on.details.targetSocPct, 100);
        strict_1.default.equal(on.details.requiredEnergyKwh, 1);
    });
    (0, node_test_1.it)("keeps policy target when learning is missing (unchanged behavior)", () => {
        const c = (0, battery_1.buildBatteryChargeContribution)(batteryInput());
        strict_1.default.equal(c.details.targetSocPct, (0, mode_policy_1.plannerModePolicyFromGlobalMode)("balanced").chargeTargetSocPct);
        strict_1.default.equal(c.details.batteryLearningStatus, "missing");
    });
    (0, node_test_1.it)("ignores a degraded learning model for top-off (not belastbar enough)", () => {
        const c = (0, battery_1.buildBatteryChargeContribution)(batteryInput({
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
        }));
        strict_1.default.equal(c.details.targetSocPct, (0, mode_policy_1.plannerModePolicyFromGlobalMode)("balanced").chargeTargetSocPct);
    });
    (0, node_test_1.it)("raises target to 100% when the learned top-off interval is due", () => {
        const c = (0, battery_1.buildBatteryChargeContribution)(batteryInput({
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
        }));
        strict_1.default.equal(c.details.targetSocPct, 100);
        strict_1.default.equal(c.details.topoffDueLearned, true);
        strict_1.default.equal(c.details.avgNightDischargeKwh, 2.4);
        strict_1.default.match(c.reasonDe, /Top-Off/);
    });
    (0, node_test_1.it)("does not raise target when the learned model says top-off is not due", () => {
        const c = (0, battery_1.buildBatteryChargeContribution)(batteryInput({
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
        }));
        strict_1.default.equal(c.details.targetSocPct, (0, mode_policy_1.plannerModePolicyFromGlobalMode)("balanced").chargeTargetSocPct);
    });
    (0, node_test_1.it)("grid import blocked in eco without active PV-deficit charge logic", () => {
        const c = (0, battery_1.buildBatteryChargeContribution)(batteryInput({ modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("eco"), deficitChargeActive: false }));
        strict_1.default.equal(c.gridEligible, false);
    });
    (0, node_test_1.it)("grid import allowed in eco when PV-deficit charge logic is active", () => {
        const c = (0, battery_1.buildBatteryChargeContribution)(batteryInput({ modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("eco"), deficitChargeActive: true }));
        strict_1.default.equal(c.gridEligible, true);
    });
    (0, node_test_1.it)("raises target SOC above the eco policy target and sets a deadline when the PV-deficit charge logic is active", () => {
        const c = (0, battery_1.buildBatteryChargeContribution)(batteryInput({
            socPct: 55,
            modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("eco"),
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
        }));
        strict_1.default.equal(c.details.targetSocPct, 96);
        strict_1.default.equal(c.deadlineIso, "2026-07-15T22:00:00.000Z");
        strict_1.default.equal(c.details.chargeLogicActive, true);
        strict_1.default.equal(c.gridEligible, true);
        strict_1.default.match(c.reasonDe, /PV-Defizit-Ladelogik/);
    });
    (0, node_test_1.it)("does not raise target or set deadline when charge logic is inactive", () => {
        const c = (0, battery_1.buildBatteryChargeContribution)(batteryInput({
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
        }));
        strict_1.default.equal(c.details.targetSocPct, (0, mode_policy_1.plannerModePolicyFromGlobalMode)("balanced").chargeTargetSocPct);
        strict_1.default.equal(c.deadlineIso, null);
    });
    (0, node_test_1.it)("global mode off disables charge", () => {
        const c = (0, battery_1.buildBatteryChargeContribution)(batteryInput({ globalModeOff: true, modePolicy: (0, mode_policy_1.plannerModePolicyFromGlobalMode)("off") }));
        strict_1.default.equal(c.enabled, false);
    });
    (0, node_test_1.it)("fault blocks charge", () => {
        const c = (0, battery_1.buildBatteryChargeContribution)(batteryInput({ fault: true }));
        strict_1.default.equal(c.enabled, false);
        strict_1.default.equal(c.quality.status, "blocked");
    });
    (0, node_test_1.it)("sonnen_em discharge is unsupported", () => {
        const c = (0, battery_1.buildBatteryDischargeContribution)(batteryInput({ profileId: "sonnen_em" }));
        strict_1.default.equal(c.contributionId, contribution_ids_1.CONTRIBUTION_IDS.BATTERY_DISCHARGE);
        strict_1.default.equal(c.flow, "provide");
        strict_1.default.equal(c.enabled, false);
        strict_1.default.equal(c.quality.status, "unsupported");
        strict_1.default.equal(c.slots.length, 0);
        strict_1.default.equal(c.details.passiveSelfConsumptionOnly, true);
    });
    (0, node_test_1.it)("returns three stable battery contributions", () => {
        const all = (0, battery_1.buildBatteryContributions)(batteryInput());
        strict_1.default.equal(all.length, 3);
        const ids = all.map((c) => c.contributionId);
        strict_1.default.deepEqual(ids, [
            contribution_ids_1.CONTRIBUTION_IDS.BATTERY_CHARGE,
            contribution_ids_1.CONTRIBUTION_IDS.BATTERY_DISCHARGE,
            contribution_ids_1.CONTRIBUTION_IDS.BATTERY_RESERVE,
        ]);
    });
});
(0, node_test_1.describe)("wallbox contribution", () => {
    (0, node_test_1.it)("connected false disables active session", () => {
        const c = (0, wallbox_1.buildWallboxEvSessionContribution)(wallboxInput({ connected: false, vehicleSocPct: 0 }));
        strict_1.default.equal(c.enabled, false);
        strict_1.default.equal(c.quality.status, "disabled");
        strict_1.default.match(c.reasonDe, /nicht verbunden/i);
        strict_1.default.equal(c.details.vehicleSocPct, 0);
    });
    (0, node_test_1.it)("connected with remaining energy", () => {
        const c = (0, wallbox_1.buildWallboxEvSessionContribution)(wallboxInput({ remainingEnergyKwh: 18.5, vehicleSocPct: null }));
        strict_1.default.equal(c.enabled, true);
        strict_1.default.equal(c.details.requiredEnergyKwh, 18.5);
    });
    (0, node_test_1.it)("prefers remaining energy without capacity", () => {
        const c = (0, wallbox_1.buildWallboxEvSessionContribution)(wallboxInput({
            remainingEnergyKwh: 9.2,
            vehicleCapacityKwh: null,
            vehicleSocPct: null,
            planActive: false,
            planSocPct: 0,
        }));
        strict_1.default.equal(c.details.requiredEnergyKwh, 9.2);
        strict_1.default.equal(c.quality.status, "valid");
    });
    (0, node_test_1.it)("connected with soc and vehicle capacity", () => {
        const c = (0, wallbox_1.buildWallboxEvSessionContribution)(wallboxInput({ vehicleCapacityKwh: 60, vehicleSocPct: 40, planSocPct: 80 }));
        strict_1.default.equal(c.details.requiredEnergyKwh, 24);
    });
    (0, node_test_1.it)("ignores planSoc 0 when plan inactive", () => {
        const c = (0, wallbox_1.buildWallboxEvSessionContribution)(wallboxInput({
            vehicleCapacityKwh: 60,
            vehicleSocPct: 40,
            planSocPct: 0,
            planActive: false,
            remainingEnergyKwh: null,
        }));
        strict_1.default.equal(c.details.requiredEnergyKwh, null);
        strict_1.default.match(c.reasonDe, /Ladeziel|Restenergie|Kapazität/i);
    });
    (0, node_test_1.it)("uses effectiveLimitSoc fallback when plan inactive", () => {
        const c = (0, wallbox_1.buildWallboxEvSessionContribution)(wallboxInput({
            vehicleCapacityKwh: 50,
            vehicleSocPct: 40,
            planSocPct: 0,
            planActive: false,
            effectiveLimitSocPct: 80,
            remainingEnergyKwh: null,
        }));
        strict_1.default.equal(c.details.requiredEnergyKwh, 20);
    });
    (0, node_test_1.it)("unknown capacity yields null energy need", () => {
        const c = (0, wallbox_1.buildWallboxEvSessionContribution)(wallboxInput({ vehicleCapacityKwh: null, remainingEnergyKwh: null }));
        strict_1.default.equal(c.details.requiredEnergyKwh, null);
    });
    (0, node_test_1.it)("missing soc with remaining energy stays valid", () => {
        const c = (0, wallbox_1.buildWallboxEvSessionContribution)(wallboxInput({ vehicleSocPct: null, remainingEnergyKwh: 5 }));
        strict_1.default.equal(c.enabled, true);
        strict_1.default.equal(c.quality.status, "valid");
    });
    (0, node_test_1.it)("preserves deadline when present", () => {
        const c = (0, wallbox_1.buildWallboxEvSessionContribution)(wallboxInput({ deadlineIso: "2026-07-11T20:00:00.000Z" }));
        strict_1.default.equal(c.deadlineIso, "2026-07-11T20:00:00.000Z");
    });
    (0, node_test_1.it)("null deadline when absent", () => {
        const c = (0, wallbox_1.buildWallboxEvSessionContribution)(wallboxInput({ deadlineIso: null }));
        strict_1.default.equal(c.deadlineIso, null);
    });
    (0, node_test_1.it)("grid import blocked", () => {
        const c = (0, wallbox_1.buildWallboxEvSessionContribution)(wallboxInput({ gridForecast: gridForecast({ gridImportAllowed: false }) }));
        strict_1.default.equal(c.gridEligible, false);
    });
    (0, node_test_1.it)("marks runtime read-only", () => {
        const c = (0, wallbox_1.buildWallboxEvSessionContribution)(wallboxInput());
        strict_1.default.equal(c.details.runtimeControlAvailable, false);
    });
});
(0, node_test_1.describe)("immersion heater contributions", () => {
    (0, node_test_1.it)("mandatory below planning min temp includes energy slot", () => {
        const [mandatory] = (0, immersion_heater_1.buildImmersionHeaterContributions)(immersionInput({ bufferTempC: 45, thermalMode: "auto" }));
        strict_1.default.equal(mandatory.contributionId, contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_MANDATORY);
        strict_1.default.equal(mandatory.enabled, true);
        strict_1.default.equal(mandatory.details.mandatory, true);
        strict_1.default.ok(mandatory.details.requiredEnergyKwh > 0);
        strict_1.default.equal(mandatory.slots.length, 1);
        strict_1.default.equal(mandatory.slots[0].mandatory, true);
    });
    (0, node_test_1.it)("flexible demand in auto mode", () => {
        const [, flexible] = (0, immersion_heater_1.buildImmersionHeaterContributions)(immersionInput());
        strict_1.default.equal(flexible.contributionId, contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE);
        strict_1.default.equal(flexible.flexible, true);
        strict_1.default.equal(flexible.gridEligible, false);
        strict_1.default.ok(typeof flexible.details.requiredEnergyKwh === "number");
        strict_1.default.ok(flexible.details.requiredEnergyKwh > 0);
        strict_1.default.equal(flexible.slots.length, 1);
        strict_1.default.equal(flexible.slots[0].maxPowerW, 2000);
    });
    (0, node_test_1.it)("no flexible demand when target reached", () => {
        const [, flexible] = (0, immersion_heater_1.buildImmersionHeaterContributions)(immersionInput({ bufferTempC: 62 }));
        strict_1.default.equal(flexible.enabled, false);
    });
    (0, node_test_1.it)("keeps strategic headroom while reheat hysteresis is runtime-active", () => {
        const [, flexible] = (0, immersion_heater_1.buildImmersionHeaterContributions)(immersionInput({
            bufferTempC: 48,
            autoTargetReached: true,
            config: (0, device_config_1.immersionDeviceConfigFromAdapter)({
                ih_stage_count: 1,
                ih_stage_1_set_state: "relay.0.heater",
                ih_stage_1_nominal_power_w: 2000,
                ih_buffer_temp_c_target: "sensor.0.temp",
                ih_buffer_temp_c_enabled: true,
                ih_temperature_hysteresis_k: 5,
                ih_planning_min_temp_c: 44,
                ih_planning_max_temp_c: 63,
            }),
        }));
        strict_1.default.equal(flexible.enabled, true);
        strict_1.default.equal(flexible.slots.length, 1);
        strict_1.default.ok(flexible.details.requiredEnergyKwh > 0);
        strict_1.default.equal(flexible.details.reheatHysteresisActive, true);
        strict_1.default.equal(flexible.details.reheatHysteresisRuntimeOnly, true);
        strict_1.default.match(flexible.reasonDe, /Runtime-Hysterese/);
    });
    (0, node_test_1.it)("flexible demand returns after cooling below hysteresis band", () => {
        const [, flexible] = (0, immersion_heater_1.buildImmersionHeaterContributions)(immersionInput({
            bufferTempC: 46,
            autoTargetReached: true,
            config: (0, device_config_1.immersionDeviceConfigFromAdapter)({
                ih_stage_count: 1,
                ih_stage_1_set_state: "relay.0.heater",
                ih_stage_1_nominal_power_w: 2000,
                ih_buffer_temp_c_target: "sensor.0.temp",
                ih_buffer_temp_c_enabled: true,
                ih_temperature_hysteresis_k: 5,
                ih_planning_min_temp_c: 44,
                ih_planning_max_temp_c: 63,
            }),
        }));
        strict_1.default.equal(flexible.enabled, true);
        strict_1.default.equal(flexible.slots.length, 1);
        strict_1.default.equal(flexible.details.reheatHysteresisActive, false);
    });
    (0, node_test_1.it)("blocks on fault", () => {
        const [, flexible] = (0, immersion_heater_1.buildImmersionHeaterContributions)(immersionInput({ fault: true }));
        strict_1.default.equal(flexible.enabled, false);
        strict_1.default.equal(flexible.quality.status, "blocked");
    });
    (0, node_test_1.it)("blocks on missing mapping", () => {
        const [, flexible] = (0, immersion_heater_1.buildImmersionHeaterContributions)(immersionInput({ relayMapped: false }));
        strict_1.default.equal(flexible.enabled, false);
        strict_1.default.equal(flexible.quality.status, "missing");
    });
    (0, node_test_1.it)("governance off disables flexible", () => {
        const [, flexible] = (0, immersion_heater_1.buildImmersionHeaterContributions)(immersionInput({ governanceEnabled: false }));
        strict_1.default.equal(flexible.enabled, false);
    });
    (0, node_test_1.it)("has no deadline without thermal-runtime learning (unchanged behavior)", () => {
        const [, flexible] = (0, immersion_heater_1.buildImmersionHeaterContributions)(immersionInput());
        strict_1.default.equal(flexible.deadlineIso, null);
    });
    (0, node_test_1.it)("uses estimated empty_at as soft planning deadline when learning is degraded", () => {
        const [, flexible] = (0, immersion_heater_1.buildImmersionHeaterContributions)(immersionInput({
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
        }));
        strict_1.default.equal(flexible.enabled, true);
        strict_1.default.equal(flexible.deadlineIso, "2026-07-26T14:00:00.000Z");
        strict_1.default.equal(flexible.details.emptyAtSource, "estimated");
        strict_1.default.equal(flexible.quality.status, "degraded");
    });
    (0, node_test_1.it)("adopts the learned estimated_empty_at as deadline when model valid", () => {
        const [, flexible] = (0, immersion_heater_1.buildImmersionHeaterContributions)(immersionInput({
            bufferTempC: 49,
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
        }));
        strict_1.default.equal(flexible.deadlineIso, "2026-07-26T14:00:00.000Z");
        strict_1.default.equal(flexible.details.thermalLearningStatus, "valid");
        strict_1.default.equal(flexible.details.emptyAtSource, "learned");
        strict_1.default.equal(flexible.details.estimatedEmptyAt, "2026-07-26T14:00:00.000Z");
        strict_1.default.equal(flexible.details.coolingRateCPerHAvg, 1.1);
    });
    (0, node_test_1.it)("keeps empty_at deadline for comfort reheat when learning is valid (strategic preload)", () => {
        const [, flexible] = (0, immersion_heater_1.buildImmersionHeaterContributions)(immersionInput({
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
        }));
        strict_1.default.equal(flexible.enabled, true);
        strict_1.default.equal(flexible.deadlineIso, "2026-07-26T14:00:00.000Z");
        strict_1.default.equal(flexible.details.emptyAtSource, "learned");
    });
    (0, node_test_1.it)("night bridge raises target and sets deadline when empty_at is before next morning", () => {
        const now = new Date("2026-08-04T12:00:00.000Z"); // 14:00 CEST
        const [, flexible] = (0, immersion_heater_1.buildImmersionHeaterContributions)(immersionInput({
            now,
            bufferTempC: 47,
            timezone: "Europe/Berlin",
            config: (0, device_config_1.immersionDeviceConfigFromAdapter)({
                ih_stage_count: 1,
                ih_stage_1_set_state: "relay.0.heater",
                ih_stage_1_nominal_power_w: 2000,
                ih_buffer_temp_c_target: "sensor.0.temp",
                ih_buffer_temp_c_enabled: true,
                ih_planning_min_temp_c: 44,
                ih_planning_max_temp_c: 63,
            }),
            thermalLearning: {
                status: "valid",
                health: "ok",
                samples: 12,
                coolingRateCPerHAvg: 1.0,
                coolingConstantPerH: 0.04,
                coolingAsymptoteC: 18,
                estimatedRemainingHours: 3.5,
                estimatedEmptyAt: "2026-08-04T18:26:00.000Z", // 20:26 CEST
                currentDayTypeRuntimeHoursMedian: 12,
                reasonDe: "belastbares Modell",
            },
        }));
        strict_1.default.equal(flexible.enabled, true);
        strict_1.default.equal(flexible.deadlineIso, "2026-08-04T18:26:00.000Z");
        strict_1.default.equal(flexible.details.nightBridgeActive, true);
        strict_1.default.ok(flexible.details.targetTempC > 51.6);
        strict_1.default.ok(flexible.details.requiredEnergyKwh > 1);
        strict_1.default.match(flexible.reasonDe, /Nachtbrücke/);
    });
    (0, node_test_1.it)("does not set a deadline when the flexible contribution is disabled anyway", () => {
        const [, flexible] = (0, immersion_heater_1.buildImmersionHeaterContributions)(immersionInput({
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
        }));
        strict_1.default.equal(flexible.enabled, false);
        strict_1.default.equal(flexible.deadlineIso, null);
    });
    (0, node_test_1.it)("exposes missing learning status in details when no thermal-runtime signal is supplied", () => {
        const [mandatory, flexible] = (0, immersion_heater_1.buildImmersionHeaterContributions)(immersionInput());
        strict_1.default.equal(mandatory.details.thermalLearningStatus, "missing");
        strict_1.default.equal(flexible.details.thermalLearningStatus, "missing");
    });
});
(0, node_test_1.describe)("air conditioning contributions", () => {
    (0, node_test_1.it)("creates five unit contributions", () => {
        const all = (0, air_conditioning_1.buildAirConditioningContributions)(acInput());
        strict_1.default.equal(all.length, constants_1.AC_UNIT_COUNT);
        strict_1.default.equal(all[0].contributionId, "air_conditioning.unit_1");
        strict_1.default.equal(all[4].contributionId, "air_conditioning.unit_5");
    });
    (0, node_test_1.it)("excludes disabled unit", () => {
        const all = (0, air_conditioning_1.buildAirConditioningContributions)(acInput({
            acConfig: (0, config_1.acGlobalConfigFromAdapter)({ ac_u2_enabled: false }),
        }));
        const unit2 = all.find((c) => c.contributionId === "air_conditioning.unit_2");
        strict_1.default.equal(unit2?.enabled, false);
    });
    (0, node_test_1.it)("unit with cooling demand enabled", () => {
        const all = (0, air_conditioning_1.buildAirConditioningContributions)(acInput());
        const unit1 = all.find((c) => c.contributionId === "air_conditioning.unit_1");
        strict_1.default.equal(unit1?.flow, "consume");
        strict_1.default.ok(unit1?.details.expectedKwhToday !== undefined);
        strict_1.default.ok(unit1?.details.requiredEnergyKwh > 0);
        strict_1.default.equal(unit1?.details.timeAllocation, false);
        strict_1.default.equal(unit1?.slots.length, 0);
    });
    (0, node_test_1.it)("degrades when room temp missing", () => {
        const input = acInput();
        input.units[0].roomTempC = null;
        const unit1 = (0, air_conditioning_1.buildAirConditioningContributions)(input).find((c) => c.contributionId === "air_conditioning.unit_1");
        strict_1.default.equal(unit1?.quality.status, "degraded");
    });
    (0, node_test_1.it)("governance off excludes active units", () => {
        const all = (0, air_conditioning_1.buildAirConditioningContributions)(acInput({ governanceEnabled: false }));
        strict_1.default.ok(all.every((c) => !c.enabled));
    });
    (0, node_test_1.it)("runtime no longer documents governance gap after v0.1.130", () => {
        const unit1 = (0, air_conditioning_1.buildAirConditioningContributions)(acInput()).find((c) => c.contributionId === "air_conditioning.unit_1");
        strict_1.default.equal(unit1?.details.runtimeGovernanceGap, undefined);
    });
});
(0, node_test_1.describe)("flexible build orchestration", () => {
    (0, node_test_1.it)("produces unique contribution ids", () => {
        const all = (0, build_1.buildFlexibleContributions)({
            battery: batteryInput(),
            wallbox: wallboxInput(),
            immersion: immersionInput(),
            airConditioning: acInput(),
        });
        const ids = all.map((c) => c.contributionId);
        strict_1.default.equal(new Set(ids).size, ids.length);
    });
    (0, node_test_1.it)("revision payload ignores generatedAt", () => {
        const input = {
            battery: batteryInput(),
            wallbox: wallboxInput(),
            immersion: immersionInput(),
            airConditioning: acInput(),
        };
        const a = (0, build_1.buildFlexibleContributions)(input);
        const contributionsWithNewTimestamp = (0, build_1.buildFlexibleContributions)(input).map((c) => ({
            ...c,
            generatedAt: new Date("2026-07-11T10:05:00.000Z").toISOString(),
        }));
        strict_1.default.equal((0, types_1.flexibleContributionsRevisionPayload)(a), (0, types_1.flexibleContributionsRevisionPayload)(contributionsWithNewTimestamp));
    });
});
