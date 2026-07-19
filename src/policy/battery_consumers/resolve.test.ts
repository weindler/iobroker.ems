import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	batteryConsumersConfigFromAdapter,
	immersionCriticalNow,
	resolveBatteryConsumerAccess,
} from "./index.js";

describe("battery consumers policy", () => {
	it("defaults: no consumer may use battery", () => {
		const cfg = batteryConsumersConfigFromAdapter({});
		assert.equal(cfg.immersion_heater.mayUseBattery, false);
		assert.equal(cfg.immersion_heater.onlyWhenCritical, true);
		assert.equal(cfg.immersion_heater.minSocPct, 50);
		assert.equal(cfg.air_conditioning.mayUseBattery, false);
		assert.equal(cfg.wallbox.mayUseBattery, false);
	});

	it("blocks on hold even when policy allows", () => {
		const r = resolveBatteryConsumerAccess({
			consumerId: "immersion_heater",
			rule: { mayUseBattery: true, onlyWhenCritical: false, minSocPct: 50, criticalMarginK: 2 },
			batteryHoldActive: true,
			socPct: 80,
			criticalNow: true,
		});
		assert.equal(r.allowed, false);
		assert.match(r.reasonDe, /Hold/);
	});

	it("blocks at SOC floor", () => {
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

	it("only-critical requires criticalNow", () => {
		const idle = resolveBatteryConsumerAccess({
			consumerId: "immersion_heater",
			rule: { mayUseBattery: true, onlyWhenCritical: true, minSocPct: 40, criticalMarginK: 2 },
			batteryHoldActive: false,
			socPct: 70,
			criticalNow: false,
		});
		assert.equal(idle.allowed, false);
		const crit = resolveBatteryConsumerAccess({
			consumerId: "immersion_heater",
			rule: { mayUseBattery: true, onlyWhenCritical: true, minSocPct: 40, criticalMarginK: 2 },
			batteryHoldActive: false,
			socPct: 70,
			criticalNow: true,
		});
		assert.equal(crit.allowed, true);
	});

	it("immersionCriticalNow uses margin", () => {
		assert.equal(immersionCriticalNow(42, 40, 2), true);
		assert.equal(immersionCriticalNow(43, 40, 2), false);
		assert.equal(immersionCriticalNow(null, 40, 2), null);
	});
});
