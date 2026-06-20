import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	PV_HORIZON_BIAS_WEIGHT_BY_DAY,
	PV_HORIZON_CONFIDENCE_DECAY_PP_PER_DAY,
	PV_HORIZON_EXTENDED_DAY_COUNT,
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

	it("computes full 7 days without skip", () => {
		const raws = [10, 11, 12, 13, 14, 15, 16];
		const result = computePvHorizon(raws, -10, 70);
		assert.equal(result.daysAvailable, 7);
		assert.equal(result.expectedDays, 7);
		assert.equal(result.status, "ready");
		assert.equal(result.total7dRawKwh, 91);
		assert.ok(result.total7dCorrectedKwh !== null && result.total7dCorrectedKwh < 91);
		assert.equal(result.days[0].confidencePct, 70);
		assert.equal(result.days[6].confidencePct, 70 - 6 * PV_HORIZON_CONFIDENCE_DECAY_PP_PER_DAY);
	});

	it("skips day1+2 when pv forecast covers short horizon", () => {
		const raws: Array<number | null> = [99, 99, 30, 31, 32, 33, 34];
		const result = computePvHorizon(raws, -10, 50, { skipDayIndices: [1, 2] });
		assert.deepEqual(result.skippedDayIndices, [1, 2]);
		assert.equal(result.days[0].rawKwh, null);
		assert.equal(result.days[1].rawKwh, null);
		assert.equal(result.days[2].rawKwh, 30);
		assert.equal(result.daysAvailable, 5);
		assert.equal(result.expectedDays, PV_HORIZON_EXTENDED_DAY_COUNT);
		assert.equal(result.status, "ready");
		assert.equal(result.total7dRawKwh, 160);
	});

	it("reports no_extended_days when only short horizon is configured", () => {
		const raws: Array<number | null> = [10, 11, null, null, null, null, null];
		const result = computePvHorizon(raws, -10, 50, { skipDayIndices: [1, 2] });
		assert.equal(result.daysAvailable, 0);
		assert.equal(result.status, "no_extended_days");
		assert.equal(result.total7dRawKwh, null);
	});

	it("handles partial extended days (3 of 5)", () => {
		const raws: Array<number | null> = [null, null, 20, 21, 22, null, null];
		const result = computePvHorizon(raws, -10, 50, { skipDayIndices: [1, 2] });
		assert.equal(result.daysAvailable, 3);
		assert.equal(result.status, "partial");
		assert.equal(result.total7dRawKwh, 63);
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
