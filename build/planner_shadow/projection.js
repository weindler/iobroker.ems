"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectionFromPreparedInput = exports.projectionFromSnapshot = exports.projectionFromGridSupplyForecast = void 0;
const forecast_1 = require("../grid_supply/forecast");
const prepare_1 = require("../planner_preparation/prepare");
function slotFromPrepared(slot) {
    return {
        start: slot.startIso,
        end: slot.endIso,
        importAllowed: slot.importAllowed,
        maxImportW: slot.maxImportPowerW,
        priceCtPerKwh: slot.priceCtPerKwh,
        priceClass: slot.priceLabel,
    };
}
function slotFromGrid(slot) {
    return {
        start: slot.startIso,
        end: slot.endIso,
        importAllowed: slot.importAllowed,
        maxImportW: slot.maxImportPowerW,
        priceCtPerKwh: slot.priceCtPerKwh,
        priceClass: slot.priceLabel,
    };
}
function projectionFromGridSupplyForecast(forecast, capturedAt) {
    const slots = forecast.slots.map(slotFromGrid);
    return {
        capturedAt,
        horizonStart: slots.length > 0 ? slots[0].start : capturedAt,
        horizonEnd: slots.length > 0 ? slots[slots.length - 1].end : capturedAt,
        slotCount: slots.length,
        gridImportAllowed: forecast.gridImportAllowed,
        maxGridImportW: forecast.effectiveMaxGridImportW,
        houseFuseLimitW: forecast.configuredHouseFuseLimitW,
        slots,
    };
}
exports.projectionFromGridSupplyForecast = projectionFromGridSupplyForecast;
/** In-process reference from the same snapshot input used by the worker (neutral grid_supply core). */
function projectionFromSnapshot(snapshot) {
    const gridInput = (0, prepare_1.gridSupplyBuildInputFromSnapshot)(snapshot);
    const forecast = (0, forecast_1.buildGridSupplyForecast)(gridInput);
    return projectionFromGridSupplyForecast(forecast, snapshot.capturedAt);
}
exports.projectionFromSnapshot = projectionFromSnapshot;
function projectionFromPreparedInput(prepared) {
    const slots = prepared.slots.map(slotFromPrepared);
    return {
        capturedAt: prepared.capturedAt,
        horizonStart: prepared.horizonStart,
        horizonEnd: prepared.horizonEnd,
        slotCount: slots.length,
        gridImportAllowed: prepared.policy.gridImportAllowed,
        maxGridImportW: prepared.policy.effectiveMaxGridImportW,
        houseFuseLimitW: prepared.policy.configuredHouseFuseLimitW,
        slots,
    };
}
exports.projectionFromPreparedInput = projectionFromPreparedInput;
