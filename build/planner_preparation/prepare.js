"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.preparePlannerFromSnapshot = exports.gridSupplyBuildInputFromSnapshot = void 0;
const forecast_1 = require("../grid_supply/forecast");
const constraint_diagnostics_1 = require("./constraint_diagnostics");
const canonical_1 = require("./canonical");
/** Maps snapshot fields to the neutral grid-supply build input. */
function gridSupplyBuildInputFromSnapshot(snapshot) {
    const now = new Date(snapshot.capturedAt);
    const dynamicSlots = [];
    for (const slot of snapshot.prices.slots15Min) {
        const slotStartMs = Date.parse(slot.slotStartIso);
        if (!Number.isFinite(slotStartMs))
            continue;
        dynamicSlots.push({
            slotStartMs,
            priceCtPerKwh: slot.priceCtPerKwh ?? -1,
        });
    }
    return {
        now,
        globalMode: snapshot.general.globalMode,
        policyGridImportAllowed: snapshot.policy.gridImportAllowed,
        configuredMaxGridImportW: snapshot.policy.maxGridImportW,
        configuredHouseFuseLimitW: snapshot.policy.houseFuseLimitW,
        currentPriceCtPerKwh: snapshot.live.currentPriceCtPerKwh,
        fixedPriceCtPerKwh: snapshot.live.fixedPriceCtPerKwh,
        dynamicSlots,
    };
}
exports.gridSupplyBuildInputFromSnapshot = gridSupplyBuildInputFromSnapshot;
/**
 * First deterministic worker preparation stage: grid supply forecast.
 * Mirrors collectGridSupplyBuildInput → buildGridSupplyForecast from runGridSupplyTick.
 */
function preparePlannerFromSnapshot(snapshot) {
    const gridInput = gridSupplyBuildInputFromSnapshot(snapshot);
    const gridForecast = (0, forecast_1.buildGridSupplyForecast)(gridInput);
    const constraintInput = {
        globalMode: snapshot.general.globalMode,
        configuredHouseFuseLimitW: gridForecast.configuredHouseFuseLimitW,
        configuredMaxGridImportW: gridForecast.configuredMaxGridImportW,
        effectiveMaxGridImportW: gridForecast.effectiveMaxGridImportW,
        gridImportAllowed: gridForecast.gridImportAllowed,
        gridSupplyQuality: gridForecast.quality,
    };
    const slots = gridForecast.slots.map((s) => ({
        startIso: s.startIso,
        endIso: s.endIso,
        priceCtPerKwh: s.priceCtPerKwh,
        importAllowed: s.importAllowed,
        maxImportPowerW: s.maxImportPowerW,
        priceLabel: s.priceLabel,
    }));
    const horizonStart = slots.length > 0 ? slots[0].startIso : snapshot.capturedAt;
    const horizonEnd = slots.length > 0 ? slots[slots.length - 1].endIso : snapshot.capturedAt;
    const withoutRevision = {
        schemaVersion: 1,
        inputRevision: snapshot.inputRevision,
        timezone: snapshot.timezone,
        capturedAt: snapshot.capturedAt,
        horizonStart,
        horizonEnd,
        slots,
        policy: {
            globalMode: snapshot.general.globalMode,
            gridImportAllowed: gridForecast.gridImportAllowed,
            effectiveMaxGridImportW: gridForecast.effectiveMaxGridImportW,
            configuredMaxGridImportW: gridForecast.configuredMaxGridImportW,
            configuredHouseFuseLimitW: gridForecast.configuredHouseFuseLimitW,
            currentPriceCtPerKwh: gridForecast.currentPriceCtPerKwh,
            priceSource: gridForecast.source,
        },
        diagnostics: {
            slotCount: slots.length,
            gridSupplyQuality: gridForecast.quality.status,
            gridSupplyReasonDe: gridForecast.reasonDe,
            houseFuseConstraintStatus: (0, constraint_diagnostics_1.houseFuseConstraintStatus)(constraintInput),
            globalConstraintsStatus: (0, constraint_diagnostics_1.globalConstraintsStatus)(constraintInput),
        },
    };
    const draft = {
        ...withoutRevision,
        generatedAt: snapshot.capturedAt,
        preparationRevision: "",
    };
    const preparationRevision = (0, canonical_1.computePreparationRevision)(draft);
    return { ...draft, preparationRevision };
}
exports.preparePlannerFromSnapshot = preparePlannerFromSnapshot;
