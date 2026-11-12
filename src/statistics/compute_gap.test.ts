/**
 * Lückenschutz: Zählerdifferenz einer Adapter-Pause wird nicht dem laufenden Tag zugerechnet.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { COUNTER_MAX_GAP_MS, isCounterGap } from "./compute.js";

describe("isCounterGap", () => {
	const now = Date.UTC(2026, 10, 12, 17, 0, 0);

	it("normaler Tick-Abstand ist keine Lücke", () => {
		assert.equal(isCounterGap(now - 10_000, now), false);
		assert.equal(isCounterGap(now - 5 * 60_000, now), false);
	});

	it("genau an der Grenze ist noch keine Lücke, darüber schon", () => {
		assert.equal(isCounterGap(now - COUNTER_MAX_GAP_MS, now), false);
		assert.equal(isCounterGap(now - COUNTER_MAX_GAP_MS - 1, now), true);
	});

	it("Wochenlange Adapter-Pause ist eine Lücke", () => {
		assert.equal(isCounterGap(now - 40 * 24 * 3600_000, now), true);
	});

	it("ohne bekannte letzte Ablesung keine Lücke (erster Start)", () => {
		assert.equal(isCounterGap(null, now), false);
		assert.equal(isCounterGap(undefined, now), false);
		assert.equal(isCounterGap(Number.NaN, now), false);
	});
});
