"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFlexibleContributions = void 0;
const battery_1 = require("./battery");
const wallbox_1 = require("./wallbox");
const immersion_heater_1 = require("./immersion_heater");
const air_conditioning_1 = require("./air_conditioning");
const contribution_ids_1 = require("../../contribution_ids");
function numDetail(c, key) {
    const v = c?.details?.[key];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function buildFlexibleContributions(params) {
    const out = [];
    try {
        out.push(...(0, battery_1.buildBatteryContributions)(params.battery));
    }
    catch {
        // isoliert — andere Add-ons weiter
    }
    try {
        out.push((0, wallbox_1.buildWallboxEvSessionContribution)(params.wallbox));
    }
    catch {
        // isoliert
    }
    const batCharge = out.find((c) => c.contributionId === contribution_ids_1.CONTRIBUTION_IDS.BATTERY_CHARGE);
    const wb = out.find((c) => c.contributionId === contribution_ids_1.CONTRIBUTION_IDS.WALLBOX_EV_SESSION);
    const immersionInput = {
        ...params.immersion,
        todayPvSurplusKwh: params.immersion.todayPvSurplusKwh ?? params.battery.todayPvSurplusKwh ?? null,
        batterySocPct: params.immersion.batterySocPct ?? params.battery.socPct ?? null,
        batteryEndSocTargetPct: params.immersion.batteryEndSocTargetPct ?? numDetail(batCharge, "targetSocPct"),
        vehicleUrgentEnergyKwh: params.immersion.vehicleUrgentEnergyKwh ?? numDetail(wb, "requiredEnergyKwh"),
        futureElectricalFlexHintKwh: params.immersion.futureElectricalFlexHintKwh ?? null,
    };
    try {
        out.push(...(0, immersion_heater_1.buildImmersionHeaterContributions)(immersionInput));
    }
    catch {
        // isoliert
    }
    try {
        out.push(...(0, air_conditioning_1.buildAirConditioningContributions)(params.airConditioning));
    }
    catch {
        // isoliert
    }
    return out;
}
exports.buildFlexibleContributions = buildFlexibleContributions;
