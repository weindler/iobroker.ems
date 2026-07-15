import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPlannerInputSnapshot } from "../planner_snapshot/builder.js";
import { createParityFixtureSource } from "../planner_snapshot/parity_fixture.js";
import { preparePlannerFromSnapshot } from "../planner_preparation/prepare.js";
import { computeShadowProjectionRevision } from "./canonical.js";
import {
	compareAgainstStoredReference,
	compareShadowProjections,
	compareSnapshotPreparedInput,
} from "./compare.js";
import { projectionFromPreparedInput, projectionFromSnapshot } from "./projection.js";
import type { PlannerShadowGridProjection } from "./types.js";

function baseProjection(overrides: Partial<PlannerShadowGridProjection> = {}): PlannerShadowGridProjection {
	return {
		capturedAt: "2026-07-01T12:00:00.000Z",
		horizonStart: "2026-07-01T12:00:00.000Z",
		horizonEnd: "2026-07-01T13:00:00.000Z",
		slotCount: 1,
		gridImportAllowed: true,
		maxGridImportW: 5000,
		houseFuseLimitW: 11000,
		slots: [
			{
				start: "2026-07-01T12:00:00.000Z",
				end: "2026-07-01T12:15:00.000Z",
				importAllowed: true,
				maxImportW: 5000,
				priceCtPerKwh: 30,
				priceClass: "normal",
			},
		],
		...overrides,
	};
}

describe("planner_shadow compare", () => {
	it("identical projections yield matched status and equal revisions", () => {
		const reference = baseProjection();
		const worker = baseProjection();
		const { result } = compareShadowProjections(reference, worker);
		assert.equal(result.status, "matched");
		assert.equal(result.mismatchCount, 0);
		assert.equal(result.referenceRevision, result.workerRevision);
		assert.equal(result.referenceRevision?.length, 64);
	});

	it("slot deviation yields mismatch with first path", () => {
		const reference = baseProjection();
		const worker = baseProjection({
			slots: [
				{
					...reference.slots[0],
					maxImportW: 4000,
				},
			],
		});
		const { result, mismatches } = compareShadowProjections(reference, worker);
		assert.equal(result.status, "mismatch");
		assert.ok(result.mismatchCount >= 1);
		assert.equal(result.firstMismatchPath, mismatches[0]?.path);
	});

	it("null vs zero is a mismatch", () => {
		const reference = baseProjection({
			slots: [{ ...baseProjection().slots[0], maxImportW: null }],
		});
		const worker = baseProjection({
			slots: [{ ...baseProjection().slots[0], maxImportW: 0 }],
		});
		const { result } = compareShadowProjections(reference, worker);
		assert.equal(result.status, "mismatch");
	});

	it("price deviation yields mismatch", () => {
		const reference = baseProjection();
		const worker = baseProjection({
			slots: [{ ...reference.slots[0], priceCtPerKwh: 99 }],
		});
		const { result } = compareShadowProjections(reference, worker);
		assert.equal(result.status, "mismatch");
		assert.ok(result.firstMismatchPath?.includes("priceCtPerKwh"));
	});

	it("policy deviation yields mismatch", () => {
		const reference = baseProjection();
		const worker = baseProjection({ gridImportAllowed: false });
		const { result } = compareShadowProjections(reference, worker);
		assert.equal(result.status, "mismatch");
		assert.equal(result.firstMismatchPath, "gridImportAllowed");
	});

	it("snapshot and prepared parity fixture match", async () => {
		const snapshot = await buildPlannerInputSnapshot(createParityFixtureSource());
		const prepared = preparePlannerFromSnapshot(snapshot);
		const { result } = compareSnapshotPreparedInput(snapshot, prepared);
		assert.equal(result.status, "matched");
		assert.equal(result.mismatchCount, 0);
	});

	it("revisions are deterministic for identical projections", () => {
		const a = baseProjection();
		const b = baseProjection();
		assert.equal(computeShadowProjectionRevision(a), computeShadowProjectionRevision(b));
	});

	it("stored reference time mismatch is not counted as field mismatch", () => {
		const worker = baseProjection();
		const result = compareAgainstStoredReference(
			{
				capturedAt: "2026-07-01T11:00:00.000Z",
				horizonStart: "x",
				horizonEnd: "y",
				slotCount: 0,
				referenceRevision: "a".repeat(64),
				recordedAt: "2026-07-01T11:00:00.000Z",
			},
			worker,
		);
		assert.equal(result.status, "reference_time_mismatch");
	});

	it("missing stored reference yields reference_missing", () => {
		const result = compareAgainstStoredReference(null, baseProjection());
		assert.equal(result.status, "reference_missing");
	});

	it("snapshot vs prepared uses in-process and worker projections", async () => {
		const snapshot = await buildPlannerInputSnapshot(createParityFixtureSource());
		const prepared = preparePlannerFromSnapshot(snapshot);
		const reference = projectionFromSnapshot(snapshot);
		const worker = projectionFromPreparedInput(prepared);
		assert.equal(reference.capturedAt, worker.capturedAt);
		const { result } = compareShadowProjections(reference, worker);
		assert.equal(result.status, "matched");
	});
});
