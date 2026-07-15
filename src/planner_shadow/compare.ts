import { computeShadowProjectionRevision } from "./canonical";
import { projectionFromPreparedInput, projectionFromSnapshot } from "./projection";
import type { PlannerPreparedInput } from "../planner_preparation/types";
import type { PlannerInputSnapshot } from "../planner_snapshot/types";
import type {
	PlannerShadowComparisonResult,
	PlannerShadowComparisonStatus,
	PlannerShadowGridProjection,
	PlannerShadowReferenceMeta,
} from "./types";

export interface PlannerShadowDetailedMismatch {
	path: string;
	reference: unknown;
	worker: unknown;
}

function compareScalar(path: string, reference: unknown, worker: unknown, out: PlannerShadowDetailedMismatch[]): void {
	if (Object.is(reference, worker)) return;
	out.push({ path, reference, worker });
}

function compareSlots(
	reference: PlannerShadowGridProjection,
	worker: PlannerShadowGridProjection,
	out: PlannerShadowDetailedMismatch[],
): void {
	compareScalar("slotCount", reference.slotCount, worker.slotCount, out);
	const count = Math.max(reference.slots.length, worker.slots.length);
	for (let i = 0; i < count; i += 1) {
		const refSlot = reference.slots[i];
		const workerSlot = worker.slots[i];
		const prefix = `slots[${i}]`;
		if (!refSlot || !workerSlot) {
			out.push({ path: prefix, reference: refSlot ?? null, worker: workerSlot ?? null });
			continue;
		}
		compareScalar(`${prefix}.start`, refSlot.start, workerSlot.start, out);
		compareScalar(`${prefix}.end`, refSlot.end, workerSlot.end, out);
		compareScalar(`${prefix}.importAllowed`, refSlot.importAllowed, workerSlot.importAllowed, out);
		compareScalar(`${prefix}.maxImportW`, refSlot.maxImportW, workerSlot.maxImportW, out);
		compareScalar(`${prefix}.priceCtPerKwh`, refSlot.priceCtPerKwh, workerSlot.priceCtPerKwh, out);
		compareScalar(`${prefix}.priceClass`, refSlot.priceClass, workerSlot.priceClass, out);
	}
}

export function compareShadowProjections(
	reference: PlannerShadowGridProjection,
	worker: PlannerShadowGridProjection,
): { result: PlannerShadowComparisonResult; mismatches: PlannerShadowDetailedMismatch[] } {
	const mismatches: PlannerShadowDetailedMismatch[] = [];
	compareScalar("capturedAt", reference.capturedAt, worker.capturedAt, mismatches);
	compareScalar("horizonStart", reference.horizonStart, worker.horizonStart, mismatches);
	compareScalar("horizonEnd", reference.horizonEnd, worker.horizonEnd, mismatches);
	compareScalar("gridImportAllowed", reference.gridImportAllowed, worker.gridImportAllowed, mismatches);
	compareScalar("maxGridImportW", reference.maxGridImportW, worker.maxGridImportW, mismatches);
	compareScalar("houseFuseLimitW", reference.houseFuseLimitW, worker.houseFuseLimitW, mismatches);
	compareSlots(reference, worker, mismatches);

	const referenceRevision = computeShadowProjectionRevision(reference);
	const workerRevision = computeShadowProjectionRevision(worker);
	const status: PlannerShadowComparisonStatus = mismatches.length === 0 ? "matched" : "mismatch";
	return {
		result: {
			status,
			referenceRevision,
			workerRevision,
			mismatchCount: mismatches.length,
			firstMismatchPath: mismatches[0]?.path,
		},
		mismatches,
	};
}

export function compareSnapshotPreparedInput(
	snapshot: PlannerInputSnapshot,
	prepared: PlannerPreparedInput,
): { result: PlannerShadowComparisonResult; mismatches: PlannerShadowDetailedMismatch[] } {
	if (prepared.inputRevision !== snapshot.inputRevision) {
		return {
			result: {
				status: "comparison_failed",
				mismatchCount: 1,
				firstMismatchPath: "inputRevision",
			},
			mismatches: [{ path: "inputRevision", reference: snapshot.inputRevision, worker: prepared.inputRevision }],
		};
	}
	const reference = projectionFromSnapshot(snapshot);
	const worker = projectionFromPreparedInput(prepared);
	return compareShadowProjections(reference, worker);
}

export function compareAgainstStoredReference(
	referenceMeta: PlannerShadowReferenceMeta | null,
	worker: PlannerShadowGridProjection,
): PlannerShadowComparisonResult {
	if (!referenceMeta) {
		return { status: "reference_missing", mismatchCount: 0 };
	}
	if (
		referenceMeta.capturedAt !== worker.capturedAt ||
		referenceMeta.horizonStart !== worker.horizonStart ||
		referenceMeta.horizonEnd !== worker.horizonEnd
	) {
		return {
			status: "reference_time_mismatch",
			referenceRevision: referenceMeta.referenceRevision,
			workerRevision: computeShadowProjectionRevision(worker),
			mismatchCount: 1,
			firstMismatchPath: "timeAxis",
		};
	}
	const referenceRevision = referenceMeta.referenceRevision;
	const workerRevision = computeShadowProjectionRevision(worker);
	if (referenceRevision === workerRevision) {
		return {
			status: "matched",
			referenceRevision,
			workerRevision,
			mismatchCount: 0,
		};
	}
	return {
		status: "mismatch",
		referenceRevision,
		workerRevision,
		mismatchCount: 1,
		firstMismatchPath: "referenceRevision",
	};
}
