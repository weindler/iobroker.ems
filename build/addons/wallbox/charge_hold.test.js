"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const charge_hold_1 = require("./charge_hold");
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
(0, node_test_1.describe)("resolveWallboxBatteryHold", () => {
    (0, node_test_1.it)("holds on batteryBoost", () => {
        const r = (0, charge_hold_1.resolveWallboxBatteryHold)({
            batteryBoost: true,
            loadpointMode: "pv",
            externalVehicleChargeRaw: null,
            tibberGridRewardsActive: null,
        });
        strict_1.default.equal(r.hold, true);
        strict_1.default.equal(r.boostActive, true);
        strict_1.default.match(r.reasonDe, /Boost/i);
    });
    (0, node_test_1.it)("holds on loadpoint mode now", () => {
        const r = (0, charge_hold_1.resolveWallboxBatteryHold)({
            batteryBoost: false,
            loadpointMode: "now",
            externalVehicleChargeRaw: null,
            tibberGridRewardsActive: null,
        });
        strict_1.default.equal(r.hold, true);
        strict_1.default.equal(r.boostActive, true);
    });
    (0, node_test_1.it)("does not hold on minpv/pv", () => {
        for (const mode of ["minpv", "pv", "off"]) {
            const r = (0, charge_hold_1.resolveWallboxBatteryHold)({
                batteryBoost: false,
                loadpointMode: mode,
                externalVehicleChargeRaw: null,
                tibberGridRewardsActive: null,
            });
            strict_1.default.equal(r.hold, false, mode);
            strict_1.default.equal(r.boostActive, false, mode);
        }
    });
    (0, node_test_1.it)("does not treat HA charging as external hold during minpv/pv", () => {
        const r = (0, charge_hold_1.resolveWallboxBatteryHold)({
            batteryBoost: null,
            loadpointMode: "minpv",
            externalVehicleChargeRaw: "ChargingAC",
            tibberGridRewardsActive: false,
        });
        strict_1.default.equal(r.hold, false);
        strict_1.default.equal(r.externalActive, false);
    });
    (0, node_test_1.it)("holds on external vehicle charge when mode is not pv/minpv", () => {
        const r = (0, charge_hold_1.resolveWallboxBatteryHold)({
            batteryBoost: null,
            loadpointMode: "off",
            externalVehicleChargeRaw: "ChargingAC",
            tibberGridRewardsActive: false,
        });
        strict_1.default.equal(r.hold, true);
        strict_1.default.equal(r.externalActive, true);
        strict_1.default.equal(r.tibberRewardsActive, false);
    });
    (0, node_test_1.it)("holds on tibber only when explicitly true", () => {
        const off = (0, charge_hold_1.resolveWallboxBatteryHold)({
            batteryBoost: false,
            loadpointMode: "pv",
            externalVehicleChargeRaw: null,
            tibberGridRewardsActive: false,
        });
        strict_1.default.equal(off.hold, false);
        strict_1.default.equal(off.tibberRewardsActive, false);
        const on = (0, charge_hold_1.resolveWallboxBatteryHold)({
            batteryBoost: false,
            loadpointMode: "pv",
            externalVehicleChargeRaw: null,
            tibberGridRewardsActive: true,
        });
        strict_1.default.equal(on.hold, true);
        strict_1.default.equal(on.tibberRewardsActive, true);
    });
});
