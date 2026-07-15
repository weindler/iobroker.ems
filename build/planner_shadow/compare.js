"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compareAgainstStoredReference = exports.compareSnapshotPreparedInput = exports.compareShadowProjections = void 0;
const canonical_1 = require("./canonical");
const projection_1 = require("./projection");
function compareScalar(path, reference, worker, out) {
    if (Object.is(reference, worker))
        return;
    out.push({ path, reference, worker });
}
function compareSlots(reference, worker, out) {
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
function compareShadowProjections(reference, worker) {
    const mismatches = [];
    compareScalar("capturedAt", reference.capturedAt, worker.capturedAt, mismatches);
    compareScalar("horizonStart", reference.horizonStart, worker.horizonStart, mismatches);
    compareScalar("horizonEnd", reference.horizonEnd, worker.horizonEnd, mismatches);
    compareScalar("gridImportAllowed", reference.gridImportAllowed, worker.gridImportAllowed, mismatches);
    compareScalar("maxGridImportW", reference.maxGridImportW, worker.maxGridImportW, mismatches);
    compareScalar("houseFuseLimitW", reference.houseFuseLimitW, worker.houseFuseLimitW, mismatches);
    compareSlots(reference, worker, mismatches);
    const referenceRevision = (0, canonical_1.computeShadowProjectionRevision)(reference);
    const workerRevision = (0, canonical_1.computeShadowProjectionRevision)(worker);
    const status = mismatches.length === 0 ? "matched" : "mismatch";
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
exports.compareShadowProjections = compareShadowProjections;
function compareSnapshotPreparedInput(snapshot, prepared) {
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
    const reference = (0, projection_1.projectionFromSnapshot)(snapshot);
    const worker = (0, projection_1.projectionFromPreparedInput)(prepared);
    return compareShadowProjections(reference, worker);
}
exports.compareSnapshotPreparedInput = compareSnapshotPreparedInput;
function compareAgainstStoredReference(referenceMeta, worker) {
    if (!referenceMeta) {
        return { status: "reference_missing", mismatchCount: 0 };
    }
    if (referenceMeta.capturedAt !== worker.capturedAt ||
        referenceMeta.horizonStart !== worker.horizonStart ||
        referenceMeta.horizonEnd !== worker.horizonEnd) {
        return {
            status: "reference_time_mismatch",
            referenceRevision: referenceMeta.referenceRevision,
            workerRevision: (0, canonical_1.computeShadowProjectionRevision)(worker),
            mismatchCount: 1,
            firstMismatchPath: "timeAxis",
        };
    }
    const referenceRevision = referenceMeta.referenceRevision;
    const workerRevision = (0, canonical_1.computeShadowProjectionRevision)(worker);
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
exports.compareAgainstStoredReference = compareAgainstStoredReference;
