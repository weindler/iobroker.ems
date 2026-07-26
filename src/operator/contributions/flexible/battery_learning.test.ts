import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildBatteryLearningSignal } from "./battery_learning";

describe("battery learning signal", () => {
	it("returns missing without a learning model (no source)", () => {
		const signal = buildBatteryLearningSignal({
			rawStatus: "no_source",
			sampleDays: 0,
			avgNightDischargeKwh: null,
			avgChargePowerW: null,
			maxChargePowerW: null,
			topoffDueRaw: null,
			topoffDaysRemaining: null,
			estimatedRuntimeDays: null,
		});
		assert.equal(signal.status, "missing");
		assert.equal(signal.topoffDue, null);
		assert.equal(signal.avgNightDischargeKwh, null);
	});

	it("returns missing when disabled in admin", () => {
		const signal = buildBatteryLearningSignal({
			rawStatus: "disabled",
			sampleDays: 0,
			avgNightDischargeKwh: null,
			avgChargePowerW: null,
			maxChargePowerW: null,
			topoffDueRaw: null,
			topoffDaysRemaining: null,
			estimatedRuntimeDays: null,
		});
		assert.equal(signal.status, "missing");
	});

	it("returns degraded with insufficient history", () => {
		const signal = buildBatteryLearningSignal({
			rawStatus: "insufficient_data",
			sampleDays: 2,
			avgNightDischargeKwh: 1.5,
			avgChargePowerW: 2500,
			maxChargePowerW: 3000,
			topoffDueRaw: 0,
			topoffDaysRemaining: 12,
			estimatedRuntimeDays: 8,
		});
		assert.equal(signal.status, "degraded");
		assert.equal(signal.avgNightDischargeKwh, 1.5);
		assert.equal(signal.topoffDue, false);
	});

	it("returns valid with sufficient history and maps topoff_due 1/0 to boolean", () => {
		const due = buildBatteryLearningSignal({
			rawStatus: "ready",
			sampleDays: 30,
			avgNightDischargeKwh: 2.1,
			avgChargePowerW: 2800,
			maxChargePowerW: 3200,
			topoffDueRaw: 1,
			topoffDaysRemaining: -3,
			estimatedRuntimeDays: 6,
		});
		assert.equal(due.status, "valid");
		assert.equal(due.topoffDue, true);
		assert.equal(due.topoffDaysRemaining, -3);

		const notDue = buildBatteryLearningSignal({
			rawStatus: "ready",
			sampleDays: 30,
			avgNightDischargeKwh: 2.1,
			avgChargePowerW: 2800,
			maxChargePowerW: 3200,
			topoffDueRaw: 0,
			topoffDaysRemaining: 5,
			estimatedRuntimeDays: 6,
		});
		assert.equal(notDue.topoffDue, false);
	});

	it("keeps topoffDue null when the raw state was never written", () => {
		const signal = buildBatteryLearningSignal({
			rawStatus: "ready",
			sampleDays: 30,
			avgNightDischargeKwh: 2.1,
			avgChargePowerW: 2800,
			maxChargePowerW: 3200,
			topoffDueRaw: null,
			topoffDaysRemaining: null,
			estimatedRuntimeDays: null,
		});
		assert.equal(signal.status, "valid");
		assert.equal(signal.topoffDue, null);
	});
});
