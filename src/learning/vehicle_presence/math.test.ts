import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	CONFIDENCE_TARGET_SAMPLES,
	MIN_OBSERVATIONS_FOR_PREDICTION,
	PREDICT_AVAILABLE_RATIO,
	PREDICT_UNAVAILABLE_RATIO,
} from "./constants";
import { predictFromCounts } from "./math";

describe("vehicle presence learning thresholds", () => {
	it("requires named minimum observations before predicting", () => {
		assert.ok(MIN_OBSERVATIONS_FOR_PREDICTION >= 5);
		assert.equal(predictFromCounts(0, MIN_OBSERVATIONS_FOR_PREDICTION - 1).status, "unknown");
	});

	it("uses availability ratios as named constants", () => {
		assert.ok(PREDICT_AVAILABLE_RATIO > 0.5);
		assert.ok(PREDICT_UNAVAILABLE_RATIO < 0.5);
		const n = CONFIDENCE_TARGET_SAMPLES;
		assert.equal(predictFromCounts(Math.ceil(n * PREDICT_AVAILABLE_RATIO), n).status, "available");
		assert.equal(predictFromCounts(Math.floor(n * PREDICT_UNAVAILABLE_RATIO), n).status, "unavailable");
	});
});
