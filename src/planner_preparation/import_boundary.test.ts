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
	it("does not transitively import operator modules", () => {
		assert.doesNotThrow(() =>
			assertNoForbiddenImportRoots(
				["planner_worker/worker_job.ts", "planner_worker/main.ts"],
				["operator"],
			),
		);
	});
});
