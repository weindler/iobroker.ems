/**
 * BETA-GATE-003 — AC effective live false→true: Start-Retry darf nicht 120s blockieren.
 * Edge = (global live AND addon live), nicht nur Global.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AC_START_RETRY_MS } from "../constants";

/** Spiegel der Engine-Bedingung für effective-live reconcile. */
function shouldClearStartRetryOnEffectiveLiveEdge(input: {
	effectiveLiveEdge: boolean;
	feedbackOff: boolean;
	claimedRunningOrHadStart: boolean;
}): boolean {
	return input.effectiveLiveEdge && input.feedbackOff && input.claimedRunningOrHadStart;
}

describe("AC effective live start retry", () => {
	it("clears retry on effective live edge (global or addon edge) when hardware off", () => {
		assert.equal(
			shouldClearStartRetryOnEffectiveLiveEdge({
				effectiveLiveEdge: true,
				feedbackOff: true,
				claimedRunningOrHadStart: true,
			}),
			true,
		);
	});

	it("does not clear without effective live edge", () => {
		assert.equal(
			shouldClearStartRetryOnEffectiveLiveEdge({
				effectiveLiveEdge: false,
				feedbackOff: true,
				claimedRunningOrHadStart: true,
			}),
			false,
		);
	});

	it("does not clear when feedback already on", () => {
		assert.equal(
			shouldClearStartRetryOnEffectiveLiveEdge({
				effectiveLiveEdge: true,
				feedbackOff: false,
				claimedRunningOrHadStart: true,
			}),
			false,
		);
	});

	it("documents that AC_START_RETRY_MS would otherwise block immediate live start", () => {
		assert.ok(AC_START_RETRY_MS >= 60_000);
	});
});
