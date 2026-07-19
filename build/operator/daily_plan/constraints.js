"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDailyPlanSlots = exports.mergeForecastIntoDailySlot = exports.availablePvSurplus = exports.remainingGridImportForSlot = exports.effectiveImportLimitW = void 0;
const quality_1 = require("../quality");
const slots_1 = require("./slots");
function effectiveImportLimitW(effectiveMaxGridImportW, configuredHouseFuseLimitW) {
    const values = [effectiveMaxGridImportW, configuredHouseFuseLimitW].filter((v) => v !== null && Number.isFinite(v) && v > 0);
    if (values.length === 0)
        return null;
    return Math.min(...values);
}
exports.effectiveImportLimitW = effectiveImportLimitW;
function remainingGridImportForSlot(importLimitW, houseLoadPowerW) {
    if (importLimitW === null)
        return null;
    if (houseLoadPowerW === null)
        return null;
    return Math.max(0, Math.round(importLimitW - houseLoadPowerW));
}
exports.remainingGridImportForSlot = remainingGridImportForSlot;
function availablePvSurplus(fixedBalancePowerW) {
    if (fixedBalancePowerW === null)
        return null;
    return Math.max(0, fixedBalancePowerW);
}
exports.availablePvSurplus = availablePvSurplus;
function mergeForecastIntoDailySlot(horizonSlot, forecastByKey, importLimitW) {
    const key = (0, slots_1.slotKey)(horizonSlot.startIso, horizonSlot.endIso);
    const fc = forecastByKey.get(key);
    const pvForecastPowerW = fc?.pvPowerW ?? null;
    const fixedHouseLoadPowerW = fc?.houseLoadPowerW ?? null;
    let fixedBalancePowerW = fc?.fixedBalancePowerW ?? null;
    if (fixedBalancePowerW === null && pvForecastPowerW !== null && fixedHouseLoadPowerW !== null) {
        fixedBalancePowerW = pvForecastPowerW - fixedHouseLoadPowerW;
    }
    const pvSurplus = availablePvSurplus(fixedBalancePowerW);
    const gridRemaining = remainingGridImportForSlot(importLimitW, fixedHouseLoadPowerW);
    const reasons = [];
    if (pvForecastPowerW !== null)
        reasons.push("PV");
    if (fixedHouseLoadPowerW !== null)
        reasons.push("Hauslast");
    if (fc?.gridPriceCtPerKwh !== null)
        reasons.push("Preis");
    return {
        slot: { startIso: horizonSlot.startIso, endIso: horizonSlot.endIso },
        pvForecastPowerW,
        fixedHouseLoadPowerW,
        fixedBalancePowerW,
        gridPriceCtPerKwh: fc?.gridPriceCtPerKwh ?? null,
        gridImportAllowed: fc?.gridImportAllowed ?? true,
        configuredGridImportLimitW: importLimitW,
        remainingGridImportPowerW: gridRemaining,
        availablePvSurplusPowerW: pvSurplus,
        allocatedFlexiblePowerW: 0,
        allocatedPvPowerW: 0,
        allocatedGridPowerW: 0,
        allocatedBatteryPowerW: 0,
        remainingPvSurplusPowerW: pvSurplus,
        remainingGridImportPowerWAfterAlloc: gridRemaining,
        remainingBatteryDischargePowerW: null,
        allocations: [],
        quality: (0, quality_1.operatorQuality)(pvSurplus === null && gridRemaining === null ? "degraded" : "valid", reasons.length > 0 ? reasons.join(", ") + "." : "Slot ohne vollständige Eingangsdaten."),
        reasonDe: reasons.length > 0 ? reasons.join(", ") + "." : "Keine zeitlich aufgelösten Werte.",
    };
}
exports.mergeForecastIntoDailySlot = mergeForecastIntoDailySlot;
function buildDailyPlanSlots(horizonSlots, forecastSlots, effectiveMaxGridImportW, configuredHouseFuseLimitW) {
    const importLimitW = effectiveImportLimitW(effectiveMaxGridImportW, configuredHouseFuseLimitW);
    const forecastByKey = new Map();
    for (const s of forecastSlots) {
        forecastByKey.set((0, slots_1.slotKey)(s.slot.startIso, s.slot.endIso), s);
    }
    return horizonSlots.map((s) => mergeForecastIntoDailySlot(s, forecastByKey, importLimitW));
}
exports.buildDailyPlanSlots = buildDailyPlanSlots;
