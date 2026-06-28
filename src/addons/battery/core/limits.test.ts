import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hardwareLimitsFromConfig, hasDischargeCapability } from "./limits.js";

describe("battery hardware limits", () => {
	it("valid limits accepted", () => {
		const l = hardwareLimitsFromConfig({
			bat_hw_max_charge_w: 5000,
			bat_hw_max_discharge_w: 5000,
			bat_hw_min_soc_pct: 5,
			bat_hw_max_soc_pct: 100,
		});
		assert.equal(l.valid, true);
		assert.deepEqual(l.issues, []);
	});

	it("rejects max_charge_w <= 0", () => {
		const l = hardwareLimitsFromConfig({ bat_hw_max_charge_w: 0, bat_hw_min_soc_pct: 5, bat_hw_max_soc_pct: 100 });
		assert.equal(l.valid, false);
		assert.ok(l.issues.includes("max_charge_w_invalid"));
	});

	it("rejects min_soc >= max_soc", () => {
		const l = hardwareLimitsFromConfig({
			bat_hw_max_charge_w: 5000,
			bat_hw_min_soc_pct: 90,
			bat_hw_max_soc_pct: 80,
		});
		assert.equal(l.valid, false);
		assert.ok(l.issues.includes("soc_limits_invalid"));
	});

	it("missing discharge means no discharge capability", () => {
		const l = hardwareLimitsFromConfig({
			bat_hw_max_charge_w: 5000,
			bat_hw_min_soc_pct: 5,
			bat_hw_max_soc_pct: 100,
		});
		assert.equal(hasDischargeCapability(l), false);
	});
});
