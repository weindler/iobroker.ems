"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearGridSupplyShadowReferenceForTest = exports.getGridSupplyShadowReference = exports.recordGridSupplyShadowReference = void 0;
const canonical_1 = require("./canonical");
const projection_1 = require("./projection");
let latestReference = null;
function recordGridSupplyShadowReference(forecast, capturedAt) {
    const projection = (0, projection_1.projectionFromGridSupplyForecast)(forecast, capturedAt);
    latestReference = {
        capturedAt: projection.capturedAt,
        horizonStart: projection.horizonStart,
        horizonEnd: projection.horizonEnd,
        slotCount: projection.slotCount,
        referenceRevision: (0, canonical_1.computeShadowProjectionRevision)(projection),
        recordedAt: new Date().toISOString(),
    };
}
exports.recordGridSupplyShadowReference = recordGridSupplyShadowReference;
function getGridSupplyShadowReference() {
    return latestReference ? { ...latestReference } : null;
}
exports.getGridSupplyShadowReference = getGridSupplyShadowReference;
function clearGridSupplyShadowReferenceForTest() {
    latestReference = null;
}
exports.clearGridSupplyShadowReferenceForTest = clearGridSupplyShadowReferenceForTest;
