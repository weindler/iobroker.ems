import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	computeGridBalanceTarget,
	evaluateGridBalancePriceGate,
	medianCtFromPriceSlots,
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
		priceNowCt: 22,
		priceMedianCt: 28,
		priceGate: { enabled: true, maxPriceCtPerKwh: null as number | null, medianFactor: 1.05 },
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

	it("passes price gate on absolute threshold", () => {
		const r = evaluateGridBalancePriceGate({
			gate: { enabled: true, maxPriceCtPerKwh: 30, medianFactor: 0 },
			priceNowCt: 22,
			referenceMedianCt: 40,
		});
		assert.equal(r.passed, true);
	});

	it("passes price gate on median factor", () => {
		const r = evaluateGridBalancePriceGate({
			gate: { enabled: true, maxPriceCtPerKwh: null, medianFactor: 1.05 },
			priceNowCt: 29,
			referenceMedianCt: 28,
		});
		assert.equal(r.passed, true);
	});

	it("rejects expensive price when gate enabled", () => {
		const r = computeGridBalanceTarget({
			...baseInputs,
			priceNowCt: 45,
			priceMedianCt: 30,
			priceGate: { enabled: true, maxPriceCtPerKwh: 30, medianFactor: 1.0 },
		});
		assert.equal(r.gatePassed, false);
		assert.match(r.reasonDe, /Preis/);
	});

	it("computes target when all gates pass", () => {
		const r = computeGridBalanceTarget(baseInputs);
		assert.equal(r.gatePassed, true);
		assert.ok(r.targetBatteryChargingW > 0);
	});

	it("computes median from slots", () => {
		const m = medianCtFromPriceSlots([
			{ slotStartMs: 0, priceCtPerKwh: 20 },
			{ slotStartMs: 1, priceCtPerKwh: 30 },
			{ slotStartMs: 2, priceCtPerKwh: 40 },
		]);
		assert.equal(m, 30);
	});
});
