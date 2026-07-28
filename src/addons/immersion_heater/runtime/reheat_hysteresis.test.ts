import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isImmersionReheatHysteresisActive } from "./reheat_hysteresis";

describe("immersion reheat hysteresis", () => {
	it("blocks when target was reached and buffer still above Ziel − Hysterese", () => {
		assert.equal(
			isImmersionReheatHysteresisActive({
				bufferTempC: 48,
				targetTempC: 51.6,
				hysteresisK: 5,
				autoTargetReached: true,
			}),
			true,
		);
	});

	it("releases when buffer cools below Ziel − Hysterese", () => {
		assert.equal(
			isImmersionReheatHysteresisActive({
				bufferTempC: 46,
				targetTempC: 51.6,
				hysteresisK: 5,
				autoTargetReached: true,
			}),
			false,
		);
	});

	it("does not block before the target was ever reached", () => {
		assert.equal(
			isImmersionReheatHysteresisActive({
				bufferTempC: 48,
				targetTempC: 51.6,
				hysteresisK: 5,
				autoTargetReached: false,
			}),
			false,
		);
	});
});
