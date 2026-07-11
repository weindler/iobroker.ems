"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildGridSupplyContribution = exports.buildGlobalConstraintsContribution = exports.buildHouseMainFuseConstraintContribution = void 0;
const quality_1 = require("../quality");
const contributor_1 = require("../contributor");
const types_1 = require("./types");
function buildHouseMainFuseConstraintContribution(input) {
    const generatedAt = input.now.toISOString();
    const hasLimits = input.configuredHouseFuseLimitW !== null || input.configuredMaxGridImportW !== null;
    let status = "missing";
    let reasonDe = "Keine konfigurierten Netz- oder Sicherungsgrenzen.";
    if (hasLimits) {
        status = "valid";
        reasonDe = "Konfigurierte Hausanschluss- und Netzimportgrenzen.";
    }
    return (0, types_1.baseContribution)((0, contributor_1.addonContributorRef)((0, types_1.houseMainFuseAddonId)()), ["constraint"], {
        generatedAt,
        validUntil: null,
        revision: 1,
        enabled: hasLimits,
        flexible: false,
        gridEligible: false,
        quality: (0, quality_1.operatorQuality)(status, reasonDe),
        reasonDe,
        details: {
            configuredHouseFuseLimitW: input.configuredHouseFuseLimitW,
            configuredMaxGridImportW: input.configuredMaxGridImportW,
            noteDe: "Aktuelle Hauslast wird noch nicht vom Sicherungslimit abgezogen.",
        },
        slots: [],
    });
}
exports.buildHouseMainFuseConstraintContribution = buildHouseMainFuseConstraintContribution;
function buildGlobalConstraintsContribution(input) {
    const generatedAt = input.now.toISOString();
    const hasEffective = input.effectiveMaxGridImportW !== null ||
        input.gridImportAllowed !== undefined ||
        input.globalMode !== null;
    let status = "missing";
    let reasonDe = "Keine effektiven globalen Netzlimits verfügbar.";
    if (hasEffective) {
        status = input.gridSupplyQuality.status === "valid" ? "valid" : "degraded";
        reasonDe = `Effektive Grenzen nach Global Mode (${input.globalMode ?? "unbekannt"}).`;
    }
    return (0, types_1.baseContribution)((0, contributor_1.systemContributorRef)("global_constraints"), ["constraint"], {
        generatedAt,
        validUntil: null,
        revision: 1,
        enabled: hasEffective,
        flexible: false,
        gridEligible: false,
        quality: (0, quality_1.operatorQuality)(status, reasonDe, input.gridSupplyQuality.confidencePct),
        reasonDe,
        details: {
            globalMode: input.globalMode,
            effectiveMaxGridImportW: input.effectiveMaxGridImportW,
            gridImportAllowed: input.gridImportAllowed,
            gridSupplyStatus: input.gridSupplyQuality.status,
            noteDe: "Keine Phasenverteilung oder dynamische Verbraucher-Allocation.",
        },
        slots: [],
    });
}
exports.buildGlobalConstraintsContribution = buildGlobalConstraintsContribution;
function buildGridSupplyContribution(grid) {
    const hasData = grid.slots.length > 0 ||
        grid.currentPriceCtPerKwh !== null ||
        grid.effectiveMaxGridImportW !== null;
    const slots = grid.slots.map((s) => ({
        slot: { startIso: s.startIso, endIso: s.endIso },
        minPowerW: null,
        preferredPowerW: null,
        maxPowerW: s.maxImportPowerW,
        requiredEnergyKwh: null,
        availableEnergyKwh: null,
        priceCtPerKwh: s.priceCtPerKwh,
        available: s.importAllowed,
        mandatory: false,
        quality: s.quality,
    }));
    return (0, types_1.baseContribution)((0, contributor_1.systemContributorRef)("grid_supply"), ["infrastructure"], {
        generatedAt: grid.generatedAt,
        validUntil: grid.validUntil,
        revision: 1,
        enabled: hasData,
        flexible: false,
        gridEligible: true,
        quality: grid.quality,
        reasonDe: grid.reasonDe,
        details: {
            source: grid.source,
            currentPriceCtPerKwh: grid.currentPriceCtPerKwh,
            gridImportAllowed: grid.gridImportAllowed,
            configuredMaxGridImportW: grid.configuredMaxGridImportW,
            configuredHouseFuseLimitW: grid.configuredHouseFuseLimitW,
            effectiveMaxGridImportW: grid.effectiveMaxGridImportW,
            slotCount: grid.slots.length,
        },
        slots,
    });
}
exports.buildGridSupplyContribution = buildGridSupplyContribution;
