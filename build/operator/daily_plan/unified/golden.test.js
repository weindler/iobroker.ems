"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const evaluate_1 = require("./evaluate");
const fixtures_1 = require("./fixtures");
const types_1 = require("./types");
(0, node_test_1.describe)("unified day planner contract", () => {
    (0, node_test_1.it)("exposes objective priority order (8 levels)", () => {
        strict_1.default.equal(types_1.UNIFIED_OBJECTIVE_PRIORITY[0], "safety_constraints");
        strict_1.default.equal(types_1.UNIFIED_OBJECTIVE_PRIORITY[types_1.UNIFIED_OBJECTIVE_PRIORITY.length - 1], "comfort_goals");
        strict_1.default.equal(types_1.UNIFIED_OBJECTIVE_PRIORITY.length, 8);
    });
    (0, node_test_1.it)("lists replan triggers without implementing a loop", () => {
        strict_1.default.ok(types_1.UNIFIED_REPLAN_TRIGGERS.some((t) => t.id === "forecast_changed_significantly"));
        strict_1.default.ok(types_1.UNIFIED_REPLAN_TRIGGERS.some((t) => t.id === "vehicle_plugged"));
        strict_1.default.ok(types_1.UNIFIED_REPLAN_TRIGGERS.some((t) => t.id === "buffer_temp_deviates"));
        strict_1.default.equal(types_1.UNIFIED_REPLAN_TRIGGERS.length >= 10, true);
    });
    (0, node_test_1.it)("serializes input and plan to JSON round-trip (worker-tauglich)", () => {
        const input = (0, fixtures_1.golden001Input)();
        const plan = (0, fixtures_1.golden001GoodPlan)(input);
        const i2 = JSON.parse(JSON.stringify(input));
        const p2 = JSON.parse(JSON.stringify(plan));
        strict_1.default.equal(i2.schemaVersion, 1);
        strict_1.default.equal(p2.schemaVersion, 1);
        strict_1.default.equal(i2.planIntent, "unified_day");
        strict_1.default.ok(Array.isArray(p2.allocations));
        strict_1.default.ok(Array.isArray(p2.batteryTrajectory));
    });
    (0, node_test_1.it)("models presence as hard availability constraint and vehicle goal hard/soft", () => {
        const input = (0, fixtures_1.golden002Input)();
        strict_1.default.equal(input.wallbox?.presenceHardConstraint, true);
        strict_1.default.equal(input.wallbox?.energyGoalHard, true);
        const hard = (0, types_1.deriveUnifiedHardConstraints)(input);
        strict_1.default.ok(hard.some((c) => c.id === "wallbox.presence" && c.hard && c.kind === "availability"));
        strict_1.default.ok(hard.some((c) => c.id === "wallbox.energy_goal"));
    });
    (0, node_test_1.it)("keeps PV, load and prices as per-slot series over the horizon", () => {
        const input = (0, fixtures_1.golden002Input)();
        strict_1.default.ok(input.pv.slots.length >= 24);
        strict_1.default.equal(input.pv.slots.length, input.prices.slots.length);
        strict_1.default.equal(input.pv.slots.length, input.houseLoad.slots.length);
        const prices = new Set(input.prices.slots.map((s) => s.importCtPerKwh));
        strict_1.default.ok(prices.size >= 2, "Importpreis variiert über den Horizont");
        const exports = input.prices.slots.map((s) => s.exportCtPerKwh);
        strict_1.default.ok(exports.every((x) => x !== undefined));
    });
    (0, node_test_1.it)("can represent battery SOC trajectory over the horizon", () => {
        const input = (0, fixtures_1.golden001Input)();
        const plan = (0, fixtures_1.golden001BadPlan)(input);
        strict_1.default.ok(plan.batteryTrajectory.length >= 1);
        strict_1.default.ok(plan.batteryTrajectory[0].socPct !== null);
    });
    (0, node_test_1.it)("allocations name consumer, slot and energy source", () => {
        const plan = (0, fixtures_1.golden002GoodPlan)();
        for (const a of plan.allocations) {
            strict_1.default.ok(a.consumerId);
            strict_1.default.ok(a.slot.startIso);
            strict_1.default.ok(["pv_surplus", "grid", "battery", "mixed", "none"].includes(a.energySource));
        }
    });
});
(0, node_test_1.describe)("GOLDEN-001 foreseeable PV into thermal flex", () => {
    (0, node_test_1.it)("fails when export is high while thermal headroom unused", () => {
        const input = (0, fixtures_1.golden001Input)();
        const bad = (0, evaluate_1.evaluatePreallocateForeseeablePv)(input, (0, fixtures_1.golden001BadPlan)(input));
        strict_1.default.equal(bad.passed, false);
        strict_1.default.ok(bad.reasonCodes.includes("WASTED_PV_EXPORT_WITH_THERMAL_HEADROOM"));
    });
    (0, node_test_1.it)("passes when thermal is preallocated from PV", () => {
        const input = (0, fixtures_1.golden001Input)();
        const good = (0, evaluate_1.evaluatePreallocateForeseeablePv)(input, (0, fixtures_1.golden001GoodPlan)(input));
        strict_1.default.equal(good.passed, true);
    });
    (0, node_test_1.it)("fails on scaled numbers (not tied to 22 kWh / 47 °C)", () => {
        const input = (0, fixtures_1.golden001ScaledInput)();
        strict_1.default.equal(input.thermal?.headroomEnergyKwh, 8);
        const bad = (0, evaluate_1.evaluatePreallocateForeseeablePv)(input, (0, fixtures_1.golden001ScaledBadPlan)(input));
        strict_1.default.equal(bad.passed, false);
    });
});
(0, node_test_1.describe)("GOLDEN-002 no wallbox charge while absent", () => {
    (0, node_test_1.it)("fails allocation during absence window", () => {
        const input = (0, fixtures_1.golden002Input)();
        const bad = (0, evaluate_1.evaluateNoChargeWhileAbsent)(input, (0, fixtures_1.golden002BadPlanAbsentCharge)());
        strict_1.default.equal(bad.passed, false);
        strict_1.default.ok(bad.reasonCodes.includes("WALLBOX_ALLOC_WHILE_ABSENT"));
    });
    (0, node_test_1.it)("passes when charging only while present", () => {
        const input = (0, fixtures_1.golden002Input)();
        const good = (0, evaluate_1.evaluateNoChargeWhileAbsent)(input, (0, fixtures_1.golden002GoodPlan)());
        strict_1.default.equal(good.passed, true);
    });
});
(0, node_test_1.describe)("GOLDEN-003 cheap grid is not automatically optimal", () => {
    (0, node_test_1.it)("fails unnecessary early grid when PV before deadline suffices", () => {
        const input = (0, fixtures_1.golden003Input)();
        const bad = (0, evaluate_1.evaluatePreferPvOverUnnecessaryGrid)(input, (0, fixtures_1.golden003BadEarlyGrid)());
        strict_1.default.equal(bad.passed, false);
        strict_1.default.ok(bad.reasonCodes.includes("UNNECESSARY_GRID_DESPITE_PV_WINDOW"));
    });
    (0, node_test_1.it)("passes PV-first allocation before deadline", () => {
        const input = (0, fixtures_1.golden003Input)();
        const good = (0, evaluate_1.evaluatePreferPvOverUnnecessaryGrid)(input, (0, fixtures_1.golden003GoodPv)());
        strict_1.default.equal(good.passed, true);
    });
});
(0, node_test_1.describe)("GOLDEN-004 forecast collapse requires plan revision", () => {
    (0, node_test_1.it)("detects relevant PV forecast drop from previous→revised day energy", () => {
        const input = (0, fixtures_1.golden004Input)();
        strict_1.default.equal(input.pv.previousExpectedDayEnergyKwh, 40);
        strict_1.default.equal(input.pv.expectedDayEnergyKwh, 12);
        strict_1.default.ok(12 / 40 <= 0.55);
    });
    (0, node_test_1.it)("passes when plan reflects revised PV and shifts duty to grid", () => {
        const input = (0, fixtures_1.golden004Input)();
        const v = (0, evaluate_1.evaluateReplanWhenForecastCollapses)(input, (0, fixtures_1.golden004ReplanPlan)());
        strict_1.default.equal(v.passed, true);
        strict_1.default.ok(v.reasonCodes.includes("FORECAST_COLLAPSE_HANDLED"));
    });
    (0, node_test_1.it)("fails when plan still assumes pre-collapse PV without duty shift", () => {
        const input = (0, fixtures_1.golden004Input)();
        const v = (0, evaluate_1.evaluateReplanWhenForecastCollapses)(input, (0, fixtures_1.golden004StalePlanNoReplan)());
        strict_1.default.equal(v.passed, false);
        strict_1.default.ok(v.reasonCodes.includes("PLAN_STALE_AFTER_FORECAST_COLLAPSE") ||
            v.reasonCodes.includes("DUTY_NOT_SHIFTED_AFTER_COLLAPSE"));
    });
});
(0, node_test_1.describe)("GOLDEN-005 no battery heat in zero-PV slots after wasted day PV", () => {
    (0, node_test_1.it)("fails battery→heat in PV≈0 slots after large day export", () => {
        const input = (0, fixtures_1.golden005Input)();
        const bad = (0, evaluate_1.evaluateNoNightBatteryHeatAfterWastedPv)(input, (0, fixtures_1.golden005BadNightBatteryHeat)(input));
        strict_1.default.equal(bad.passed, false);
        strict_1.default.ok(bad.reasonCodes.includes("BATTERY_HEAT_IN_ZERO_PV_AFTER_WASTED_DAY_PV"));
    });
    (0, node_test_1.it)("passes when day PV covers thermal instead", () => {
        const input = (0, fixtures_1.golden005Input)();
        const good = (0, evaluate_1.evaluateNoNightBatteryHeatAfterWastedPv)(input, (0, fixtures_1.golden005GoodDayPvHeat)(input));
        strict_1.default.equal(good.passed, true);
    });
});
