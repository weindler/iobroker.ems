"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBatteryContributions = exports.buildBatteryReserveContribution = exports.buildBatteryDischargeContribution = exports.buildBatteryChargeContribution = exports.chargeTargetSocPct = void 0;
const capacity_1 = require("../../../addons/battery/core/capacity");
const contribution_ids_1 = require("../../contribution_ids");
const quality_1 = require("../../quality");
const contributor_1 = require("../../contributor");
const types_1 = require("../types");
const battery_end_soc_1 = require("./battery_end_soc");
const battery_pv_cover_1 = require("./battery_pv_cover");
const types_2 = require("./types");
/** Top-Off durch Nutzer-Intent ODER gelerntes Intervall (`topoff_due`) überschritten. */
function learnedTopoffDue(input) {
    return input.batteryLearning?.status === "valid" && input.batteryLearning.topoffDue === true;
}
function resolveCapacityKwh(input) {
    const cap = (0, capacity_1.resolveCapacity)({
        source: input.capacitySource === "mapped" ? "mapped" : "manual",
        manualKwh: input.capacityManualKwh,
        mappedKwh: input.capacityMappedKwh,
    });
    return cap.valid && cap.effectiveKwh !== null && cap.effectiveKwh > 0 ? cap.effectiveKwh : null;
}
/**
 * Dynamisches Ladeziel (Befund 004): Nacht + Recovery-Bilanz; 100 % nur Top-off.
 * Keine pauschale Policy-Untergrenze mehr (90/95 %), außer Fallback ohne Daten.
 */
function chargeTargetSocPct(input) {
    if (input.topOffRequested || learnedTopoffDue(input))
        return 100;
    const cap = resolveCapacityKwh(input);
    if (cap === null || input.socPct === null) {
        return input.modePolicy.chargeTargetSocPct;
    }
    const dyn = (0, battery_end_soc_1.planDynamicBatteryEndSoc)({
        capacityKwh: cap,
        socPct: input.socPct,
        minSocPct: input.minSocPct ?? 0,
        maxSocPct: input.maxSocPct ?? 100,
        modePolicy: input.modePolicy,
        avgNightDischargeKwh: input.batteryLearning?.status === "valid"
            ? (input.batteryLearning.avgNightDischargeKwh ?? null)
            : null,
        chargeLogic: input.chargeLogic ?? null,
        deferForCheapFutureGrid: input.deferForCheapFutureGrid === true,
    });
    return dyn.socTargetPct;
}
exports.chargeTargetSocPct = chargeTargetSocPct;
function dynamicEndSocDetails(input) {
    const cap = resolveCapacityKwh(input);
    if (cap === null || input.socPct === null) {
        return {
            endSocDynamic: false,
            endSocReasonDe: null,
            endSocUsedPolicyFallback: null,
        };
    }
    if (input.topOffRequested || learnedTopoffDue(input)) {
        return {
            endSocDynamic: true,
            endSocReasonDe: "Top-off fällig — Ziel 100 %.",
            endSocUsedPolicyFallback: false,
        };
    }
    const dyn = (0, battery_end_soc_1.planDynamicBatteryEndSoc)({
        capacityKwh: cap,
        socPct: input.socPct,
        minSocPct: input.minSocPct ?? 0,
        maxSocPct: input.maxSocPct ?? 100,
        modePolicy: input.modePolicy,
        avgNightDischargeKwh: input.batteryLearning?.status === "valid"
            ? (input.batteryLearning.avgNightDischargeKwh ?? null)
            : null,
        chargeLogic: input.chargeLogic ?? null,
        deferForCheapFutureGrid: input.deferForCheapFutureGrid === true,
    });
    return {
        endSocDynamic: true,
        endSocReasonDe: dyn.reasonDe,
        endSocUsedPolicyFallback: dyn.usedPolicyFallback,
        endSocEnergyTargetKwh: dyn.energyTargetKwh,
    };
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
    const todayPvSurplusKwh = input.todayPvSurplusKwh ?? null;
    const pvCovers = (0, battery_pv_cover_1.pvSurplusCoversChargeNeed)({
        requiredChargeEnergyKwh: requiredKwh,
        todayPvSurplusKwh,
        topOffRequested: input.topOffRequested,
        learnedTopoffDue: learnedTopoffDue(input),
    });
    /** Allocation-Energie: 0 wenn Tages-PV den SOC-Bedarf deckt (keine EMS-Lade-Slots). */
    const allocEnergyKwh = pvCovers ? 0 : requiredKwh;
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
        else if (pvCovers) {
            status = "valid";
            reasonDe = `Tages-PV-Überschuss ${todayPvSurplusKwh} kWh deckt Ladebedarf ${requiredKwh} kWh — keine EMS-Lade-Slots.`;
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
    const deadlineIso = !pvCovers && deficitDriven && requiredKwh !== null && requiredKwh > 0
        ? input.chargeLogic?.bridgeUntilIso ?? null
        : null;
    const publishSlots = maxW !== null &&
        participation.allowed &&
        allocEnergyKwh !== null &&
        allocEnergyKwh > 0;
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
            requiredEnergyKwh: allocEnergyKwh,
            socGapEnergyKwh: requiredKwh,
            todayPvSurplusKwh,
            pvCoversChargeNeed: pvCovers,
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
            ...dynamicEndSocDetails(input),
        },
        slots: publishSlots
            ? [
                {
                    slot: { startIso: generatedAt, endIso: generatedAt },
                    minPowerW: null,
                    preferredPowerW: null,
                    maxPowerW: maxW,
                    requiredEnergyKwh: allocEnergyKwh,
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
