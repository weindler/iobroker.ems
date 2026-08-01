"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildWallboxEvSessionContribution = exports.resolveWallboxTargetSocPct = void 0;
const contribution_ids_1 = require("../../contribution_ids");
const quality_1 = require("../../quality");
const contributor_1 = require("../../contributor");
const types_1 = require("../types");
const types_2 = require("./types");
/** Ziel-SOC nur bei aktivem Plan mit positivem planSoc, sonst effectiveLimit/fallback. */
function resolveWallboxTargetSocPct(input) {
    if (input.planActive && input.planSocPct !== null && input.planSocPct > 0) {
        return input.planSocPct;
    }
    const effective = input.effectiveLimitSocPct;
    if (effective !== null && effective !== undefined && effective > 0) {
        return effective;
    }
    const fallback = input.fallbackTargetSocPct;
    if (fallback !== null && fallback !== undefined && fallback > 0) {
        return fallback;
    }
    return null;
}
exports.resolveWallboxTargetSocPct = resolveWallboxTargetSocPct;
function requiredEnergyKwh(input) {
    if (input.remainingEnergyKwh !== null && Number.isFinite(input.remainingEnergyKwh)) {
        return (0, types_2.round3)(Math.max(0, input.remainingEnergyKwh));
    }
    const targetSoc = resolveWallboxTargetSocPct(input);
    if (targetSoc !== null &&
        input.vehicleSocPct !== null &&
        input.vehicleCapacityKwh !== null &&
        input.vehicleCapacityKwh > 0) {
        const delta = targetSoc - input.vehicleSocPct;
        if (delta <= 0)
            return 0;
        return (0, types_2.round3)((delta / 100) * input.vehicleCapacityKwh);
    }
    return null;
}
function degradedReasonDe(input, requiredKwh) {
    const hasRemaining = input.remainingEnergyKwh !== null && Number.isFinite(input.remainingEnergyKwh);
    const hasCapacity = input.vehicleCapacityKwh !== null &&
        Number.isFinite(input.vehicleCapacityKwh) &&
        input.vehicleCapacityKwh > 0;
    const targetSoc = resolveWallboxTargetSocPct(input);
    if (!hasRemaining && !hasCapacity) {
        return "Fahrzeug verbunden, aber Restenergie und Fahrzeugkapazität fehlen — Ladebedarf nicht bestimmbar.";
    }
    if (!hasRemaining && hasCapacity && targetSoc === null) {
        return "Fahrzeug verbunden, aber kein gültiges Ladeziel (Plan inaktiv/0, kein effectiveLimit) — Bedarf nicht berechenbar.";
    }
    if (!hasRemaining && hasCapacity && input.vehicleSocPct === null) {
        return "Fahrzeugkapazität bekannt, aber Fahrzeug-SOC fehlt — Restenergie nicht berechenbar.";
    }
    if (requiredKwh === null && (input.planActive || input.planSocPct !== null)) {
        return "Plan/Ziel vorhanden, aber Restenergie ohne belastbare Telemetrie nicht berechenbar.";
    }
    return "Fahrzeug verbunden, aber Ladebedarf nicht belastbar bestimmbar.";
}
function gridEligible(input) {
    if (!input.gridForecast?.gridImportAllowed)
        return false;
    if (input.globalModeOff || !input.modePolicy.allowOptimization)
        return false;
    return true;
}
function buildWallboxEvSessionContribution(input) {
    const generatedAt = input.now.toISOString();
    if (!input.connected) {
        return (0, types_1.baseContribution)(contribution_ids_1.CONTRIBUTION_IDS.WALLBOX_EV_SESSION, (0, contributor_1.addonContributorRef)("wallbox"), "consume", ["demand_flex", "dispatch"], {
            generatedAt,
            validUntil: null,
            revision: 1,
            enabled: false,
            flexible: true,
            gridEligible: false,
            quality: (0, quality_1.operatorQuality)("disabled", "Fahrzeug nicht verbunden."),
            reasonDe: "Fahrzeug nicht verbunden — keine EV-Lade-Contribution.",
            details: {
                connected: false,
                vehicleSocPct: input.vehicleSocPct,
                runtimeControlAvailable: false,
            },
            slots: [],
        });
    }
    const participation = (0, types_2.evaluateParticipation)({
        addonEnabled: input.addonEnabled,
        governanceEnabled: input.governanceEnabled,
        configured: input.evccConfigured,
        mappingsReady: input.evccConfigured,
        fault: false,
        lockout: false,
        globalModeOff: input.globalModeOff,
    });
    const requiredKwh = requiredEnergyKwh(input);
    const fromPhases = (0, types_2.wallboxMaxChargePowerW)(input.activePhases, input.maxCurrentA);
    const vehicleCap = input.vehicleMaxAcChargePowerW !== null &&
        input.vehicleMaxAcChargePowerW !== undefined &&
        input.vehicleMaxAcChargePowerW > 0
        ? input.vehicleMaxAcChargePowerW
        : null;
    const maxW = fromPhases !== null && vehicleCap !== null
        ? Math.min(fromPhases, vehicleCap)
        : (fromPhases ?? vehicleCap);
    let status = participation.status;
    let reasonDe = participation.reasonDe;
    if (participation.allowed) {
        if (requiredKwh === null && input.vehicleSocPct === null && input.sessionEnergyKwh === null) {
            status = "degraded";
            reasonDe = degradedReasonDe(input, requiredKwh);
        }
        else if (requiredKwh === null) {
            status = "degraded";
            reasonDe = degradedReasonDe(input, requiredKwh);
        }
        else {
            status = participation.status === "degraded" ? "degraded" : "valid";
            reasonDe = `EV-Ladesitzung — Bedarf ${(0, types_2.round3)(requiredKwh)} kWh.`;
        }
    }
    const enabled = participation.allowed && input.connected;
    return (0, types_1.baseContribution)(contribution_ids_1.CONTRIBUTION_IDS.WALLBOX_EV_SESSION, (0, contributor_1.addonContributorRef)("wallbox"), "consume", ["demand_flex", "dispatch"], {
        generatedAt,
        validUntil: input.deadlineIso,
        revision: 1,
        enabled,
        flexible: true,
        gridEligible: gridEligible(input),
        deadlineIso: input.deadlineIso,
        quality: (0, quality_1.operatorQuality)(status, reasonDe),
        reasonDe,
        details: {
            connected: input.connected,
            charging: input.charging,
            vehicleSocPct: input.vehicleSocPct,
            planSocPct: input.planSocPct,
            planActive: input.planActive,
            sessionEnergyKwh: input.sessionEnergyKwh,
            remainingEnergyKwh: input.remainingEnergyKwh,
            effectiveLimitSocPct: input.effectiveLimitSocPct ?? null,
            requiredEnergyKwh: requiredKwh,
            maxChargePowerW: maxW,
            activePhases: input.activePhases,
            maxCurrentA: input.maxCurrentA,
            runtimeControlAvailable: false,
        },
        slots: maxW !== null && enabled
            ? [
                {
                    slot: { startIso: generatedAt, endIso: input.deadlineIso ?? generatedAt },
                    minPowerW: null,
                    preferredPowerW: null,
                    maxPowerW: maxW,
                    requiredEnergyKwh: requiredKwh,
                    availableEnergyKwh: null,
                    priceCtPerKwh: null,
                    available: true,
                    mandatory: false,
                    quality: (0, quality_1.operatorQuality)(status, "Technische Ladeverfügbarkeit."),
                },
            ]
            : [],
    });
}
exports.buildWallboxEvSessionContribution = buildWallboxEvSessionContribution;
