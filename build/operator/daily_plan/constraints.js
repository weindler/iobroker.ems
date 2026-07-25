"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDailyPlanSlots = exports.mergeForecastIntoDailySlot = exports.availablePvSurplus = exports.remainingGridImportForSlot = exports.effectiveImportLimitW = exports.buildForecastFieldIndex = void 0;
const quality_1 = require("../quality");
/**
 * Forecast-Quellen liefern unterschiedliche Auflösungen im selben `ForecastPlanSlot[]`
 * (z. B. Grid-Preise als exakte 15-Min-Slots, Hauslast als Mehrstunden-Segmente). Ein
 * exakter Key-Match auf den 15-Min-Horizont trifft daher nur die 15-Min-Quellen. Diese
 * Indizes erlauben pro Feld eine Containment-Suche: Ein Horizont-Slot übernimmt den Wert
 * jedes Forecast-Slots, der ihn zeitlich vollständig umschließt.
 */
function buildFieldIndex(forecastSlots, pick) {
    const entries = [];
    for (const s of forecastSlots) {
        const value = pick(s);
        if (value === null || value === undefined)
            continue;
        const startMs = Date.parse(s.slot.startIso);
        const endMs = Date.parse(s.slot.endIso);
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs))
            continue;
        entries.push({ startMs, endMs, value });
    }
    entries.sort((a, b) => a.startMs - b.startMs);
    return entries;
}
/** Kleinster (präzisester) umschließender Treffer gewinnt bei Überlappung. */
function lookupContaining(entries, startIso, endIso) {
    const hStart = Date.parse(startIso);
    const hEnd = Date.parse(endIso);
    if (!Number.isFinite(hStart) || !Number.isFinite(hEnd))
        return null;
    let best = null;
    for (const e of entries) {
        if (e.startMs > hStart)
            break;
        if (e.startMs <= hStart && e.endMs >= hEnd) {
            if (!best || e.endMs - e.startMs < best.endMs - best.startMs)
                best = e;
        }
    }
    return best ? best.value : null;
}
function buildForecastFieldIndex(forecastSlots) {
    return {
        pv: buildFieldIndex(forecastSlots, (s) => s.pvPowerW),
        houseLoad: buildFieldIndex(forecastSlots, (s) => s.houseLoadPowerW),
        gridPrice: buildFieldIndex(forecastSlots, (s) => s.gridPriceCtPerKwh),
        gridImportAllowed: buildFieldIndex(forecastSlots, (s) => s.gridImportAllowed),
        gridMaxImportPowerW: buildFieldIndex(forecastSlots, (s) => s.gridMaxImportPowerW),
    };
}
exports.buildForecastFieldIndex = buildForecastFieldIndex;
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
function mergeForecastIntoDailySlot(horizonSlot, index, importLimitW) {
    const pvForecastPowerW = lookupContaining(index.pv, horizonSlot.startIso, horizonSlot.endIso);
    const fixedHouseLoadPowerW = lookupContaining(index.houseLoad, horizonSlot.startIso, horizonSlot.endIso);
    const gridPriceCtPerKwh = lookupContaining(index.gridPrice, horizonSlot.startIso, horizonSlot.endIso);
    const gridImportAllowed = lookupContaining(index.gridImportAllowed, horizonSlot.startIso, horizonSlot.endIso) ?? true;
    let fixedBalancePowerW = null;
    if (pvForecastPowerW !== null && fixedHouseLoadPowerW !== null) {
        fixedBalancePowerW = pvForecastPowerW - fixedHouseLoadPowerW;
    }
    const pvSurplus = availablePvSurplus(fixedBalancePowerW);
    const gridRemaining = remainingGridImportForSlot(importLimitW, fixedHouseLoadPowerW);
    const reasons = [];
    if (pvForecastPowerW !== null)
        reasons.push("PV");
    if (fixedHouseLoadPowerW !== null)
        reasons.push("Hauslast");
    if (gridPriceCtPerKwh !== null)
        reasons.push("Preis");
    return {
        slot: { startIso: horizonSlot.startIso, endIso: horizonSlot.endIso },
        pvForecastPowerW,
        fixedHouseLoadPowerW,
        fixedBalancePowerW,
        gridPriceCtPerKwh,
        gridImportAllowed,
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
    const index = buildForecastFieldIndex(forecastSlots);
    return horizonSlots.map((s) => mergeForecastIntoDailySlot(s, index, importLimitW));
}
exports.buildDailyPlanSlots = buildDailyPlanSlots;
