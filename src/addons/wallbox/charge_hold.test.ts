import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { interpretExternalVehicleCharge, resolveWallboxBatteryHold } from "./charge_hold";

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

describe("resolveWallboxBatteryHold", () => {
	it("holds on batteryBoost", () => {
		const r = resolveWallboxBatteryHold({
			batteryBoost: true,
			loadpointMode: "pv",
			externalVehicleChargeRaw: null,
			tibberGridRewardsActive: null,
		});
		assert.equal(r.hold, true);
		assert.equal(r.boostActive, true);
		assert.match(r.reasonDe, /Boost/i);
	});

	it("holds on loadpoint mode now", () => {
		const r = resolveWallboxBatteryHold({
			batteryBoost: false,
			loadpointMode: "now",
			externalVehicleChargeRaw: null,
			tibberGridRewardsActive: null,
		});
		assert.equal(r.hold, true);
		assert.equal(r.boostActive, true);
	});

	it("does not hold on minpv/pv", () => {
		for (const mode of ["minpv", "pv", "off"]) {
			const r = resolveWallboxBatteryHold({
				batteryBoost: false,
				loadpointMode: mode,
				externalVehicleChargeRaw: null,
				tibberGridRewardsActive: null,
			});
			assert.equal(r.hold, false, mode);
			assert.equal(r.boostActive, false, mode);
		}
	});

	it("does not treat HA charging as external hold during minpv/pv", () => {
		const r = resolveWallboxBatteryHold({
			batteryBoost: null,
			loadpointMode: "minpv",
			externalVehicleChargeRaw: "ChargingAC",
			tibberGridRewardsActive: false,
		});
		assert.equal(r.hold, false);
		assert.equal(r.externalActive, false);
	});

	it("holds on external vehicle charge when mode is not pv/minpv", () => {
		const r = resolveWallboxBatteryHold({
			batteryBoost: null,
			loadpointMode: "off",
			externalVehicleChargeRaw: "ChargingAC",
			tibberGridRewardsActive: false,
		});
		assert.equal(r.hold, true);
		assert.equal(r.externalActive, true);
		assert.equal(r.tibberRewardsActive, false);
	});

	it("holds on tibber only when explicitly true", () => {
		const off = resolveWallboxBatteryHold({
			batteryBoost: false,
			loadpointMode: "pv",
			externalVehicleChargeRaw: null,
			tibberGridRewardsActive: false,
		});
		assert.equal(off.hold, false);
		assert.equal(off.tibberRewardsActive, false);

		const on = resolveWallboxBatteryHold({
			batteryBoost: false,
			loadpointMode: "pv",
			externalVehicleChargeRaw: null,
			tibberGridRewardsActive: true,
		});
		assert.equal(on.hold, true);
		assert.equal(on.tibberRewardsActive, true);
	});
});
