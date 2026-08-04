"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildImmersionHeaterContributions = exports.buildImmersionFlexibleContribution = exports.buildImmersionMandatoryContribution = void 0;
const reheat_hysteresis_1 = require("../../../addons/immersion_heater/runtime/reheat_hysteresis");
const thermal_forecast_1 = require("../../planning/thermal_forecast");
const contribution_ids_1 = require("../../contribution_ids");
const quality_1 = require("../../quality");
const contributor_1 = require("../../contributor");
const types_1 = require("../types");
const flex_demand_1 = require("./flex_demand");
const immersion_night_bridge_1 = require("./immersion_night_bridge");
const types_2 = require("./types");
function learningMargin(input) {
    if (!input.thermalLearning)
        return null;
    return {
        status: input.thermalLearning.status,
        coolingRateCPerHAvg: input.thermalLearning.coolingRateCPerHAvg,
    };
}
function thermalLearningDetails(input) {
    const learning = input.thermalLearning ?? null;
    return {
        thermalLearningStatus: learning?.status ?? "missing",
        thermalLearningHealth: learning?.health ?? null,
        thermalLearningSamples: learning?.samples ?? null,
        coolingRateCPerHAvg: learning?.coolingRateCPerHAvg ?? null,
        estimatedRemainingHours: learning?.estimatedRemainingHours ?? null,
        estimatedEmptyAt: learning?.estimatedEmptyAt ?? null,
        learnedDayTypeRuntimeHoursMedian: learning?.currentDayTypeRuntimeHoursMedian ?? null,
    };
}
function enabledStages(config) {
    return config.stages.filter((s) => s.enabled && s.nominalPowerW > 0 && s.setStateId);
}
/** Nennleistungen für Planung — auch wenn setStateId noch fehlt (Participation sperrt dann separat). */
function poweredStages(config) {
    return config.stages.filter((s) => s.enabled && s.nominalPowerW > 0);
}
function maxStagePowerW(config) {
    const stages = poweredStages(config);
    if (stages.length === 0)
        return null;
    return Math.max(...stages.map((s) => s.nominalPowerW));
}
function minStagePowerW(config) {
    const stages = poweredStages(config);
    if (stages.length === 0)
        return null;
    return Math.min(...stages.map((s) => s.nominalPowerW));
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
    const minW = minStagePowerW(input.config);
    const enabled = mandatory && participation.allowed && !input.globalModeOff;
    const mandatoryTargetC = input.thermalMode === "force"
        ? input.config.planningMaxTempC
        : input.config.planningMinTempC;
    const requiredEnergyKwh = mandatory && input.bufferTempC !== null && maxW !== null
        ? (0, flex_demand_1.estimateImmersionRequiredEnergyKwh)(input.bufferTempC, mandatoryTargetC, maxW, learningMargin(input))
        : null;
    const quality = (0, quality_1.operatorQuality)(!mandatory ? "disabled" : enabled ? "valid" : participation.status, mandatory ? (mandatoryReason ?? "") : "Kein Pflichtbedarf.");
    return (0, types_1.baseContribution)(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_MANDATORY, (0, contributor_1.addonContributorRef)("immersion_heater"), "consume", ["demand_flex", "dispatch"], {
        generatedAt,
        validUntil: null,
        revision: 1,
        enabled,
        flexible: false,
        gridEligible: false,
        quality,
        reasonDe: mandatory ? (mandatoryReason ?? "") : "Kein Pflichtbedarf für Heizstab.",
        details: {
            bufferTempC: input.bufferTempC,
            mandatoryMinTempC: input.config.planningMinTempC,
            targetTempC: target.targetTempC,
            targetReasonDe: target.targetReasonDe,
            requiredEnergyKwh,
            maxPowerW: maxW,
            minPowerW: minW,
            thermalMode: input.thermalMode,
            mandatory: true,
            batteryEligible: true,
            ...thermalLearningDetails(input),
        },
        slots: (0, flex_demand_1.buildFlexibleDemandSlot)({
            generatedAt,
            requiredEnergyKwh,
            maxPowerW: maxW,
            minPowerW: minW,
            available: enabled,
            mandatory: true,
            quality,
            reasonDe: mandatoryReason ?? "Pflichtbedarf.",
        }),
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
    const maxW = maxStagePowerW(input.config);
    const minW = minStagePowerW(input.config);
    /*
     * Nachtbrücke aus Thermal Learning: reicht estimated_empty_at nicht bis zum nächsten Morgen,
     * Ziel anheben + Deadline = empty_at — Allocation priorisiert PV-Surplus vor der Nacht
     * (Soft-Rest nach Deadline bleibt in allocation.ts für pvFirst erhalten).
     */
    const nightBridge = input.bufferTempC !== null &&
        input.thermalLearning?.status === "valid" &&
        input.thermalLearning.estimatedEmptyAt &&
        input.thermalLearning.coolingRateCPerHAvg !== null
        ? (0, immersion_night_bridge_1.resolveImmersionNightBridge)({
            now: input.now,
            bufferTempC: input.bufferTempC,
            planningMinTempC: input.config.planningMinTempC,
            planningMaxTempC: input.config.planningMaxTempC,
            forecastTargetTempC: target.targetTempC,
            coolingRateCPerHAvg: input.thermalLearning.coolingRateCPerHAvg,
            estimatedEmptyAtIso: input.thermalLearning.estimatedEmptyAt,
            timezone: input.timezone,
        })
        : null;
    const effectiveTargetTempC = nightBridge?.active
        ? nightBridge.effectiveTargetTempC
        : target.targetTempC;
    const bridgeOverridesHysteresis = nightBridge?.active === true;
    const hysteresisActive = (0, reheat_hysteresis_1.isImmersionReheatHysteresisActive)({
        bufferTempC: input.bufferTempC,
        targetTempC: target.targetTempC,
        hysteresisK: input.config.temperatureHysteresisK,
        autoTargetReached: input.autoTargetReached === true,
    });
    const atEffectiveTarget = input.bufferTempC !== null &&
        (input.bufferTempC >= input.config.planningMaxTempC || input.bufferTempC >= effectiveTargetTempC);
    const autoReady = participation.allowed &&
        input.thermalMode === "auto" &&
        input.modePolicy.allowThermalAuto &&
        !atEffectiveTarget &&
        (!hysteresisActive || bridgeOverridesHysteresis);
    const requiredEnergyKwh = autoReady && input.bufferTempC !== null && maxW !== null
        ? (0, flex_demand_1.estimateImmersionRequiredEnergyKwh)(input.bufferTempC, effectiveTargetTempC, maxW, learningMargin(input))
        : null;
    let status = autoReady ? "valid" : "disabled";
    let reasonDe = "Kein flexibler Heizstab-Bedarf.";
    if (participation.allowed && input.thermalMode !== "auto") {
        status = "disabled";
        reasonDe = `Heizstab-Modus „${input.thermalMode}“ — flexibler Beitrag nur bei auto.`;
    }
    else if (atEffectiveTarget) {
        status = "disabled";
        reasonDe = "Zieltemperatur erreicht — kein flexibler Bedarf.";
    }
    else if (hysteresisActive && !bridgeOverridesHysteresis) {
        status = "disabled";
        const reheatAt = (0, types_2.round3)(target.targetTempC - Math.max(0, input.config.temperatureHysteresisK));
        reasonDe = `Wiedereinschalt-Hysterese aktiv — erst unter ${reheatAt} °C wieder planen (Buf ${(0, types_2.round3)(input.bufferTempC)} °C, Ziel ${target.targetTempC} °C, ${input.config.temperatureHysteresisK} K).`;
    }
    else if (autoReady && requiredEnergyKwh !== null && requiredEnergyKwh <= 0) {
        status = "disabled";
        reasonDe = "Zieltemperatur erreicht — kein flexibler Bedarf.";
    }
    else if (autoReady && input.bufferTempC === null) {
        status = "degraded";
        reasonDe = "Puffertemperatur fehlt — flexibler Bedarf nicht belastbar.";
    }
    else if (autoReady) {
        reasonDe = `Flexibler Warmwasserbedarf bis ${effectiveTargetTempC} °C (${requiredEnergyKwh?.toFixed(1) ?? "?"} kWh, PV-first).`;
        if (nightBridge?.active)
            reasonDe = `${reasonDe} ${nightBridge.reasonDe}`;
    }
    else if (!participation.allowed) {
        status = participation.status;
        reasonDe = participation.reasonDe;
    }
    const enabled = autoReady &&
        requiredEnergyKwh !== null &&
        requiredEnergyKwh > 0 &&
        input.bufferTempC !== null;
    const quality = (0, quality_1.operatorQuality)(status, reasonDe);
    /*
     * Deadline-Priorität:
     * 1) Nachtbrücke (empty_at vor Morgen) — auch klar über planningMin
     * 2) sonst gelernte empty_at nur nahe Pflicht-Untergrenze (Comfort ohne Brücke bleibt ohne Deadline,
     *    Soft-Post-Deadline in Allocation verhindert das frühere „PV nach Deadline verpassen“)
     */
    const DEADLINE_APPROACH_K = 2;
    const nearMandatoryFloor = input.bufferTempC !== null &&
        input.bufferTempC <= input.config.planningMinTempC + DEADLINE_APPROACH_K;
    const nearFloorDeadlineIso = enabled &&
        !nightBridge?.active &&
        nearMandatoryFloor &&
        input.thermalLearning?.status === "valid"
        ? input.thermalLearning.estimatedEmptyAt
        : null;
    const learningDeadlineIso = enabled && nightBridge?.active ? nightBridge.deadlineIso : nearFloorDeadlineIso;
    if (enabled && learningDeadlineIso && !nightBridge?.active) {
        reasonDe = `${reasonDe} Gelernte Pflichtgrenze voraussichtlich ${learningDeadlineIso}.`;
    }
    return (0, types_1.baseContribution)(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, (0, contributor_1.addonContributorRef)("immersion_heater"), "consume", ["demand_flex", "dispatch"], {
        generatedAt,
        validUntil: null,
        revision: 1,
        enabled,
        flexible: true,
        gridEligible: false,
        deadlineIso: learningDeadlineIso,
        quality,
        reasonDe,
        details: {
            bufferTempC: input.bufferTempC,
            targetTempC: effectiveTargetTempC,
            forecastTargetTempC: target.targetTempC,
            targetReasonDe: nightBridge?.active
                ? `${target.targetReasonDe} ${nightBridge.reasonDe}`
                : target.targetReasonDe,
            requiredEnergyKwh,
            maxPowerW: maxW,
            minPowerW: minW,
            pvFirst: true,
            forecastActive: target.forecastActive,
            minimumRuntimeSec: input.config.minimumRuntimeSec,
            batteryEligible: true,
            autoTargetReached: input.autoTargetReached === true,
            reheatHysteresisActive: hysteresisActive && !bridgeOverridesHysteresis,
            reheatHysteresisK: input.config.temperatureHysteresisK,
            nightBridgeActive: nightBridge?.active === true,
            nightBridgeUntilIso: nightBridge?.bridgeUntilIso ?? null,
            nightBridgeTargetTempC: nightBridge?.bridgeTargetTempC ?? null,
            nightBridgeShortfallHours: nightBridge?.shortfallHours ?? null,
            ...thermalLearningDetails(input),
        },
        slots: (0, flex_demand_1.buildFlexibleDemandSlot)({
            generatedAt,
            requiredEnergyKwh,
            maxPowerW: maxW,
            minPowerW: minW,
            available: enabled,
            quality,
            reasonDe,
        }),
    });
}
exports.buildImmersionFlexibleContribution = buildImmersionFlexibleContribution;
function buildImmersionHeaterContributions(input) {
    return [buildImmersionMandatoryContribution(input), buildImmersionFlexibleContribution(input)];
}
exports.buildImmersionHeaterContributions = buildImmersionHeaterContributions;
