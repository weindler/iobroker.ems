"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const builder_js_1 = require("../planner_snapshot/builder.js");
const parity_fixture_js_1 = require("../planner_snapshot/parity_fixture.js");
const prepare_js_1 = require("../planner_preparation/prepare.js");
const canonical_js_1 = require("./canonical.js");
const compare_js_1 = require("./compare.js");
const projection_js_1 = require("./projection.js");
function baseProjection(overrides = {}) {
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
(0, node_test_1.describe)("planner_shadow compare", () => {
    (0, node_test_1.it)("identical projections yield matched status and equal revisions", () => {
        const reference = baseProjection();
        const worker = baseProjection();
        const { result } = (0, compare_js_1.compareShadowProjections)(reference, worker);
        strict_1.default.equal(result.status, "matched");
        strict_1.default.equal(result.mismatchCount, 0);
        strict_1.default.equal(result.referenceRevision, result.workerRevision);
        strict_1.default.equal(result.referenceRevision?.length, 64);
    });
    (0, node_test_1.it)("slot deviation yields mismatch with first path", () => {
        const reference = baseProjection();
        const worker = baseProjection({
            slots: [
                {
                    ...reference.slots[0],
                    maxImportW: 4000,
                },
            ],
        });
        const { result, mismatches } = (0, compare_js_1.compareShadowProjections)(reference, worker);
        strict_1.default.equal(result.status, "mismatch");
        strict_1.default.ok(result.mismatchCount >= 1);
        strict_1.default.equal(result.firstMismatchPath, mismatches[0]?.path);
    });
    (0, node_test_1.it)("null vs zero is a mismatch", () => {
        const reference = baseProjection({
            slots: [{ ...baseProjection().slots[0], maxImportW: null }],
        });
        const worker = baseProjection({
            slots: [{ ...baseProjection().slots[0], maxImportW: 0 }],
        });
        const { result } = (0, compare_js_1.compareShadowProjections)(reference, worker);
        strict_1.default.equal(result.status, "mismatch");
    });
    (0, node_test_1.it)("price deviation yields mismatch", () => {
        const reference = baseProjection();
        const worker = baseProjection({
            slots: [{ ...reference.slots[0], priceCtPerKwh: 99 }],
        });
        const { result } = (0, compare_js_1.compareShadowProjections)(reference, worker);
        strict_1.default.equal(result.status, "mismatch");
        strict_1.default.ok(result.firstMismatchPath?.includes("priceCtPerKwh"));
    });
    (0, node_test_1.it)("policy deviation yields mismatch", () => {
        const reference = baseProjection();
        const worker = baseProjection({ gridImportAllowed: false });
        const { result } = (0, compare_js_1.compareShadowProjections)(reference, worker);
        strict_1.default.equal(result.status, "mismatch");
        strict_1.default.equal(result.firstMismatchPath, "gridImportAllowed");
    });
    (0, node_test_1.it)("snapshot and prepared parity fixture match", async () => {
        const snapshot = await (0, builder_js_1.buildPlannerInputSnapshot)((0, parity_fixture_js_1.createParityFixtureSource)());
        const prepared = (0, prepare_js_1.preparePlannerFromSnapshot)(snapshot);
        const { result } = (0, compare_js_1.compareSnapshotPreparedInput)(snapshot, prepared);
        strict_1.default.equal(result.status, "matched");
        strict_1.default.equal(result.mismatchCount, 0);
    });
    (0, node_test_1.it)("revisions are deterministic for identical projections", () => {
        const a = baseProjection();
        const b = baseProjection();
        strict_1.default.equal((0, canonical_js_1.computeShadowProjectionRevision)(a), (0, canonical_js_1.computeShadowProjectionRevision)(b));
    });
    (0, node_test_1.it)("stored reference time mismatch is not counted as field mismatch", () => {
        const worker = baseProjection();
        const result = (0, compare_js_1.compareAgainstStoredReference)({
            capturedAt: "2026-07-01T11:00:00.000Z",
            horizonStart: "x",
            horizonEnd: "y",
            slotCount: 0,
            referenceRevision: "a".repeat(64),
            recordedAt: "2026-07-01T11:00:00.000Z",
        }, worker);
        strict_1.default.equal(result.status, "reference_time_mismatch");
    });
    (0, node_test_1.it)("missing stored reference yields reference_missing", () => {
        const result = (0, compare_js_1.compareAgainstStoredReference)(null, baseProjection());
        strict_1.default.equal(result.status, "reference_missing");
    });
    (0, node_test_1.it)("snapshot vs prepared uses in-process and worker projections", async () => {
        const snapshot = await (0, builder_js_1.buildPlannerInputSnapshot)((0, parity_fixture_js_1.createParityFixtureSource)());
        const prepared = (0, prepare_js_1.preparePlannerFromSnapshot)(snapshot);
        const reference = (0, projection_js_1.projectionFromSnapshot)(snapshot);
        const worker = (0, projection_js_1.projectionFromPreparedInput)(prepared);
        strict_1.default.equal(reference.capturedAt, worker.capturedAt);
        const { result } = (0, compare_js_1.compareShadowProjections)(reference, worker);
        strict_1.default.equal(result.status, "matched");
    });
});
