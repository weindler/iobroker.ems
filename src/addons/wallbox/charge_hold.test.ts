import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	interpretExternalVehicleCharge,
	isEvActuallyCharging,
	isEvVehiclePresent,
	resolveWallboxBatteryHold,
} from "./charge_hold";

function hold(over: Partial<Parameters<typeof resolveWallboxBatteryHold>[0]> = {}) {
	return resolveWallboxBatteryHold({
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

describe("interpretExternalVehicleCharge", () => {
	it("treats charging-like HA values as active", () => {
		assert.equal(interpretExternalVehicleCharge("Charging"), true);
		assert.equal(interpretExternalVehicleCharge("ChargingAC"), true);
		assert.equal(interpretExternalVehicleCharge("ChargingDC"), true);
		assert.equal(interpretExternalVehicleCharge("IN_PROGRESS"), true);
		assert.equal(interpretExternalVehicleCharge(true), true);
	});

	it("treats complete/ready/disconnected as inactive", () => {
		assert.equal(interpretExternalVehicleCharge("COMPLETE"), false);
		assert.equal(interpretExternalVehicleCharge("READY"), false);
		assert.equal(interpretExternalVehicleCharge("NOT_READY"), false);
		assert.equal(interpretExternalVehicleCharge("DISCONNECTED"), false);
		assert.equal(interpretExternalVehicleCharge(false), false);
	});

	it("is conservative on unknown strings", () => {
		assert.equal(interpretExternalVehicleCharge("Idle"), false);
		assert.equal(interpretExternalVehicleCharge("not charging"), false);
		assert.equal(interpretExternalVehicleCharge(null), false);
	});
});

describe("resolveWallboxBatteryHold — single EV-hold authority", () => {
	it("disconnected + EVCC now never holds (leftover mode is not an EV action)", () => {
		const r = hold({
			vehicleConnected: false,
			charging: false,
			chargePowerW: 0,
			loadpointMode: "now",
			batteryBoost: true,
			externalVehicleChargeRaw: "ChargingAC",
			tibberGridRewardsActive: true,
		});
		assert.equal(r.hold, false);
		assert.equal(r.boostActive, false);
		assert.equal(r.externalActive, false);
		assert.equal(r.tibberRewardsActive, false);
		assert.match(r.reasonDe, /kein fahrzeug verbunden/i);
	});

	it("connected + leftover now without charging does not hold", () => {
		const r = hold({
			charging: false,
			chargePowerW: 0,
			loadpointMode: "now",
			batteryBoost: false,
		});
		assert.equal(r.hold, false);
		assert.equal(r.boostActive, false);
	});

	it("holds on batteryBoost only while the vehicle is actually charging", () => {
		const r = hold({
			batteryBoost: true,
			loadpointMode: "pv",
			charging: true,
			chargePowerW: 4000,
		});
		assert.equal(r.hold, true);
		assert.equal(r.boostActive, true);
		assert.match(r.reasonDe, /Boost/i);
	});

	it("holds on loadpoint mode now only while connected and charging", () => {
		const r = hold({
			batteryBoost: false,
			loadpointMode: "now",
			charging: true,
			chargePowerW: 11000,
		});
		assert.equal(r.hold, true);
		assert.equal(r.boostActive, true);
	});

	it("does not hold on minpv/pv without boost/external/tibber", () => {
		for (const mode of ["minpv", "pv", "off"]) {
			const r = hold({
				batteryBoost: false,
				loadpointMode: mode,
				charging: true,
				chargePowerW: 2000,
			});
			assert.equal(r.hold, false, mode);
			assert.equal(r.boostActive, false, mode);
		}
	});

	it("does not treat HA charging as external hold during minpv/pv", () => {
		const r = hold({
			batteryBoost: null,
			loadpointMode: "minpv",
			externalVehicleChargeRaw: "ChargingAC",
			tibberGridRewardsActive: false,
			charging: true,
			chargePowerW: 3500,
		});
		assert.equal(r.hold, false);
		assert.equal(r.externalActive, false);
	});

	it("holds on external vehicle charge when mode is not pv/minpv and vehicle is charging", () => {
		const r = hold({
			batteryBoost: null,
			loadpointMode: "off",
			externalVehicleChargeRaw: "ChargingAC",
			tibberGridRewardsActive: false,
			charging: true,
			chargePowerW: 7000,
		});
		assert.equal(r.hold, true);
		assert.equal(r.externalActive, true);
		assert.equal(r.tibberRewardsActive, false);
	});

	it("holds on tibber only when explicitly true and vehicle is connected", () => {
		const off = hold({
			batteryBoost: false,
			loadpointMode: "pv",
			charging: false,
			chargePowerW: 0,
			externalVehicleChargeRaw: null,
			tibberGridRewardsActive: false,
		});
		assert.equal(off.hold, false);
		assert.equal(off.tibberRewardsActive, false);

		const on = hold({
			batteryBoost: false,
			loadpointMode: "pv",
			charging: false,
			chargePowerW: 0,
			externalVehicleChargeRaw: null,
			tibberGridRewardsActive: true,
		});
		assert.equal(on.hold, true);
		assert.equal(on.tibberRewardsActive, true);
	});

	it("isEvVehiclePresent / isEvActuallyCharging are strict", () => {
		assert.equal(isEvVehiclePresent(false), false);
		assert.equal(isEvVehiclePresent(null), false);
		assert.equal(isEvVehiclePresent(true), true);
		assert.equal(isEvActuallyCharging({ charging: false, chargePowerW: 0 }), false);
		assert.equal(isEvActuallyCharging({ charging: true, chargePowerW: 0 }), true);
		assert.equal(isEvActuallyCharging({ charging: false, chargePowerW: 80 }), true);
	});
});
