"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFlexibleContributions = void 0;
const battery_1 = require("./battery");
const wallbox_1 = require("./wallbox");
const immersion_heater_1 = require("./immersion_heater");
const air_conditioning_1 = require("./air_conditioning");
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
    try {
        out.push(...(0, immersion_heater_1.buildImmersionHeaterContributions)(params.immersion));
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
