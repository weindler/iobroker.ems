import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildThermalLearningSignal } from "./thermal_learning";

const NOW = new Date("2026-07-26T10:00:00.000Z"); // Sonntag → weekend

describe("thermal learning signal", () => {
	it("returns missing without a learning model (no source)", () => {
		const signal = buildThermalLearningSignal({
			now: NOW,
			rawStatus: "no_source",
			rawHealth: "no_source",
			samples: 0,
			coolingRateCPerHAvg: null,
			coolingConstantPerH: null,
			coolingAsymptoteC: null,
			estimatedRemainingHours: null,
			estimatedEmptyAtRaw: null,
			byDayTypeJsonRaw: null,
		});
		assert.equal(signal.status, "missing");
		assert.equal(signal.coolingRateCPerHAvg, null);
		assert.equal(signal.estimatedEmptyAt, null);
	});

	it("returns missing when disabled in admin", () => {
		const signal = buildThermalLearningSignal({
			now: NOW,
			rawStatus: "disabled",
			rawHealth: "no_source",
			samples: 0,
			coolingRateCPerHAvg: null,
			coolingConstantPerH: null,
			coolingAsymptoteC: null,
			estimatedRemainingHours: null,
			estimatedEmptyAtRaw: null,
			byDayTypeJsonRaw: null,
		});
		assert.equal(signal.status, "missing");
	});

	it("returns degraded with few cycles (insufficient_data)", () => {
		const signal = buildThermalLearningSignal({
			now: NOW,
			rawStatus: "insufficient_data",
			rawHealth: "degraded",
			samples: 2,
			coolingRateCPerHAvg: 1.2,
			coolingConstantPerH: null,
			coolingAsymptoteC: null,
			estimatedRemainingHours: 5,
			estimatedEmptyAtRaw: "2026-07-26T15:00:00.000Z",
			byDayTypeJsonRaw: null,
		});
		assert.equal(signal.status, "degraded");
		assert.equal(signal.coolingRateCPerHAvg, 1.2);
	});

	it("returns valid with a healthy model and future estimated_empty_at", () => {
		const signal = buildThermalLearningSignal({
			now: NOW,
			rawStatus: "ready",
			rawHealth: "ok",
			samples: 12,
			coolingRateCPerHAvg: 0.9,
			coolingConstantPerH: 0.05,
			coolingAsymptoteC: 18,
			estimatedRemainingHours: 6.5,
			estimatedEmptyAtRaw: "2026-07-26T16:30:00.000Z",
			byDayTypeJsonRaw: null,
		});
		assert.equal(signal.status, "valid");
		assert.equal(signal.coolingRateCPerHAvg, 0.9);
		assert.equal(signal.estimatedEmptyAt, "2026-07-26T16:30:00.000Z");
		assert.equal(signal.estimatedRemainingHours, 6.5);
		// UTC 16:30 → CEST 18:30 — reasonDe darf keine UTC-Ziffern als Ortszeit zeigen.
		assert.match(signal.reasonDe, /18:30/);
		assert.doesNotMatch(signal.reasonDe, /16:30/);
	});

	it("derives live remaining from empty_at when stored remaining is stale", () => {
		const later = new Date("2026-07-26T14:00:00.000Z"); // 2.5 h before empty_at
		const signal = buildThermalLearningSignal({
			now: later,
			rawStatus: "ready",
			rawHealth: "ok",
			samples: 12,
			coolingRateCPerHAvg: 0.9,
			coolingConstantPerH: 0.05,
			coolingAsymptoteC: 18,
			estimatedRemainingHours: 6.5, // eingefrorener Snapshot vom früheren Lauf
			estimatedEmptyAtRaw: "2026-07-26T16:30:00.000Z",
			byDayTypeJsonRaw: null,
		});
		assert.equal(signal.estimatedEmptyAt, "2026-07-26T16:30:00.000Z");
		assert.equal(signal.estimatedRemainingHours, 2.5);
	});

	it("drops estimated_empty_at when it lies in the past (stale data)", () => {
		const signal = buildThermalLearningSignal({
			now: NOW,
			rawStatus: "ready",
			rawHealth: "ok",
			samples: 12,
			coolingRateCPerHAvg: 0.9,
			coolingConstantPerH: 0.05,
			coolingAsymptoteC: 18,
			estimatedRemainingHours: 0,
			estimatedEmptyAtRaw: "2026-07-25T08:00:00.000Z",
			byDayTypeJsonRaw: null,
		});
		assert.equal(signal.status, "valid");
		assert.equal(signal.estimatedEmptyAt, null);
		assert.equal(signal.estimatedRemainingHours, 0);
	});

	it("extracts the current day-type median runtime from by_day_type_json", () => {
		const signal = buildThermalLearningSignal({
			now: NOW, // Sunday → weekend
			rawStatus: "ready",
			rawHealth: "ok",
			samples: 12,
			coolingRateCPerHAvg: 0.9,
			coolingConstantPerH: 0.05,
			coolingAsymptoteC: 18,
			estimatedRemainingHours: 6,
			estimatedEmptyAtRaw: null,
			byDayTypeJsonRaw: JSON.stringify({
				weekday: { samples: 8, runtime_hours_median: 10 },
				weekend: { samples: 4, runtime_hours_median: 14 },
			}),
		});
		assert.equal(signal.currentDayTypeRuntimeHoursMedian, 14);
	});

	it("never fabricates a value when the JSON is malformed", () => {
		const signal = buildThermalLearningSignal({
			now: NOW,
			rawStatus: "ready",
			rawHealth: "ok",
			samples: 12,
			coolingRateCPerHAvg: 0.9,
			coolingConstantPerH: 0.05,
			coolingAsymptoteC: 18,
			estimatedRemainingHours: 6,
			estimatedEmptyAtRaw: null,
			byDayTypeJsonRaw: "not-json",
		});
		assert.equal(signal.currentDayTypeRuntimeHoursMedian, null);
	});
});
