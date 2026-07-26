"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAirConditioningContributions = void 0;
const constants_1 = require("../../../addons/air_conditioning/constants");
const cooling_1 = require("../../planning/cooling");
const contribution_ids_1 = require("../../contribution_ids");
const quality_1 = require("../../quality");
const contributor_1 = require("../../contributor");
const types_1 = require("../types");
const flex_demand_1 = require("./flex_demand");
const types_2 = require("./types");
function buildUnitContribution(input, unitInput, forecast) {
    const generatedAt = input.now.toISOString();
    const unit = unitInput.unit;
    const contributionId = (0, contribution_ids_1.acUnitContributionId)(unit.index);
    if (!unit.enabled) {
        return (0, types_1.baseContribution)(contributionId, (0, contributor_1.addonContributorRef)("air_conditioning"), "consume", ["demand_flex", "dispatch"], {
            generatedAt,
            validUntil: null,
            revision: 1,
            enabled: false,
            flexible: true,
            gridEligible: false,
            quality: (0, quality_1.operatorQuality)("disabled", `Unit ${unit.index} deaktiviert.`),
            reasonDe: `Klima-Unit ${unit.name} deaktiviert.`,
            details: { unitIndex: unit.index, unitEnabled: false },
            slots: [],
        });
    }
    const participation = (0, types_2.evaluateParticipation)({
        addonEnabled: input.addonEnabled,
        governanceEnabled: input.governanceEnabled,
        configured: true,
        mappingsReady: unitInput.mappingsReady,
        fault: unitInput.fault,
        lockout: unitInput.lockout || unitInput.cleaningBlocked,
        globalModeOff: input.globalModeOff,
    });
    const hasDemand = forecast.likelyActive && forecast.expectedKwh > 0;
    let status = participation.status;
    let reasonDe = forecast.reasonDe;
    if (participation.allowed && unitInput.roomTempC === null) {
        status = "degraded";
        reasonDe = "Raumtemperatur fehlt — Kühlbedarf eingeschränkt.";
    }
    else if (participation.allowed && !hasDemand) {
        status = "disabled";
        reasonDe = forecast.reasonDe || "Kein Kühlbedarf.";
    }
    else if (participation.allowed) {
        status = participation.status === "degraded" ? "degraded" : "valid";
    }
    const enabled = participation.allowed && hasDemand;
    const requiredEnergyKwh = hasDemand ? (0, types_2.round3)(forecast.expectedKwh) : null;
    const maxPowerW = forecast.powerW > 0 ? forecast.powerW : null;
    const quality = (0, quality_1.operatorQuality)(status, reasonDe);
    return (0, types_1.baseContribution)(contributionId, (0, contributor_1.addonContributorRef)("air_conditioning"), "consume", ["demand_flex", "dispatch"], {
        generatedAt,
        validUntil: null,
        revision: 1,
        enabled,
        flexible: true,
        gridEligible: input.modePolicy.mode !== "eco" && !input.globalModeOff,
        quality,
        reasonDe,
        details: {
            unitIndex: unit.index,
            unitName: unit.name,
            roomTempC: unitInput.roomTempC,
            onTempC: unit.onTempC,
            offTempC: unit.offTempC,
            expectedKwhToday: (0, types_2.round3)(forecast.expectedKwh),
            requiredEnergyKwh,
            expectedPeakW: forecast.powerW,
            minPowerW: maxPowerW,
            maxPowerW,
            powerSource: forecast.powerSource,
            likelyActive: forecast.likelyActive,
            outdoorTempC: input.outdoorTempC,
            governanceEnabled: input.governanceEnabled,
        },
        slots: (0, flex_demand_1.buildFlexibleDemandSlot)({
            generatedAt,
            requiredEnergyKwh,
            maxPowerW,
            minPowerW: maxPowerW,
            available: enabled,
            quality,
            reasonDe,
        }),
    });
}
function buildAirConditioningContributions(input) {
    const unitInputs = input.units
        .filter((u) => u.unit.enabled)
        .map((u) => ({
        unit: u.unit,
        roomTempC: u.roomTempC,
        consumerStats: u.consumerStats,
    }));
    const cooling = (0, cooling_1.planCooling)({
        now: input.now,
        acConfig: input.acConfig,
        governanceEnabled: input.governanceEnabled,
        outdoorTempC: input.outdoorTempC,
        units: unitInputs,
    });
    const byIndex = new Map(cooling.units.map((u) => [u.unitIndex, u]));
    const contributions = [];
    for (let i = 1; i <= constants_1.AC_UNIT_COUNT; i++) {
        const unitInput = input.units.find((u) => u.unit.index === i);
        if (!unitInput)
            continue;
        const forecast = byIndex.get(i) ?? {
            unitIndex: i,
            name: unitInput.unit.name,
            powerW: unitInput.unit.estimatedPowerW,
            powerSource: "config",
            likelyActive: false,
            expectedHours: 0,
            expectedKwh: 0,
            reasonDe: "Unit nicht im Kühlplan.",
        };
        contributions.push(buildUnitContribution(input, unitInput, forecast));
    }
    return contributions;
}
exports.buildAirConditioningContributions = buildAirConditioningContributions;
