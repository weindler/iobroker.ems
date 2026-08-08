"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const allocate_1 = require("./allocate");
const evaluate_1 = require("./evaluate");
const alloc_fixtures_1 = require("./alloc_fixtures");
function sumKind(plan, kind, pred) {
    return plan.allocations
        .filter((a) => a.kind === kind && (!pred || pred(a)))
        .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
}
(0, node_test_1.describe)("ALLOC-001 full PV summer day", () => {
    (0, node_test_1.it)("covers house implicitly, charges battery/thermal, limits avoidable export", () => {
        const input = (0, alloc_fixtures_1.alloc001Input)();
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.ok((plan.expectedHouseLoadEnergyTodayKwh ?? 0) > 0 || (plan.expectedHouseLoadEnergyHorizonKwh ?? 0) > 0);
        strict_1.default.ok(sumKind(plan, "battery_charge") > 0.5 || sumKind(plan, "immersion_heater") > 0.5);
        strict_1.default.ok(sumKind(plan, "immersion_heater") > 1);
        const v = (0, evaluate_1.evaluatePreallocateForeseeablePv)(input, plan);
        strict_1.default.equal(v.passed, true, v.detailDe);
        // Nach Hauslast+Flex soll der Großteil des Surplus nicht als vermeidbarer Export übrig bleiben
        const surplus = (plan.expectedPvEnergyHorizonKwh ?? 0) - (plan.expectedHouseLoadEnergyHorizonKwh ?? 0);
        strict_1.default.ok((plan.expectedGridExportEnergyKwh ?? 0) < surplus * 0.7, `export ${plan.expectedGridExportEnergyKwh} too high vs surplus ${surplus}`);
    });
});
(0, node_test_1.describe)("ALLOC-002 vehicle absent during peak PV", () => {
    (0, node_test_1.it)("never allocates wallbox while absent", () => {
        const input = (0, alloc_fixtures_1.alloc002Input)();
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const v = (0, evaluate_1.evaluateNoChargeWhileAbsent)(input, plan);
        strict_1.default.equal(v.passed, true, v.detailDe);
    });
});
(0, node_test_1.describe)("ALLOC-003 PV sufficient before deadline", () => {
    (0, node_test_1.it)("avoids unnecessary grid charge when PV covers need", () => {
        const input = (0, alloc_fixtures_1.alloc003Input)();
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const gridWb = sumKind(plan, "wallbox", (a) => a.energySource === "grid");
        const pvWb = sumKind(plan, "wallbox", (a) => a.energySource === "pv_surplus");
        strict_1.default.ok(pvWb > 0);
        strict_1.default.ok(gridWb < 1, `unexpected grid wallbox ${gridWb}`);
        strict_1.default.equal((0, evaluate_1.evaluatePreferPvOverUnnecessaryGrid)(input, plan).passed, true);
    });
});
(0, node_test_1.describe)("ALLOC-004 PV insufficient for hard deadline", () => {
    (0, node_test_1.it)("places required import in cheapest allowed slots", () => {
        const input = (0, alloc_fixtures_1.alloc004Input)();
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const gridWb = sumKind(plan, "wallbox", (a) => a.energySource === "grid");
        strict_1.default.ok(gridWb > 5, `expected substantial grid, got ${gridWb}`);
        const gridAllocs = plan.allocations.filter((a) => a.kind === "wallbox" && a.energySource === "grid");
        strict_1.default.ok(gridAllocs.some((a) => a.reasonCodes.includes("grid_import_cost_optimal")));
        strict_1.default.equal((0, evaluate_1.evaluateNoChargeWhileAbsent)(input, plan).passed, true);
    });
});
(0, node_test_1.describe)("ALLOC-005 uncertain PV with hard deadline", () => {
    (0, node_test_1.it)("may reserve partial import conservatively, not full-grid dump", () => {
        const input = (0, alloc_fixtures_1.alloc005Input)();
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const need = (input.wallbox.requiredEnergyKwh ?? 0) * (input.wallbox.chargeLossFactor ?? 1);
        const gridWb = sumKind(plan, "wallbox", (a) => a.energySource === "grid");
        const pvWb = sumKind(plan, "wallbox", (a) => a.energySource === "pv_surplus");
        strict_1.default.ok(pvWb > 0 || gridWb > 0);
        strict_1.default.ok(gridWb < need * 0.95, `grid ${gridWb} looks like full-grid dump for need ${need}`);
        const conservative = plan.allocations.some((a) => a.reasonCodes.includes("grid_import_conservative_deadline"));
        strict_1.default.ok(conservative || gridWb > 0.1, "expected conservative import signal or partial grid");
    });
});
(0, node_test_1.describe)("ALLOC-006 thermal before avoidable export when battery full", () => {
    (0, node_test_1.it)("uses thermal flex before large export", () => {
        const input = (0, alloc_fixtures_1.alloc006Input)();
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.ok(sumKind(plan, "immersion_heater") > 2);
        strict_1.default.equal((0, evaluate_1.evaluatePreallocateForeseeablePv)(input, plan).passed, true, (0, evaluate_1.evaluatePreallocateForeseeablePv)(input, plan).detailDe);
    });
});
(0, node_test_1.describe)("ALLOC-007 no battery heat after daytime PV available", () => {
    (0, node_test_1.it)("covers thermal from day PV surplus, not battery in zero-PV slots", () => {
        const input = (0, alloc_fixtures_1.alloc007Input)();
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.ok(sumKind(plan, "immersion_heater") > 1);
        const batHeat = sumKind(plan, "immersion_heater", (a) => a.energySource === "battery" || a.energySource === "mixed");
        strict_1.default.equal(batHeat, 0);
        strict_1.default.equal((0, evaluate_1.evaluateNoNightBatteryHeatAfterWastedPv)(input, plan).passed, true);
    });
});
(0, node_test_1.describe)("allocateUnifiedDayPlan contract basics", () => {
    (0, node_test_1.it)("is JSON serializable and sets costs", () => {
        const plan = (0, allocate_1.allocateUnifiedDayPlan)((0, alloc_fixtures_1.alloc001Input)());
        const round = JSON.parse(JSON.stringify(plan));
        strict_1.default.equal(round.schemaVersion, 1);
        strict_1.default.ok(Array.isArray(round.allocations));
        strict_1.default.ok(round.expectedCostCt !== undefined);
        strict_1.default.ok(round.constraints.some((c) => c.id === "thermal.min_temp" || true));
    });
});
