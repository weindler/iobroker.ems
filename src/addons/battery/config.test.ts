import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { batteryConfigFromAdapter, batteryProfileIdFromConfig } from "./config.js";

describe("battery config", () => {
	it("maps legacy 'sonnen' profile to sonnen_em", () => {
		assert.equal(batteryProfileIdFromConfig({ battery_profile: "sonnen" }), "sonnen_em");
		assert.equal(batteryProfileIdFromConfig({ battery_profile: "sonnen_em" }), "sonnen_em");
		assert.equal(batteryProfileIdFromConfig({ battery_profile: "generic_readonly" }), "generic_readonly");
	});

	it("manual capacity parsed", () => {
		const c = batteryConfigFromAdapter({ battery_capacity_source: "manual", battery_capacity_net_kwh: 10 });
		assert.equal(c.capacitySource, "manual");
		assert.equal(c.capacityManualKwh, 10);
	});

	it("sign convention defaults to positive_charge", () => {
		assert.equal(batteryConfigFromAdapter({}).signConvention, "positive_charge");
		assert.equal(
			batteryConfigFromAdapter({ battery_power_sign_convention: "positive_discharge" }).signConvention,
			"positive_discharge",
		);
	});

	it("sonnen mode value defaults manual=1 self=2", () => {
		const c = batteryConfigFromAdapter({});
		assert.equal(c.sonnenModeValues.manual, 1);
		assert.equal(c.sonnenModeValues.selfConsumption, 2);
	});

	it("grid balance defaults", () => {
		const c = batteryConfigFromAdapter({});
		assert.equal(c.gridBalance.enabled, false);
		assert.equal(c.gridBalance.offsetHighSocW, 25);
	});
});
