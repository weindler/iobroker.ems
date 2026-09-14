import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	batteryConsumersConfigFromAdapter,
	immersionCriticalNow,
	resolveBatteryConsumerAccess,
} from "./index.js";

describe("battery consumers policy", () => {
	it("defaults to automatic support without fixed per-consumer SOC floors", () => {
		const cfg = batteryConsumersConfigFromAdapter({});
		for (const id of ["immersion_heater", "air_conditioning", "wallbox"] as const) {
			assert.equal(cfg[id].mayUseBattery, true);
			assert.equal(cfg[id].onlyWhenCritical, false);
			assert.equal(cfg[id].minSocPct, null);
		}
		assert.equal(cfg.maxDischargePowerW, null);
	});

	it("one automatic-support switch controls all flexible consumers", () => {
		const cfg = batteryConsumersConfigFromAdapter({ bat_consumer_auto_support: false });
		assert.equal(cfg.immersion_heater.mayUseBattery, false);
		assert.equal(cfg.air_conditioning.mayUseBattery, false);
		assert.equal(cfg.wallbox.mayUseBattery, false);
	});

	it("ignores legacy per-consumer switches, SOC floors and power budget", () => {
		const cfg = batteryConsumersConfigFromAdapter({
			bat_consumer_auto_support: true,
			bat_consumer_immersion_may_use_battery: false,
			bat_consumer_immersion_only_when_critical: true,
			bat_consumer_immersion_min_soc_pct: 99,
			bat_consumer_max_discharge_w: 1,
		});
		assert.equal(cfg.immersion_heater.mayUseBattery, true);
		assert.equal(cfg.immersion_heater.onlyWhenCritical, false);
		assert.equal(cfg.immersion_heater.minSocPct, null);
		assert.equal(cfg.maxDischargePowerW, null);
	});

	it("blocks on hold even when automatic support is enabled", () => {
		const r = resolveBatteryConsumerAccess({
			consumerId: "immersion_heater",
			rule: { mayUseBattery: true, onlyWhenCritical: false, minSocPct: null, criticalMarginK: 2 },
			batteryHoldActive: true,
			socPct: 80,
			criticalNow: true,
		});
		assert.equal(r.allowed, false);
		assert.match(r.reasonDe, /Hold/);
	});

	it("generic access still honours an explicit safety floor", () => {
		const r = resolveBatteryConsumerAccess({
			consumerId: "immersion_heater",
			rule: { mayUseBattery: true, onlyWhenCritical: false, minSocPct: 50, criticalMarginK: 2 },
			batteryHoldActive: false,
			socPct: 50,
			criticalNow: true,
		});
		assert.equal(r.allowed, false);
		assert.match(r.reasonDe, /Boden/);
	});

	it("immersionCriticalNow keeps the thermal emergency classification", () => {
		assert.equal(immersionCriticalNow(42, 40, 2), true);
		assert.equal(immersionCriticalNow(43, 40, 2), false);
		assert.equal(immersionCriticalNow(null, 40, 2), null);
	});
});
