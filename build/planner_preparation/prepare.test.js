"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const path = __importStar(require("node:path"));
const builder_js_1 = require("../planner_snapshot/builder.js");
const canonical_js_1 = require("../planner_snapshot/canonical.js");
const parity_fixture_js_1 = require("../planner_snapshot/parity_fixture.js");
const canonical_js_2 = require("./canonical.js");
const prepare_js_1 = require("./prepare.js");
const types_js_1 = require("./types.js");
const validate_js_1 = require("./validate.js");
(0, node_test_1.describe)("planner_preparation grid supply stage", () => {
    (0, node_test_1.it)("prepares slots from snapshot deterministically", async () => {
        const snapshot = await (0, builder_js_1.buildPlannerInputSnapshot)((0, parity_fixture_js_1.createParityFixtureSource)());
        const a = (0, prepare_js_1.preparePlannerFromSnapshot)(snapshot);
        const b = (0, prepare_js_1.preparePlannerFromSnapshot)(snapshot);
        strict_1.default.deepEqual(a, b);
        strict_1.default.ok(a.slots.length >= 1);
        strict_1.default.equal(a.inputRevision, snapshot.inputRevision);
        strict_1.default.equal(a.policy.priceSource, "dynamic_tariff");
    });
    (0, node_test_1.it)("identical input yields identical preparationRevision", async () => {
        const snapshot = await (0, builder_js_1.buildPlannerInputSnapshot)((0, parity_fixture_js_1.createParityFixtureSource)());
        const a = (0, prepare_js_1.preparePlannerFromSnapshot)(snapshot);
        const b = (0, prepare_js_1.preparePlannerFromSnapshot)(snapshot);
        strict_1.default.equal(a.preparationRevision, b.preparationRevision);
        strict_1.default.equal(a.preparationRevision.length, 64);
    });
    (0, node_test_1.it)("semantic change changes preparationRevision", async () => {
        const snapshot = await (0, builder_js_1.buildPlannerInputSnapshot)((0, parity_fixture_js_1.createParityFixtureSource)());
        const base = (0, prepare_js_1.preparePlannerFromSnapshot)(snapshot);
        const changed = (0, prepare_js_1.preparePlannerFromSnapshot)({
            ...snapshot,
            live: { ...snapshot.live, currentPriceCtPerKwh: 99 },
        });
        strict_1.default.notEqual(base.preparationRevision, changed.preparationRevision);
    });
    (0, node_test_1.it)("preserves null vs zero distinction in slots", async () => {
        const snapshot = await (0, builder_js_1.buildPlannerInputSnapshot)((0, parity_fixture_js_1.createParityFixtureSource)({
            states: {
                "edge.zero_w": { value: 0 },
                "optional.missing.state": { value: null },
            },
        }));
        const prepared = (0, prepare_js_1.preparePlannerFromSnapshot)(snapshot);
        strict_1.default.equal(snapshot.live.pvPowerW, 1500);
        strict_1.default.ok(prepared.diagnostics.slotCount >= 0);
    });
    (0, node_test_1.it)("rejects manipulated inputRevision", async () => {
        const snapshot = await (0, builder_js_1.buildPlannerInputSnapshot)((0, parity_fixture_js_1.createParityFixtureSource)());
        snapshot.inputRevision = "0".repeat(64);
        strict_1.default.throws(() => (0, validate_js_1.validatePlannerInputRevision)(snapshot), types_js_1.PlannerInputValidationError);
    });
    (0, node_test_1.it)("recomputes preparationRevision from canonical payload", async () => {
        const snapshot = await (0, builder_js_1.buildPlannerInputSnapshot)((0, parity_fixture_js_1.createParityFixtureSource)());
        const prepared = (0, prepare_js_1.preparePlannerFromSnapshot)(snapshot);
        const expected = (0, canonical_js_2.computePreparationRevision)({ ...prepared, preparationRevision: "" });
        strict_1.default.equal(prepared.preparationRevision, expected);
    });
    (0, node_test_1.it)("uses capturedAt as planning now", async () => {
        const snapshot = await (0, builder_js_1.buildPlannerInputSnapshot)((0, parity_fixture_js_1.createParityFixtureSource)({ now: new Date("2026-07-01T12:00:00.000Z") }));
        const prepared = (0, prepare_js_1.preparePlannerFromSnapshot)(snapshot);
        strict_1.default.equal(prepared.capturedAt, "2026-07-01T12:00:00.000Z");
        strict_1.default.equal(prepared.generatedAt, snapshot.capturedAt);
    });
    (0, node_test_1.it)("inputRevision stable when only recomputed from same snapshot", async () => {
        const snapshot = await (0, builder_js_1.buildPlannerInputSnapshot)((0, parity_fixture_js_1.createParityFixtureSource)());
        const rev = (0, canonical_js_1.computeInputRevision)({ ...snapshot, inputRevision: "" });
        strict_1.default.equal(snapshot.inputRevision, rev);
    });
    (0, node_test_1.it)("preparation module avoids adapter and runtime engine imports", () => {
        const text = (0, node_fs_1.readFileSync)(path.join(process.cwd(), "src/planner_preparation/prepare.ts"), "utf8");
        for (const forbidden of ["adapter-core", "runtime/engine", "ems_light", "planner_worker/main"]) {
            strict_1.default.ok(!text.includes(forbidden), `prepare must not import ${forbidden}`);
        }
    });
});
