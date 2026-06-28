import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkChargeFeedback, checkModeFeedback, chargeWithinTolerance } from "./feedback.js";

describe("battery feedback", () => {
	it("mode feedback ok when actual matches", () => {
		assert.equal(checkModeFeedback({ expectedMode: 1, actualMode: 1, elapsedMs: 0, timeoutMs: 1000 }), "ok");
	});

	it("mode feedback pending then timeout", () => {
		assert.equal(checkModeFeedback({ expectedMode: 1, actualMode: 2, elapsedMs: 0, timeoutMs: 1000 }), "pending");
		assert.equal(checkModeFeedback({ expectedMode: 1, actualMode: 2, elapsedMs: 1000, timeoutMs: 1000 }), "timeout");
	});

	it("charge within tolerance (absolute and relative)", () => {
		const tol = { absoluteW: 500, relativePct: 10 };
		assert.equal(chargeWithinTolerance(2000, 2300, tol), true);
		assert.equal(chargeWithinTolerance(2000, 2600, tol), false);
		assert.equal(chargeWithinTolerance(10000, 10900, tol), true);
	});

	it("charge feedback timeout on deviation", () => {
		const tol = { absoluteW: 100, relativePct: 5 };
		assert.equal(
			checkChargeFeedback({ expectedW: 2000, actualChargingW: 0, elapsedMs: 5000, timeoutMs: 1000, tolerance: tol }),
			"timeout",
		);
	});
});
