"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildImmersionHeaterContributions = exports.buildImmersionFlexibleContribution = exports.buildImmersionMandatoryContribution = void 0;
const thermal_forecast_1 = require("../../../planner/rules/thermal_forecast");
const contribution_ids_1 = require("../../contribution_ids");
const quality_1 = require("../../quality");
const contributor_1 = require("../../contributor");
const types_1 = require("../types");
const types_2 = require("./types");
function enabledStages(config) {
    return config.stages.filter((s) => s.enabled && s.nominalPowerW > 0 && s.setStateId);
}
function maxStagePowerW(config) {
    const stages = enabledStages(config);
    if (stages.length === 0)
        return null;
    return Math.max(...stages.map((s) => s.nominalPowerW));
}
function buildImmersionMandatoryContribution(input) {
    const generatedAt = input.now.toISOString();
    const target = (0, thermal_forecast_1.resolveThermalForecastTarget)({
        config: input.config,
        bufferTempC: input.bufferTempC,
        pvTodayKwh: input.pvTodayKwh,
        pvTomorrowKwh: input.pvTomorrowKwh,
        pvBiasStatus: input.pvBiasStatus,
        forecastModeEnabled: input.forecastModeEnabled,
        aiOptimizationAllowed: input.aiOptimizationAllowed,
    });
    const mandatoryReason = input.thermalMode === "force"
        ? "Betreiberbefehl force — Pflichtbedarf."
        : input.bufferTempC !== null && input.bufferTempC < input.config.planningMinTempC
            ? `Puffer ${(0, types_2.round3)(input.bufferTempC)} °C unter Pflicht-Untergrenze ${input.config.planningMinTempC} °C.`
            : null;
    const participation = (0, types_2.evaluateParticipation)({
        addonEnabled: input.addonEnabled,
        governanceEnabled: input.governanceEnabled,
        configured: enabledStages(input.config).length > 0,
        mappingsReady: input.relayMapped,
        fault: input.fault,
        lockout: input.lockout,
        globalModeOff: input.globalModeOff,
        telemetryValid: input.bufferTempC !== null,
    });
    const mandatory = mandatoryReason !== null;
    const maxW = maxStagePowerW(input.config);
    const enabled = mandatory && participation.allowed && !input.globalModeOff;
    return (0, types_1.baseContribution)(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_MANDATORY, (0, contributor_1.addonContributorRef)("immersion_heater"), "consume", ["demand_flex", "dispatch"], {
        generatedAt,
        validUntil: null,
        revision: 1,
        enabled,
        flexible: false,
        gridEligible: false,
        quality: (0, quality_1.operatorQuality)(!mandatory ? "disabled" : enabled ? "valid" : participation.status, mandatory ? (mandatoryReason ?? "") : "Kein Pflichtbedarf."),
        reasonDe: mandatory ? (mandatoryReason ?? "") : "Kein Pflichtbedarf für Heizstab.",
        details: {
            bufferTempC: input.bufferTempC,
            mandatoryMinTempC: input.config.planningMinTempC,
            targetTempC: target.targetTempC,
            maxPowerW: maxW,
            thermalMode: input.thermalMode,
            mandatory: true,
        },
        slots: [],
    });
}
exports.buildImmersionMandatoryContribution = buildImmersionMandatoryContribution;
function buildImmersionFlexibleContribution(input) {
    const generatedAt = input.now.toISOString();
    const target = (0, thermal_forecast_1.resolveThermalForecastTarget)({
        config: input.config,
        bufferTempC: input.bufferTempC,
        pvTodayKwh: input.pvTodayKwh,
        pvTomorrowKwh: input.pvTomorrowKwh,
        pvBiasStatus: input.pvBiasStatus,
        forecastModeEnabled: input.forecastModeEnabled,
        aiOptimizationAllowed: input.aiOptimizationAllowed,
    });
    const participation = (0, types_2.evaluateParticipation)({
        addonEnabled: input.addonEnabled,
        governanceEnabled: input.governanceEnabled,
        configured: enabledStages(input.config).length > 0,
        mappingsReady: input.relayMapped,
        fault: input.fault,
        lockout: input.lockout,
        globalModeOff: input.globalModeOff,
    });
    const atTarget = input.bufferTempC !== null &&
        (input.bufferTempC >= input.config.planningMaxTempC || input.bufferTempC >= target.targetTempC);
    const autoReady = participation.allowed &&
        input.thermalMode === "auto" &&
        input.modePolicy.allowThermalAuto &&
        !atTarget;
    const maxW = maxStagePowerW(input.config);
    let status = autoReady ? "valid" : "disabled";
    let reasonDe = "Kein flexibler Heizstab-Bedarf.";
    if (participation.allowed && input.thermalMode !== "auto") {
        status = "disabled";
        reasonDe = `Heizstab-Modus „${input.thermalMode}“ — flexibler Beitrag nur bei auto.`;
    }
    else if (atTarget) {
        status = "disabled";
        reasonDe = "Zieltemperatur erreicht — kein flexibler Bedarf.";
    }
    else if (autoReady) {
        reasonDe = `Flexibler Warmwasserbedarf bis ${target.targetTempC} °C (PV-first).`;
    }
    else if (!participation.allowed) {
        status = participation.status;
        reasonDe = participation.reasonDe;
    }
    return (0, types_1.baseContribution)(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, (0, contributor_1.addonContributorRef)("immersion_heater"), "consume", ["demand_flex", "dispatch"], {
        generatedAt,
        validUntil: null,
        revision: 1,
        enabled: autoReady,
        flexible: true,
        gridEligible: false,
        quality: (0, quality_1.operatorQuality)(status, reasonDe),
        reasonDe,
        details: {
            bufferTempC: input.bufferTempC,
            targetTempC: target.targetTempC,
            maxPowerW: maxW,
            pvFirst: true,
            forecastActive: target.forecastActive,
            minimumRuntimeSec: input.config.minimumRuntimeSec,
        },
        slots: [],
    });
}
exports.buildImmersionFlexibleContribution = buildImmersionFlexibleContribution;
function buildImmersionHeaterContributions(input) {
    return [buildImmersionMandatoryContribution(input), buildImmersionFlexibleContribution(input)];
}
exports.buildImmersionHeaterContributions = buildImmersionHeaterContributions;
