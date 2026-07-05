import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	isCleaningFinishedByFeedback,
	isCleaningOperatingActive,
	shouldMarkCleaningOperatingActive,
} from "./cleaning";

describe("ac cleaning feedback", () => {
	it("detects active operating states", () => {
		assert.equal(isCleaningOperatingActive("autoClean"), true);
		assert.equal(isCleaningOperatingActive("ready"), false);
	});

	it("ignores autoClean flicker in the first minute", () => {
		assert.equal(shouldMarkCleaningOperatingActive("autoClean", 12), false);
		assert.equal(shouldMarkCleaningOperatingActive("autoClean", 90), true);
	});

	it("does not finish on idle ready shortly after start", () => {
		assert.equal(
			isCleaningFinishedByFeedback({
				operatingStateRaw: "ready",
				modeRaw: "on",
				sawOperatingActive: true,
				elapsedSec: 12,
			}),
			false,
		);
	});

	it("finishes on ready after minimum runtime once autoClean was seen", () => {
		assert.equal(
			isCleaningFinishedByFeedback({
				operatingStateRaw: "ready",
				modeRaw: "on",
				sawOperatingActive: true,
				elapsedSec: 600,
			}),
			true,
		);
	});

	it("finishes on autoCleaningMode off after confirm window", () => {
		assert.equal(
			isCleaningFinishedByFeedback({
				operatingStateRaw: "autoClean",
				modeRaw: "off",
				sawOperatingActive: true,
				elapsedSec: 120,
			}),
			true,
		);
	});
});
