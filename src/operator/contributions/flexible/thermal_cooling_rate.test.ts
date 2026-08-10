import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { effectiveCoolingRateCPerH } from "./thermal_cooling_rate";

describe("effectiveCoolingRateCPerH", () => {
	it("prefers cycle average when present", () => {
		const r = effectiveCoolingRateCPerH({
			coolingRateCPerHAvg: 0.9,
			coolingConstantPerH: 0.08,
			coolingAsymptoteC: 40,
			bufferTempC: 54,
			minTempC: 44,
			estimatedEmptyAtMs: null,
			nowMs: Date.parse("2026-08-10T08:00:00.000Z"),
		});
		assert.equal(r, 0.9);
	});

	it("derives Newton instantaneous rate when avg missing", () => {
		const r = effectiveCoolingRateCPerH({
			coolingRateCPerHAvg: null,
			coolingConstantPerH: 0.1,
			coolingAsymptoteC: 40,
			bufferTempC: 50,
			minTempC: 44,
			estimatedEmptyAtMs: null,
			nowMs: Date.parse("2026-08-10T08:00:00.000Z"),
		});
		assert.equal(r, 1); // 0.1 * (50-40)
	});

	it("falls back to emptyAt linearization", () => {
		const now = Date.parse("2026-08-10T08:00:00.000Z");
		const r = effectiveCoolingRateCPerH({
			coolingRateCPerHAvg: null,
			coolingConstantPerH: null,
			coolingAsymptoteC: null,
			bufferTempC: 54,
			minTempC: 44,
			estimatedEmptyAtMs: now + 10 * 3600_000,
			nowMs: now,
		});
		assert.ok(r != null && Math.abs(r - 1) < 0.01, `got ${r}`);
	});

	it("returns null when no physics available", () => {
		const r = effectiveCoolingRateCPerH({
			coolingRateCPerHAvg: null,
			coolingConstantPerH: null,
			coolingAsymptoteC: null,
			bufferTempC: 54,
			minTempC: null,
			estimatedEmptyAtMs: null,
			nowMs: Date.now(),
		});
		assert.equal(r, null);
	});
});
