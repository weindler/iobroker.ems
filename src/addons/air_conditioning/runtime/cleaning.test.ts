import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isCleaningFinishedByFeedback, isCleaningOperatingActive } from "./cleaning";

describe("ac cleaning feedback", () => {
	it("detects active operating states", () => {
		assert.equal(isCleaningOperatingActive("autoClean"), true);
		assert.equal(isCleaningOperatingActive("ready"), false);
	});

	it("finishes only after active phase was seen", () => {
		assert.equal(
			isCleaningFinishedByFeedback({
				operatingStateRaw: "ready",
				modeRaw: "on",
				sawOperatingActive: false,
			}),
			false,
		);
		assert.equal(
			isCleaningFinishedByFeedback({
				operatingStateRaw: "ready",
				modeRaw: "on",
				sawOperatingActive: true,
			}),
			true,
		);
		assert.equal(
			isCleaningFinishedByFeedback({
				operatingStateRaw: "autoClean",
				modeRaw: "off",
				sawOperatingActive: true,
			}),
			true,
		);
	});
});
