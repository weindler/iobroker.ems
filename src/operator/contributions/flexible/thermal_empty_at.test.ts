import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	hasCycleCoolingModel,
	hasNewtonEmptyAtModel,
	thermalEmptyAtUsableForPlanning,
	thermalLearningDegradedCauseDe,
} from "./thermal_empty_at";
import type { ThermalLearningSignal } from "./thermal_learning";

function signal(partial: Partial<ThermalLearningSignal>): ThermalLearningSignal {
	return {
		status: "degraded",
		health: "degraded",
		samples: 0,
		coolingRateCPerHAvg: null,
		coolingConstantPerH: null,
		coolingAsymptoteC: null,
		estimatedRemainingHours: null,
		estimatedEmptyAt: null,
		currentDayTypeRuntimeHoursMedian: null,
		reasonDe: "t",
		...partial,
	};
}

describe("A1 thermal empty_at planning usability", () => {
	it("Newton estimate with samples=0 is planning-usable without cycle-valid claim", () => {
		const learning = signal({
			status: "degraded",
			samples: 0,
			coolingConstantPerH: 0.09,
			estimatedEmptyAt: "2026-08-09T14:00:00.000Z",
		});
		assert.equal(hasNewtonEmptyAtModel(learning), true);
		assert.equal(hasCycleCoolingModel(learning), false);
		assert.equal(thermalEmptyAtUsableForPlanning(learning), true);
		assert.match(
			thermalLearningDegradedCauseDe(learning) ?? "",
			/Newton estimate.*0 completed cooling cycles/,
		);
	});

	it("does not mark Newton-only learning as cycle-valid", () => {
		const learning = signal({
			status: "degraded",
			samples: 0,
			coolingConstantPerH: 0.09,
			estimatedEmptyAt: "2026-08-09T14:00:00.000Z",
		});
		assert.notEqual(learning.status, "valid");
		assert.equal(hasCycleCoolingModel(learning), false);
	});

	it("missing empty_at is not planning-usable", () => {
		const learning = signal({
			status: "degraded",
			samples: 0,
			coolingConstantPerH: 0.09,
			estimatedEmptyAt: null,
		});
		assert.equal(thermalEmptyAtUsableForPlanning(learning), false);
	});
});
