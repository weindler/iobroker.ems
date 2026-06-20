import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	PV_HORIZON_BIAS_WEIGHT_BY_DAY,
	PV_HORIZON_CONFIDENCE_DECAY_PP_PER_DAY,
} from "./constants";
import {
	computePvHorizon,
	correctHorizonKwh,
	effectiveBiasPct,
	horizonDayConfidencePct,
} from "./math";

describe("pv_horizon math", () => {
	it("applies negative bias with day1 full weight", () => {
		const eff = effectiveBiasPct(-20, 1);
		assert.equal(eff, -20);
		assert.equal(correctHorizonKwh(100, -20, 1), 80);
	});

	it("applies positive bias with reduced weight on day7", () => {
		const eff = effectiveBiasPct(20, 7);
		assert.equal(eff, 20 * PV_HORIZON_BIAS_WEIGHT_BY_DAY[6]);
		assert.equal(correctHorizonKwh(100, 20, 7), 108);
	});

	it("computes full 7 days", () => {
		const raws = [10, 11, 12, 13, 14, 15, 16];
		const result = computePvHorizon(raws, -10, 70);
		assert.equal(result.daysAvailable, 7);
		assert.equal(result.status, "ready");
		assert.equal(result.total7dRawKwh, 91);
		assert.ok(result.total7dCorrectedKwh !== null && result.total7dCorrectedKwh < 91);
		assert.equal(result.days[0].confidencePct, 70);
		assert.equal(result.days[6].confidencePct, 70 - 6 * PV_HORIZON_CONFIDENCE_DECAY_PP_PER_DAY);
	});

	it("handles only 3 days available", () => {
		const raws: Array<number | null> = [20, 21, 22, null, null, null, null];
		const result = computePvHorizon(raws, -10, 50);
		assert.equal(result.daysAvailable, 3);
		assert.equal(result.status, "partial");
		assert.equal(result.total7dRawKwh, 63);
		assert.equal(result.days[3].rawKwh, null);
		assert.equal(result.days[3].correctedKwh, null);
	});

	it("skips missing forecast without zero", () => {
		const result = computePvHorizon([null, null, null, null, null, null, null], -10, 50);
		assert.equal(result.daysAvailable, 0);
		assert.equal(result.status, "no_data");
		assert.equal(result.total7dRawKwh, null);
	});

	it("reports no_bias when bias missing", () => {
		const result = computePvHorizon([30, 31, 32, null, null, null, null], null, 40);
		assert.equal(result.status, "no_bias");
		assert.equal(result.days[0].correctedKwh, null);
		assert.equal(result.days[0].rawKwh, 30);
	});

	it("inherits confidence from phase 2a base", () => {
		const result = computePvHorizon([5, 5, 5, 5, 5, 5, 5], 0, 19);
		assert.equal(result.days[0].confidencePct, 19);
		assert.equal(result.days[1].confidencePct, 16);
	});
});
