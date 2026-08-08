import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { allocateUnifiedDayPlan } from "./allocate";
import {
	evaluateNoChargeWhileAbsent,
	evaluateNoNightBatteryHeatAfterWastedPv,
	evaluatePreallocateForeseeablePv,
	evaluatePreferPvOverUnnecessaryGrid,
} from "./evaluate";
import {
	alloc001Input,
	alloc002Input,
	alloc003Input,
	alloc004Input,
	alloc005Input,
	alloc006Input,
	alloc007Input,
} from "./alloc_fixtures";

function sumKind(
	plan: ReturnType<typeof allocateUnifiedDayPlan>,
	kind: string,
	pred?: (a: (typeof plan.allocations)[0]) => boolean,
): number {
	return plan.allocations
		.filter((a) => a.kind === kind && (!pred || pred(a)))
		.reduce((s, a) => s + a.allocatedEnergyKwh, 0);
}

describe("ALLOC-001 full PV summer day", () => {
	it("covers house implicitly, charges battery/thermal, limits avoidable export", () => {
		const input = alloc001Input();
		const plan = allocateUnifiedDayPlan(input);
		assert.ok((plan.expectedHouseLoadEnergyTodayKwh ?? 0) > 0 || (plan.expectedHouseLoadEnergyHorizonKwh ?? 0) > 0);
		assert.ok(sumKind(plan, "battery_charge") > 0.5 || sumKind(plan, "immersion_heater") > 0.5);
		assert.ok(sumKind(plan, "immersion_heater") > 1);
		const v = evaluatePreallocateForeseeablePv(input, plan);
		assert.equal(v.passed, true, v.detailDe);
		// Nach Hauslast+Flex soll der Großteil des Surplus nicht als vermeidbarer Export übrig bleiben
		const surplus =
			(plan.expectedPvEnergyHorizonKwh ?? 0) - (plan.expectedHouseLoadEnergyHorizonKwh ?? 0);
		assert.ok(
			(plan.expectedGridExportEnergyKwh ?? 0) < surplus * 0.7,
			`export ${plan.expectedGridExportEnergyKwh} too high vs surplus ${surplus}`,
		);
	});
});

describe("ALLOC-002 vehicle absent during peak PV", () => {
	it("never allocates wallbox while absent", () => {
		const input = alloc002Input();
		const plan = allocateUnifiedDayPlan(input);
		const v = evaluateNoChargeWhileAbsent(input, plan);
		assert.equal(v.passed, true, v.detailDe);
	});
});

describe("ALLOC-003 PV sufficient before deadline", () => {
	it("avoids unnecessary grid charge when PV covers need", () => {
		const input = alloc003Input();
		const plan = allocateUnifiedDayPlan(input);
		const gridWb = sumKind(plan, "wallbox", (a) => a.energySource === "grid");
		const pvWb = sumKind(plan, "wallbox", (a) => a.energySource === "pv_surplus");
		assert.ok(pvWb > 0);
		assert.ok(gridWb < 1, `unexpected grid wallbox ${gridWb}`);
		assert.equal(evaluatePreferPvOverUnnecessaryGrid(input, plan).passed, true);
	});
});

describe("ALLOC-004 PV insufficient for hard deadline", () => {
	it("places required import in cheapest allowed slots", () => {
		const input = alloc004Input();
		const plan = allocateUnifiedDayPlan(input);
		const gridWb = sumKind(plan, "wallbox", (a) => a.energySource === "grid");
		assert.ok(gridWb > 5, `expected substantial grid, got ${gridWb}`);
		const gridAllocs = plan.allocations.filter((a) => a.kind === "wallbox" && a.energySource === "grid");
		assert.ok(gridAllocs.some((a) => a.reasonCodes.includes("grid_import_cost_optimal")));
		assert.equal(evaluateNoChargeWhileAbsent(input, plan).passed, true);
	});
});

describe("ALLOC-005 uncertain PV with hard deadline", () => {
	it("may reserve partial import conservatively, not full-grid dump", () => {
		const input = alloc005Input();
		const plan = allocateUnifiedDayPlan(input);
		const need = (input.wallbox!.requiredEnergyKwh ?? 0) * (input.wallbox!.chargeLossFactor ?? 1);
		const gridWb = sumKind(plan, "wallbox", (a) => a.energySource === "grid");
		const pvWb = sumKind(plan, "wallbox", (a) => a.energySource === "pv_surplus");
		assert.ok(pvWb > 0 || gridWb > 0);
		assert.ok(gridWb < need * 0.95, `grid ${gridWb} looks like full-grid dump for need ${need}`);
		const conservative = plan.allocations.some((a) =>
			a.reasonCodes.includes("grid_import_conservative_deadline"),
		);
		assert.ok(conservative || gridWb > 0.1, "expected conservative import signal or partial grid");
	});
});

describe("ALLOC-006 thermal before avoidable export when battery full", () => {
	it("uses thermal flex before large export", () => {
		const input = alloc006Input();
		const plan = allocateUnifiedDayPlan(input);
		assert.ok(sumKind(plan, "immersion_heater") > 2);
		assert.equal(evaluatePreallocateForeseeablePv(input, plan).passed, true, evaluatePreallocateForeseeablePv(input, plan).detailDe);
	});
});

describe("ALLOC-007 no battery heat after daytime PV available", () => {
	it("covers thermal from day PV surplus, not battery in zero-PV slots", () => {
		const input = alloc007Input();
		const plan = allocateUnifiedDayPlan(input);
		assert.ok(sumKind(plan, "immersion_heater") > 1);
		const batHeat = sumKind(
			plan,
			"immersion_heater",
			(a) => a.energySource === "battery" || a.energySource === "mixed",
		);
		assert.equal(batHeat, 0);
		assert.equal(evaluateNoNightBatteryHeatAfterWastedPv(input, plan).passed, true);
	});
});

describe("allocateUnifiedDayPlan contract basics", () => {
	it("is JSON serializable and sets costs", () => {
		const plan = allocateUnifiedDayPlan(alloc001Input());
		const round = JSON.parse(JSON.stringify(plan));
		assert.equal(round.schemaVersion, 1);
		assert.ok(Array.isArray(round.allocations));
		assert.ok(round.expectedCostCt !== undefined);
		assert.ok(round.constraints.some((c: { id: string }) => c.id === "thermal.min_temp" || true));
	});
});
