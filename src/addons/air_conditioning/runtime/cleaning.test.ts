import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	isCleaningFinishedByFeedback,
	isCleaningFinishedByProgress,
	isCleaningOperatingActive,
	isCleaningStuckNeverEngaged,
	normalizeCleaningProgressPct,
	shouldMarkCleaningOperatingActive,
	shouldMarkCleaningProgressActive,
} from "./cleaning";

describe("ac cleaning feedback", () => {
	it("detects active operating states", () => {
		assert.equal(isCleaningOperatingActive("autoClean"), true);
		assert.equal(isCleaningOperatingActive("ready"), false);
	});

	it("parses progress values", () => {
		assert.equal(normalizeCleaningProgressPct(42), 42);
		assert.equal(normalizeCleaningProgressPct("100%"), 100);
		assert.equal(normalizeCleaningProgressPct(""), null);
	});

	it("marks progress active between 0 and 100", () => {
		assert.equal(shouldMarkCleaningProgressActive(0), false);
		assert.equal(shouldMarkCleaningProgressActive(55), true);
		assert.equal(shouldMarkCleaningProgressActive(100), false);
	});

	it("ignores autoClean flicker in the first minute", () => {
		assert.equal(shouldMarkCleaningOperatingActive("autoClean", 12), false);
		assert.equal(shouldMarkCleaningOperatingActive("autoClean", 90), true);
	});

	it("does not finish on stale 100% shortly after start", () => {
		assert.equal(
			isCleaningFinishedByProgress({
				progressPct: 100,
				sawProgressActive: false,
				sawOperatingActive: false,
				startProgressPct: 100,
				elapsedSec: 90,
			}),
			false,
		);
	});

	it("finishes on progress 100% once cleaning was running", () => {
		assert.equal(
			isCleaningFinishedByProgress({
				progressPct: 100,
				sawProgressActive: true,
				sawOperatingActive: false,
				startProgressPct: 0,
				elapsedSec: 600,
			}),
			true,
		);
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

	it("aborts stuck cleaning that never engaged", () => {
		assert.equal(
			isCleaningStuckNeverEngaged({
				operatingStateRaw: "ready",
				sawOperatingActive: false,
				sawProgressActive: false,
				elapsedSec: 200,
			}),
			true,
		);
		assert.equal(
			isCleaningStuckNeverEngaged({
				operatingStateRaw: "ready",
				sawOperatingActive: false,
				sawProgressActive: false,
				elapsedSec: 60,
			}),
			false,
		);
		assert.equal(
			isCleaningStuckNeverEngaged({
				operatingStateRaw: "autoClean",
				sawOperatingActive: true,
				sawProgressActive: false,
				elapsedSec: 200,
			}),
			false,
		);
	});
});
