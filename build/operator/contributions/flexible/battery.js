"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBatteryContributions = exports.buildBatteryReserveContribution = exports.buildBatteryDischargeContribution = exports.buildBatteryChargeContribution = void 0;
const capacity_1 = require("../../../addons/battery/core/capacity");
const contribution_ids_1 = require("../../contribution_ids");
const quality_1 = require("../../quality");
const contributor_1 = require("../../contributor");
const types_1 = require("../types");
const types_2 = require("./types");
/** Top-Off durch Nutzer-Intent ODER gelerntes Intervall (`topoff_due`) überschritten. */
function learnedTopoffDue(input) {
    return input.batteryLearning?.status === "valid" && input.batteryLearning.topoffDue === true;
}
function deficitChargeSocTarget(input) {
    if (!input.chargeLogic?.active)
        return null;
    return input.chargeLogic.socTargetPct;
}
/** Höchstes Ziel aus Policy, Top-Off und PV-Defizit-Ladelogik — nie niedriger als die Policy. */
function chargeTargetSocPct(input) {
    if (input.topOffRequested || learnedTopoffDue(input))
        return 100;
    const deficitTarget = deficitChargeSocTarget(input);
    if (deficitTarget !== null)
        return Math.max(deficitTarget, input.modePolicy.chargeTargetSocPct);
    return input.modePolicy.chargeTargetSocPct;
}
function batteryLearningDetails(input) {
    const learning = input.batteryLearning ?? null;
    return {
        batteryLearningStatus: learning?.status ?? "missing",
        avgNightDischargeKwh: learning?.avgNightDischargeKwh ?? null,
        avgChargePowerW: learning?.avgChargePowerW ?? null,
        topoffDueLearned: learning?.topoffDue ?? null,
        topoffDaysRemaining: learning?.topoffDaysRemaining ?? null,
        estimatedRuntimeDays: learning?.estimatedRuntimeDays ?? null,
    };
}
function chargeLogicDetails(input) {
    const d = input.chargeLogic ?? null;
    return {
        chargeLogicActive: d?.active ?? false,
        chargeLogicHorizonDays: d?.horizonDays ?? null,
        chargeLogicBridgeUntilIso: d?.bridgeUntilIso ?? null,
        chargeLogicPvRecoveryDay: d?.pvRecoveryDay ?? null,
        chargeLogicEnergyDeficitKwh: d?.energyDeficitKwh ?? null,
        chargeLogicEnergyTargetKwh: d?.energyTargetKwh ?? null,
        chargeLogicSocTargetPct: d?.socTargetPct ?? null,
        chargeLogicConfidenceMinPct: d?.confidenceMinPct ?? null,
        chargeLogicReasonDe: d?.reasonDe ?? null,
        legacyDeficitChargeActive: input.legacyDeficitChargeActive ?? null,
    };
}
function requiredChargeEnergyKwh(input) {
    const cap = (0, capacity_1.resolveCapacity)({
        source: input.capacitySource === "mapped" ? "mapped" : "manual",
        manualKwh: input.capacityManualKwh,
        mappedKwh: input.capacityMappedKwh,
    });
    if (!cap.valid || cap.effectiveKwh === null || input.socPct === null)
        return null;
    const target = chargeTargetSocPct(input);
    if (input.socPct >= target)
        return 0;
    const need = ((target - input.socPct) / 100) * cap.effectiveKwh;
    return (0, types_2.round3)(Math.max(0, need));
}
function gridChargeEligible(input) {
    if (!input.gridForecast?.gridImportAllowed)
        return false;
    if (input.globalModeOff || !input.modePolicy.allowOptimization)
        return false;
    if (input.modePolicy.mode === "eco" && !input.deficitChargeActive)
        return false;
    return input.chargeCapable;
}
function buildBatteryChargeContribution(input) {
    const generatedAt = input.now.toISOString();
    const participation = (0, types_2.evaluateParticipation)({
        addonEnabled: input.addonEnabled,
        governanceEnabled: input.governanceEnabled,
        configured: input.profileId !== "generic_readonly" || input.mappingsReady,
        mappingsReady: input.mappingsReady,
        fault: input.fault,
        lockout: input.lockout,
        globalModeOff: input.globalModeOff,
        telemetryValid: input.telemetryValid,
        telemetryStale: input.telemetryStale,
    });
    const requiredKwh = participation.allowed ? requiredChargeEnergyKwh(input) : null;
    const maxW = input.maxChargeW !== null && input.maxChargeW > 0 ? input.maxChargeW : null;
    const gridEligible = gridChargeEligible(input);
    const enabled = participation.allowed && input.chargeCapable && requiredKwh !== null && maxW !== null;
    const deficitDriven = input.chargeLogic?.active === true;
    let status = participation.status;
    let reasonDe = participation.reasonDe;
    if (participation.allowed) {
        if (!input.chargeCapable) {
            status = "unsupported";
            reasonDe = "Profil unterstützt keine Ladeleistungssteuerung.";
        }
        else if (maxW === null) {
            status = "degraded";
            reasonDe = "Hardware-Maximal-Ladeleistung fehlt — keine Batterie-Allocation.";
        }
        else if (requiredKwh === null) {
            status = "degraded";
            reasonDe = "Ladebedarf nicht berechenbar (SOC oder Kapazität fehlt).";
        }
        else if (requiredKwh === 0) {
            status = "valid";
            reasonDe = "Batterie am Ladeziel — kein weiterer Ladebedarf.";
        }
        else {
            status = participation.status === "degraded" ? "degraded" : "valid";
            reasonDe = `Ladebedarf ${requiredKwh} kWh bis ${chargeTargetSocPct(input)} % SOC (Config-Max ${maxW} W).`;
            if (!input.topOffRequested && learnedTopoffDue(input)) {
                reasonDe = `${reasonDe} Gelerntes Top-Off-Intervall überschritten (${input.batteryLearning?.topoffDaysRemaining !== null && input.batteryLearning?.topoffDaysRemaining !== undefined ? `${input.batteryLearning.topoffDaysRemaining} Tage überfällig` : "fällig"}).`;
            }
            if (deficitDriven) {
                reasonDe = `${reasonDe} PV-Defizit-Ladelogik aktiv (${input.chargeLogic?.reasonDe ?? ""})`.trim();
            }
        }
    }
    /*
     * Deadline aus der PV-Defizit-Ladelogik (Block 2, `battery_charge_logic.ts`) nur setzen,
     * wenn sie aktuell den Bedarf treibt — sonst füllt die Allocation (Top-Off/Policy-Ziel)
     * weiterhin ohne feste Frist, PV-first.
     */
    const deadlineIso = deficitDriven && requiredKwh !== null && requiredKwh > 0 ? input.chargeLogic?.bridgeUntilIso ?? null : null;
    return (0, types_1.baseContribution)(contribution_ids_1.CONTRIBUTION_IDS.BATTERY_CHARGE, (0, contributor_1.addonContributorRef)("battery"), "consume", ["storage", "demand_flex", "dispatch"], {
        generatedAt,
        validUntil: null,
        revision: 1,
        enabled: enabled && status !== "unsupported",
        flexible: true,
        gridEligible,
        deadlineIso,
        quality: (0, quality_1.operatorQuality)(status, reasonDe),
        reasonDe,
        details: {
            socPct: input.socPct,
            targetSocPct: chargeTargetSocPct(input),
            requiredEnergyKwh: requiredKwh,
            maxChargePowerW: maxW,
            topOffRequested: input.topOffRequested,
            profileId: input.profileId,
            globalMode: input.modePolicy.mode,
            pvChargeAllowed: input.modePolicy.allowPvCharge,
            gridImportAllowed: input.gridForecast?.gridImportAllowed ?? null,
            ownershipActive: input.ownershipActive,
            deficitChargeActive: input.deficitChargeActive,
            ...batteryLearningDetails(input),
            ...chargeLogicDetails(input),
        },
        slots: maxW !== null && participation.allowed
            ? [
                {
                    slot: { startIso: generatedAt, endIso: generatedAt },
                    minPowerW: null,
                    preferredPowerW: null,
                    maxPowerW: maxW,
                    requiredEnergyKwh: requiredKwh,
                    availableEnergyKwh: null,
                    priceCtPerKwh: null,
                    available: input.chargeCapable,
                    mandatory: false,
                    quality: (0, quality_1.operatorQuality)(status, "Technische Ladeverfügbarkeit."),
                },
            ]
            : [],
    });
}
exports.buildBatteryChargeContribution = buildBatteryChargeContribution;
function buildBatteryDischargeContribution(input) {
    const generatedAt = input.now.toISOString();
    const unsupported = input.profileId === "sonnen_em" || !input.dischargeCapable;
    const reasonDe = unsupported
        ? "Profil sonnen_em unterstützt keinen getrennten Entlade-Sollwert — nur passives Eigenverbrauch."
        : "Entladesteuerung nicht verfügbar.";
    return (0, types_1.baseContribution)(contribution_ids_1.CONTRIBUTION_IDS.BATTERY_DISCHARGE, (0, contributor_1.addonContributorRef)("battery"), "provide", ["storage", "supply", "dispatch"], {
        generatedAt,
        validUntil: null,
        revision: 1,
        enabled: false,
        flexible: false,
        gridEligible: false,
        quality: (0, quality_1.operatorQuality)("unsupported", reasonDe),
        reasonDe,
        details: {
            profileId: input.profileId,
            passiveSelfConsumptionOnly: input.profileId === "sonnen_em",
            dischargeCapableFlag: input.dischargeCapable,
            runtimeControlAvailable: false,
        },
        slots: [],
    });
}
exports.buildBatteryDischargeContribution = buildBatteryDischargeContribution;
function buildBatteryReserveContribution(input) {
    const generatedAt = input.now.toISOString();
    const cap = (0, capacity_1.resolveCapacity)({
        source: input.capacitySource === "mapped" ? "mapped" : "manual",
        manualKwh: input.capacityManualKwh,
        mappedKwh: input.capacityMappedKwh,
    });
    const energy = (0, capacity_1.deriveEnergy)(input.socPct, cap.effectiveKwh, input.minSocPct);
    const participation = (0, types_2.evaluateParticipation)({
        addonEnabled: input.addonEnabled,
        governanceEnabled: true,
        configured: true,
        mappingsReady: input.mappingsReady,
        fault: input.fault,
        lockout: input.lockout,
        globalModeOff: false,
    });
    const enabled = participation.allowed || input.minSocPct !== null;
    let status = enabled ? "valid" : "missing";
    if (input.socPct === null || cap.effectiveKwh === null)
        status = "degraded";
    return (0, types_1.baseContribution)(contribution_ids_1.CONTRIBUTION_IDS.BATTERY_RESERVE, (0, contributor_1.addonContributorRef)("battery"), "constraint", ["storage", "constraint"], {
        generatedAt,
        validUntil: null,
        revision: 1,
        enabled,
        flexible: false,
        gridEligible: false,
        quality: (0, quality_1.operatorQuality)(status, "Batteriereserve und SOC-Grenzen."),
        reasonDe: `Min-SOC ${input.minSocPct ?? "—"} %, Max-SOC ${input.maxSocPct ?? "—"} %.`,
        details: {
            minSocPct: input.minSocPct,
            maxSocPct: input.maxSocPct,
            energyStoredKwh: energy.energyStoredKwh,
            energyAboveReserveKwh: energy.energyAboveTechnicalMinKwh,
            energyFreeToFullKwh: energy.energyFreeToFullKwh,
            topOffTargetSocPct: input.topOffRequested || learnedTopoffDue(input) ? 100 : null,
            fault: input.fault,
            lockout: input.lockout,
            ownershipActive: input.ownershipActive,
            ...batteryLearningDetails(input),
            ...chargeLogicDetails(input),
        },
        slots: [],
    });
}
exports.buildBatteryReserveContribution = buildBatteryReserveContribution;
function buildBatteryContributions(input) {
    return [
        buildBatteryChargeContribution(input),
        buildBatteryDischargeContribution(input),
        buildBatteryReserveContribution(input),
    ];
}
exports.buildBatteryContributions = buildBatteryContributions;
