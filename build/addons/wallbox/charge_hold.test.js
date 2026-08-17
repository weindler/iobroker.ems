"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const charge_hold_1 = require("./charge_hold");
function hold(over = {}) {
    return (0, charge_hold_1.resolveWallboxBatteryHold)({
        vehicleConnected: true,
        charging: true,
        chargePowerW: 11000,
        batteryBoost: false,
        loadpointMode: "pv",
        externalVehicleChargeRaw: null,
        tibberGridRewardsActive: null,
        ...over,
    });
}
(0, node_test_1.describe)("interpretExternalVehicleCharge", () => {
    (0, node_test_1.it)("treats charging-like HA values as active", () => {
        strict_1.default.equal((0, charge_hold_1.interpretExternalVehicleCharge)("Charging"), true);
        strict_1.default.equal((0, charge_hold_1.interpretExternalVehicleCharge)("ChargingAC"), true);
        strict_1.default.equal((0, charge_hold_1.interpretExternalVehicleCharge)("ChargingDC"), true);
        strict_1.default.equal((0, charge_hold_1.interpretExternalVehicleCharge)("IN_PROGRESS"), true);
        strict_1.default.equal((0, charge_hold_1.interpretExternalVehicleCharge)(true), true);
    });
    (0, node_test_1.it)("treats complete/ready/disconnected as inactive", () => {
        strict_1.default.equal((0, charge_hold_1.interpretExternalVehicleCharge)("COMPLETE"), false);
        strict_1.default.equal((0, charge_hold_1.interpretExternalVehicleCharge)("READY"), false);
        strict_1.default.equal((0, charge_hold_1.interpretExternalVehicleCharge)("NOT_READY"), false);
        strict_1.default.equal((0, charge_hold_1.interpretExternalVehicleCharge)("DISCONNECTED"), false);
        strict_1.default.equal((0, charge_hold_1.interpretExternalVehicleCharge)(false), false);
    });
    (0, node_test_1.it)("is conservative on unknown strings", () => {
        strict_1.default.equal((0, charge_hold_1.interpretExternalVehicleCharge)("Idle"), false);
        strict_1.default.equal((0, charge_hold_1.interpretExternalVehicleCharge)("not charging"), false);
        strict_1.default.equal((0, charge_hold_1.interpretExternalVehicleCharge)(null), false);
    });
});
(0, node_test_1.describe)("resolveWallboxBatteryHold — single EV-hold authority", () => {
    (0, node_test_1.it)("disconnected + EVCC now never holds (leftover mode is not an EV action)", () => {
        const r = hold({
            vehicleConnected: false,
            charging: false,
            chargePowerW: 0,
            loadpointMode: "now",
            batteryBoost: true,
            externalVehicleChargeRaw: "ChargingAC",
            tibberGridRewardsActive: true,
        });
        strict_1.default.equal(r.hold, false);
        strict_1.default.equal(r.boostActive, false);
        strict_1.default.equal(r.externalActive, false);
        strict_1.default.equal(r.tibberRewardsActive, false);
        strict_1.default.match(r.reasonDe, /kein fahrzeug verbunden/i);
    });
    (0, node_test_1.it)("connected + leftover now without charging does not hold", () => {
        const r = hold({
            charging: false,
            chargePowerW: 0,
            loadpointMode: "now",
            batteryBoost: false,
        });
        strict_1.default.equal(r.hold, false);
        strict_1.default.equal(r.boostActive, false);
    });
    (0, node_test_1.it)("holds on batteryBoost only while the vehicle is actually charging", () => {
        const r = hold({
            batteryBoost: true,
            loadpointMode: "pv",
            charging: true,
            chargePowerW: 4000,
        });
        strict_1.default.equal(r.hold, true);
        strict_1.default.equal(r.boostActive, true);
        strict_1.default.match(r.reasonDe, /Boost/i);
    });
    (0, node_test_1.it)("holds on loadpoint mode now only while connected and charging", () => {
        const r = hold({
            batteryBoost: false,
            loadpointMode: "now",
            charging: true,
            chargePowerW: 11000,
        });
        strict_1.default.equal(r.hold, true);
        strict_1.default.equal(r.boostActive, true);
    });
    (0, node_test_1.it)("does not hold on minpv/pv without boost/external/tibber", () => {
        for (const mode of ["minpv", "pv", "off"]) {
            const r = hold({
                batteryBoost: false,
                loadpointMode: mode,
                charging: true,
                chargePowerW: 2000,
            });
            strict_1.default.equal(r.hold, false, mode);
            strict_1.default.equal(r.boostActive, false, mode);
        }
    });
    (0, node_test_1.it)("does not treat HA charging as external hold during minpv/pv", () => {
        const r = hold({
            batteryBoost: null,
            loadpointMode: "minpv",
            externalVehicleChargeRaw: "ChargingAC",
            tibberGridRewardsActive: false,
            charging: true,
            chargePowerW: 3500,
        });
        strict_1.default.equal(r.hold, false);
        strict_1.default.equal(r.externalActive, false);
    });
    (0, node_test_1.it)("holds on external vehicle charge when mode is not pv/minpv and vehicle is charging", () => {
        const r = hold({
            batteryBoost: null,
            loadpointMode: "off",
            externalVehicleChargeRaw: "ChargingAC",
            tibberGridRewardsActive: false,
            charging: true,
            chargePowerW: 7000,
        });
        strict_1.default.equal(r.hold, true);
        strict_1.default.equal(r.externalActive, true);
        strict_1.default.equal(r.tibberRewardsActive, false);
    });
    (0, node_test_1.it)("holds on tibber only when explicitly true and vehicle is connected", () => {
        const off = hold({
            batteryBoost: false,
            loadpointMode: "pv",
            charging: false,
            chargePowerW: 0,
            externalVehicleChargeRaw: null,
            tibberGridRewardsActive: false,
        });
        strict_1.default.equal(off.hold, false);
        strict_1.default.equal(off.tibberRewardsActive, false);
        const on = hold({
            batteryBoost: false,
            loadpointMode: "pv",
            charging: false,
            chargePowerW: 0,
            externalVehicleChargeRaw: null,
            tibberGridRewardsActive: true,
        });
        strict_1.default.equal(on.hold, true);
        strict_1.default.equal(on.tibberRewardsActive, true);
    });
    (0, node_test_1.it)("isEvVehiclePresent / isEvActuallyCharging are strict", () => {
        strict_1.default.equal((0, charge_hold_1.isEvVehiclePresent)(false), false);
        strict_1.default.equal((0, charge_hold_1.isEvVehiclePresent)(null), false);
        strict_1.default.equal((0, charge_hold_1.isEvVehiclePresent)(true), true);
        strict_1.default.equal((0, charge_hold_1.isEvActuallyCharging)({ charging: false, chargePowerW: 0 }), false);
        strict_1.default.equal((0, charge_hold_1.isEvActuallyCharging)({ charging: true, chargePowerW: 0 }), true);
        strict_1.default.equal((0, charge_hold_1.isEvActuallyCharging)({ charging: false, chargePowerW: 80 }), true);
    });
});
