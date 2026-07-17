import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertNoForbiddenImportRoots, collectTransitiveRelativeImports } from "../test_support/import_graph.js";

describe("planner_preparation import boundaries", () => {
	it("does not transitively import operator modules", () => {
		assert.doesNotThrow(() =>
			assertNoForbiddenImportRoots(
				["planner_preparation/prepare.ts", "planner_preparation/validate.ts"],
				["operator"],
			),
		);
	});

	it("imports neutral grid_supply core", () => {
		const files = collectTransitiveRelativeImports("planner_preparation/prepare.ts");
		assert.ok(files.some((f) => f.includes("/grid_supply/forecast.ts")));
	});
});

describe("planner_worker import boundaries", () => {
	it("does not import adapter ticks or intent readers", () => {
		assert.doesNotThrow(() =>
			assertNoForbiddenImportRoots(
				["planner_worker/worker_job.ts", "planner_worker/main.ts"],
				[
					"operator/forecast/tick",
					"operator/daily_plan/tick",
					"operator/contributions/read",
					"operator/contributions/flexible/read",
					"operator/supply/grid_tick",
					"operator/supply/grid_read",
					"addons/battery/runtime",
					"addons/immersion_heater/runtime/intent_read",
					"planner/inputs",
				],
			),
		);
	});

	it("imports planner_candidate pure pipeline", () => {
		const files = collectTransitiveRelativeImports("planner_worker/worker_job.ts");
		assert.ok(files.some((f) => f.includes("/planner_candidate/build.ts")));
	});
});
