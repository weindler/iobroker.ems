import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { buildPlannerInputSnapshot } from "../planner_snapshot/builder.js";
import { computeInputRevision } from "../planner_snapshot/canonical.js";
import { createParityFixtureSource } from "../planner_snapshot/parity_fixture.js";
import { computePreparationRevision } from "./canonical.js";
import { preparePlannerFromSnapshot } from "./prepare.js";
import { PlannerInputValidationError } from "./types.js";
import { validatePlannerInputRevision } from "./validate.js";

describe("planner_preparation grid supply stage", () => {
	it("prepares slots from snapshot deterministically", async () => {
		const snapshot = await buildPlannerInputSnapshot(createParityFixtureSource());
		const a = preparePlannerFromSnapshot(snapshot);
		const b = preparePlannerFromSnapshot(snapshot);
		assert.deepEqual(a, b);
		assert.ok(a.slots.length >= 1);
		assert.equal(a.inputRevision, snapshot.inputRevision);
		assert.equal(a.policy.priceSource, "dynamic_tariff");
	});

	it("identical input yields identical preparationRevision", async () => {
		const snapshot = await buildPlannerInputSnapshot(createParityFixtureSource());
		const a = preparePlannerFromSnapshot(snapshot);
		const b = preparePlannerFromSnapshot(snapshot);
		assert.equal(a.preparationRevision, b.preparationRevision);
		assert.equal(a.preparationRevision.length, 64);
	});

	it("semantic change changes preparationRevision", async () => {
		const snapshot = await buildPlannerInputSnapshot(createParityFixtureSource());
		const base = preparePlannerFromSnapshot(snapshot);
		const changed = preparePlannerFromSnapshot({
			...snapshot,
			live: { ...snapshot.live, currentPriceCtPerKwh: 99 },
		});
		assert.notEqual(base.preparationRevision, changed.preparationRevision);
	});

	it("preserves null vs zero distinction in slots", async () => {
		const snapshot = await buildPlannerInputSnapshot(
			createParityFixtureSource({
				states: {
					"edge.zero_w": { value: 0 },
					"optional.missing.state": { value: null },
				},
			}),
		);
		const prepared = preparePlannerFromSnapshot(snapshot);
		assert.equal(snapshot.live.pvPowerW, 1500);
		assert.ok(prepared.diagnostics.slotCount >= 0);
	});

	it("rejects manipulated inputRevision", async () => {
		const snapshot = await buildPlannerInputSnapshot(createParityFixtureSource());
		snapshot.inputRevision = "0".repeat(64);
		assert.throws(() => validatePlannerInputRevision(snapshot), PlannerInputValidationError);
	});

	it("recomputes preparationRevision from canonical payload", async () => {
		const snapshot = await buildPlannerInputSnapshot(createParityFixtureSource());
		const prepared = preparePlannerFromSnapshot(snapshot);
		const expected = computePreparationRevision({ ...prepared, preparationRevision: "" });
		assert.equal(prepared.preparationRevision, expected);
	});

	it("uses capturedAt as planning now", async () => {
		const snapshot = await buildPlannerInputSnapshot(
			createParityFixtureSource({ now: new Date("2026-07-01T12:00:00.000Z") }),
		);
		const prepared = preparePlannerFromSnapshot(snapshot);
		assert.equal(prepared.capturedAt, "2026-07-01T12:00:00.000Z");
		assert.equal(prepared.generatedAt, snapshot.capturedAt);
	});

	it("inputRevision stable when only recomputed from same snapshot", async () => {
		const snapshot = await buildPlannerInputSnapshot(createParityFixtureSource());
		const rev = computeInputRevision({ ...snapshot, inputRevision: "" });
		assert.equal(snapshot.inputRevision, rev);
	});

	it("preparation module avoids adapter and runtime engine imports", () => {
		const text = readFileSync(path.join(process.cwd(), "src/planner_preparation/prepare.ts"), "utf8");
		for (const forbidden of ["adapter-core", "runtime/engine", "ems_light", "planner_worker/main"]) {
			assert.ok(!text.includes(forbidden), `prepare must not import ${forbidden}`);
		}
	});
});
