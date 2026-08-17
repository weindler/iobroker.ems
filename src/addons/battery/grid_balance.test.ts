import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	computeGridBalanceTarget,
	evaluateGridBalanceMinPrice,
	resolveController,
} from "./grid_balance.js";

describe("grid balance", () => {
	const baseInputs = {
		effectiveRestOfDayKwh: 15,
		capacityWh: 10_000,
		snowCoverSuspected: false,
		consumptionW: 2000,
		pvAcPowerW: 500,
		socPct: 50,
		emsGridBalanceEnabled: true,
		adapterFeatureEnabled: true,
		controller: "grid_balance" as const,
		offsetHighSocW: 25,
		offsetLowSocW: 10,
		socThresholdPct: 20,
		evccCharging: false,
		batteryHoldActive: false,
		winterGridPlanActive: false,
		mode1Active: false,
		dailyPlanAuthoritative: false,
		priceNowCt: 36.7,
		minPriceCtPerKwh: 30,
	};

	it("resolves controller to idle when suppressed", () => {
		assert.equal(
			resolveController({
				emsBatteryIntentActive: false,
				emsGridBalanceEnabled: true,
				adapterFeatureEnabled: true,
				batteryAddonEnabled: true,
				gridBalancePaused: false,
				gridBalanceSuppressed: true,
			}),
			"idle",
		);
	});

	it("blocks on evcc charging", () => {
		const r = computeGridBalanceTarget({ ...baseInputs, evccCharging: true });
		assert.equal(r.gatePassed, false);
		assert.match(r.reasonDe, /EVCC/);
	});

	it("blocks when daily plan is authoritative", () => {
		const r = computeGridBalanceTarget({ ...baseInputs, dailyPlanAuthoritative: true });
		assert.equal(r.gatePassed, false);
		assert.match(r.reasonDe, /Daily Plan/);
	});

	it("allows price at and above the minimum", () => {
		assert.equal(evaluateGridBalanceMinPrice({ minPriceCtPerKwh: 30, priceNowCt: 30 }).passed, true);
		assert.equal(evaluateGridBalanceMinPrice({ minPriceCtPerKwh: 30, priceNowCt: 36.7 }).passed, true);
		assert.equal(evaluateGridBalanceMinPrice({ minPriceCtPerKwh: 30, priceNowCt: 50 }).passed, true);
	});

	it("blocks price below the minimum", () => {
		assert.equal(evaluateGridBalanceMinPrice({ minPriceCtPerKwh: 30, priceNowCt: 20 }).passed, false);
		assert.equal(evaluateGridBalanceMinPrice({ minPriceCtPerKwh: 30, priceNowCt: 29.99 }).passed, false);
	});

	it("rejects cheap price when computing target", () => {
		const r = computeGridBalanceTarget({
			...baseInputs,
			priceNowCt: 20,
			minPriceCtPerKwh: 30,
		});
		assert.equal(r.gatePassed, false);
		assert.match(r.reasonDe, /Mindestpreis/);
		assert.ok(r.checksFailed.includes("price_below_minimum"));
	});

	it("computes target when all gates pass", () => {
		const r = computeGridBalanceTarget(baseInputs);
		assert.equal(r.gatePassed, true);
		assert.ok(r.targetDischargeW > 0);
	});
});
