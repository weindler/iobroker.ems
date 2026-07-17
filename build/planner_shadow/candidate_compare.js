"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.comparePlanCandidates = void 0;
function compareField(path, domain, a, b, out) {
    if (Object.is(a, b))
        return;
    out.push({ path, domain });
}
/**
 * Semantic compare of normalized plan candidates.
 * Ignores generatedAt, job ids, paths, reason text.
 */
function comparePlanCandidates(reference, worker) {
    if (reference.validationStatus === "failed" && worker.validationStatus !== "failed") {
        return {
            status: "validation_failed",
            referenceRevision: reference.candidateRevision,
            workerRevision: worker.candidateRevision,
            mismatchCount: 1,
            mismatchedSlotCount: 0,
            firstMismatchDomain: "validation",
            firstMismatchPath: "validationStatus",
        };
    }
    if (worker.validationStatus === "failed" && reference.validationStatus !== "failed") {
        return {
            status: "validation_failed",
            referenceRevision: reference.candidateRevision,
            workerRevision: worker.candidateRevision,
            mismatchCount: 1,
            mismatchedSlotCount: 0,
            firstMismatchDomain: "validation",
            firstMismatchPath: "validationStatus",
        };
    }
    if (reference.inputRevision !== worker.inputRevision) {
        return {
            status: "not_comparable",
            referenceRevision: reference.candidateRevision,
            workerRevision: worker.candidateRevision,
            mismatchCount: 1,
            mismatchedSlotCount: 0,
            firstMismatchDomain: "inputRevision",
            firstMismatchPath: "inputRevision",
        };
    }
    if (reference.horizonStart !== worker.horizonStart ||
        reference.horizonEnd !== worker.horizonEnd) {
        return {
            status: "not_comparable",
            referenceRevision: reference.candidateRevision,
            workerRevision: worker.candidateRevision,
            mismatchCount: 1,
            mismatchedSlotCount: 0,
            firstMismatchDomain: "horizon",
            firstMismatchPath: "horizon",
        };
    }
    const mismatches = [];
    compareField("slotCount", "horizon", reference.slotCount, worker.slotCount, mismatches);
    compareField("forecastStatus", "forecast", reference.forecastStatus, worker.forecastStatus, mismatches);
    compareField("dailyStatus", "daily", reference.dailyStatus, worker.dailyStatus, mismatches);
    compareField("validationStatus", "validation", reference.validationStatus, worker.validationStatus, mismatches);
    const slotCount = Math.max(reference.forecastSlots.length, worker.forecastSlots.length);
    let mismatchedSlotCount = 0;
    for (let i = 0; i < slotCount; i++) {
        const a = reference.forecastSlots[i];
        const b = worker.forecastSlots[i];
        const before = mismatches.length;
        if (!a || !b) {
            mismatches.push({ path: `forecastSlots[${i}]`, domain: "forecast" });
        }
        else {
            compareField(`forecastSlots[${i}].start`, "forecast", a.start, b.start, mismatches);
            compareField(`forecastSlots[${i}].end`, "forecast", a.end, b.end, mismatches);
            compareField(`forecastSlots[${i}].pvPowerW`, "forecast", a.pvPowerW, b.pvPowerW, mismatches);
            compareField(`forecastSlots[${i}].houseLoadPowerW`, "forecast", a.houseLoadPowerW, b.houseLoadPowerW, mismatches);
            compareField(`forecastSlots[${i}].gridPriceCtPerKwh`, "price", a.gridPriceCtPerKwh, b.gridPriceCtPerKwh, mismatches);
            compareField(`forecastSlots[${i}].gridImportAllowed`, "constraint", a.gridImportAllowed, b.gridImportAllowed, mismatches);
            compareField(`forecastSlots[${i}].gridMaxImportPowerW`, "constraint", a.gridMaxImportPowerW, b.gridMaxImportPowerW, mismatches);
        }
        if (mismatches.length > before)
            mismatchedSlotCount += 1;
    }
    const allocCount = Math.max(reference.allocations.length, worker.allocations.length);
    for (let i = 0; i < allocCount; i++) {
        const a = reference.allocations[i];
        const b = worker.allocations[i];
        if (!a || !b) {
            mismatches.push({ path: `allocations[${i}]`, domain: "allocation" });
            continue;
        }
        compareField(`allocations[${i}].contributionId`, "allocation", a.contributionId, b.contributionId, mismatches);
        compareField(`allocations[${i}].powerW`, "allocation", a.powerW, b.powerW, mismatches);
        compareField(`allocations[${i}].energyKwh`, "allocation", a.energyKwh, b.energyKwh, mismatches);
        compareField(`allocations[${i}].status`, "allocation", a.status, b.status, mismatches);
    }
    compareField("totals.flexibleAllocatedEnergyKwh", "totals", reference.totals.flexibleAllocatedEnergyKwh, worker.totals.flexibleAllocatedEnergyKwh, mismatches);
    if (mismatches.length === 0) {
        return {
            status: "matched",
            referenceRevision: reference.candidateRevision,
            workerRevision: worker.candidateRevision,
            mismatchCount: 0,
            mismatchedSlotCount: 0,
        };
    }
    return {
        status: "mismatch",
        referenceRevision: reference.candidateRevision,
        workerRevision: worker.candidateRevision,
        mismatchCount: mismatches.length,
        mismatchedSlotCount,
        firstMismatchDomain: mismatches[0]?.domain,
        firstMismatchPath: mismatches[0]?.path,
    };
}
exports.comparePlanCandidates = comparePlanCandidates;
