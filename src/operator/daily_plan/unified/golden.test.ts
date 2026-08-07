import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	evaluateNoChargeWhileAbsent,
	evaluateNoNightBatteryHeatAfterWastedPv,
	evaluatePreallocateForeseeablePv,
	evaluatePreferPvOverUnnecessaryGrid,
	evaluateReplanWhenForecastCollapses,
} from "./evaluate";
import {
	golden001BadPlan,
	golden001GoodPlan,
	golden001Input,
	golden001ScaledBadPlan,
	golden001ScaledInput,
	golden002BadPlanAbsentCharge,
	golden002GoodPlan,
	golden002Input,
	golden003BadEarlyGrid,
	golden003GoodPv,
	golden003Input,
	golden004Input,
	golden004ReplanPlan,
	golden004StalePlanNoReplan,
	golden005BadNightBatteryHeat,
	golden005GoodDayPvHeat,
	golden005Input,
} from "./fixtures";
import {
	deriveUnifiedHardConstraints,
	UNIFIED_OBJECTIVE_PRIORITY,
	UNIFIED_REPLAN_TRIGGERS,
} from "./types";

describe("unified day planner contract", () => {
	it("exposes objective priority order (8 levels)", () => {
		assert.equal(UNIFIED_OBJECTIVE_PRIORITY[0], "safety_constraints");
		assert.equal(UNIFIED_OBJECTIVE_PRIORITY[UNIFIED_OBJECTIVE_PRIORITY.length - 1], "comfort_goals");
		assert.equal(UNIFIED_OBJECTIVE_PRIORITY.length, 8);
	});

	it("lists replan triggers without implementing a loop", () => {
		assert.ok(UNIFIED_REPLAN_TRIGGERS.some((t) => t.id === "forecast_changed_significantly"));
		assert.ok(UNIFIED_REPLAN_TRIGGERS.some((t) => t.id === "vehicle_plugged"));
		assert.ok(UNIFIED_REPLAN_TRIGGERS.some((t) => t.id === "buffer_temp_deviates"));
		assert.equal(UNIFIED_REPLAN_TRIGGERS.length >= 10, true);
	});

	it("serializes input and plan to JSON round-trip (worker-tauglich)", () => {
		const input = golden001Input();
		const plan = golden001GoodPlan(input);
		const i2 = JSON.parse(JSON.stringify(input));
		const p2 = JSON.parse(JSON.stringify(plan));
		assert.equal(i2.schemaVersion, 1);
		assert.equal(p2.schemaVersion, 1);
		assert.equal(i2.planIntent, "unified_day");
		assert.ok(Array.isArray(p2.allocations));
		assert.ok(Array.isArray(p2.batteryTrajectory));
	});

	it("models presence as hard availability constraint and vehicle goal hard/soft", () => {
		const input = golden002Input();
		assert.equal(input.wallbox?.presenceHardConstraint, true);
		assert.equal(input.wallbox?.energyGoalHard, true);
		const hard = deriveUnifiedHardConstraints(input);
		assert.ok(hard.some((c) => c.id === "wallbox.presence" && c.hard && c.kind === "availability"));
		assert.ok(hard.some((c) => c.id === "wallbox.energy_goal"));
	});

	it("keeps PV, load and prices as per-slot series over the horizon", () => {
		const input = golden002Input();
		assert.ok(input.pv.slots.length >= 24);
		assert.equal(input.pv.slots.length, input.prices.slots.length);
		assert.equal(input.pv.slots.length, input.houseLoad.slots.length);
		const prices = new Set(input.prices.slots.map((s) => s.importCtPerKwh));
		assert.ok(prices.size >= 2, "Importpreis variiert über den Horizont");
		const exports = input.prices.slots.map((s) => s.exportCtPerKwh);
		assert.ok(exports.every((x) => x !== undefined));
	});

	it("can represent battery SOC trajectory over the horizon", () => {
		const input = golden001Input();
		const plan = golden001BadPlan(input);
		assert.ok(plan.batteryTrajectory.length >= 1);
		assert.ok(plan.batteryTrajectory[0].socPct !== null);
	});

	it("allocations name consumer, slot and energy source", () => {
		const plan = golden002GoodPlan();
		for (const a of plan.allocations) {
			assert.ok(a.consumerId);
			assert.ok(a.slot.startIso);
			assert.ok(["pv_surplus", "grid", "battery", "mixed", "none"].includes(a.energySource));
		}
	});
});

describe("GOLDEN-001 foreseeable PV into thermal flex", () => {
	it("fails when export is high while thermal headroom unused", () => {
		const input = golden001Input();
		const bad = evaluatePreallocateForeseeablePv(input, golden001BadPlan(input));
		assert.equal(bad.passed, false);
		assert.ok(bad.reasonCodes.includes("WASTED_PV_EXPORT_WITH_THERMAL_HEADROOM"));
	});

	it("passes when thermal is preallocated from PV", () => {
		const input = golden001Input();
		const good = evaluatePreallocateForeseeablePv(input, golden001GoodPlan(input));
		assert.equal(good.passed, true);
	});

	it("fails on scaled numbers (not tied to 22 kWh / 47 °C)", () => {
		const input = golden001ScaledInput();
		assert.equal(input.thermal?.headroomEnergyKwh, 8);
		const bad = evaluatePreallocateForeseeablePv(input, golden001ScaledBadPlan(input));
		assert.equal(bad.passed, false);
	});
});

describe("GOLDEN-002 no wallbox charge while absent", () => {
	it("fails allocation during absence window", () => {
		const input = golden002Input();
		const bad = evaluateNoChargeWhileAbsent(input, golden002BadPlanAbsentCharge());
		assert.equal(bad.passed, false);
		assert.ok(bad.reasonCodes.includes("WALLBOX_ALLOC_WHILE_ABSENT"));
	});

	it("passes when charging only while present", () => {
		const input = golden002Input();
		const good = evaluateNoChargeWhileAbsent(input, golden002GoodPlan());
		assert.equal(good.passed, true);
	});
});

describe("GOLDEN-003 cheap grid is not automatically optimal", () => {
	it("fails unnecessary early grid when PV before deadline suffices", () => {
		const input = golden003Input();
		const bad = evaluatePreferPvOverUnnecessaryGrid(input, golden003BadEarlyGrid());
		assert.equal(bad.passed, false);
		assert.ok(bad.reasonCodes.includes("UNNECESSARY_GRID_DESPITE_PV_WINDOW"));
	});

	it("passes PV-first allocation before deadline", () => {
		const input = golden003Input();
		const good = evaluatePreferPvOverUnnecessaryGrid(input, golden003GoodPv());
		assert.equal(good.passed, true);
	});
});

describe("GOLDEN-004 forecast collapse requires plan revision", () => {
	it("detects relevant PV forecast drop from previous→revised day energy", () => {
		const input = golden004Input();
		assert.equal(input.pv.previousExpectedDayEnergyKwh, 40);
		assert.equal(input.pv.expectedDayEnergyKwh, 12);
		assert.ok(12 / 40 <= 0.55);
	});

	it("passes when plan reflects revised PV and shifts duty to grid", () => {
		const input = golden004Input();
		const v = evaluateReplanWhenForecastCollapses(input, golden004ReplanPlan());
		assert.equal(v.passed, true);
		assert.ok(v.reasonCodes.includes("FORECAST_COLLAPSE_HANDLED"));
	});

	it("fails when plan still assumes pre-collapse PV without duty shift", () => {
		const input = golden004Input();
		const v = evaluateReplanWhenForecastCollapses(input, golden004StalePlanNoReplan());
		assert.equal(v.passed, false);
		assert.ok(
			v.reasonCodes.includes("PLAN_STALE_AFTER_FORECAST_COLLAPSE") ||
				v.reasonCodes.includes("DUTY_NOT_SHIFTED_AFTER_COLLAPSE"),
		);
	});
});

describe("GOLDEN-005 no battery heat in zero-PV slots after wasted day PV", () => {
	it("fails battery→heat in PV≈0 slots after large day export", () => {
		const input = golden005Input();
		const bad = evaluateNoNightBatteryHeatAfterWastedPv(input, golden005BadNightBatteryHeat(input));
		assert.equal(bad.passed, false);
		assert.ok(bad.reasonCodes.includes("BATTERY_HEAT_IN_ZERO_PV_AFTER_WASTED_DAY_PV"));
	});

	it("passes when day PV covers thermal instead", () => {
		const input = golden005Input();
		const good = evaluateNoNightBatteryHeatAfterWastedPv(input, golden005GoodDayPvHeat(input));
		assert.equal(good.passed, true);
	});
});
