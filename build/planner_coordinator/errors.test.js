"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const errors_js_1 = require("./errors.js");
(0, node_test_1.describe)("planner_coordinator staged errors", () => {
    (0, node_test_1.it)("preserves stage errors without collapsing to coordinator_failed", () => {
        const err = new errors_js_1.PlannerCoordinatorStageError("runtime_import_failed", "runtime_import_failed", "Cannot find module './runtime_factory.js'");
        const classified = (0, errors_js_1.classifyCoordinatorError)(err);
        strict_1.default.equal(classified.stage, "runtime_import_failed");
        strict_1.default.equal(classified.code, "runtime_import_failed");
        strict_1.default.match(classified.detail, /runtime_import_failed/);
    });
    (0, node_test_1.it)("maps durable job-path guard to worker_spawn_failed", () => {
        const classified = (0, errors_js_1.classifyCoordinatorError)(new Error("job path must not be under durable dataFolder"));
        strict_1.default.equal(classified.stage, "worker_spawn_failed");
        strict_1.default.equal(classified.code, "worker_spawn_failed");
    });
    (0, node_test_1.it)("maps getAbsolutePath source failures", () => {
        const classified = (0, errors_js_1.classifyCoordinatorError)(new Error("getAbsolutePath unavailable for planner snapshot file read"));
        strict_1.default.equal(classified.stage, "snapshot_source_failed");
    });
    (0, node_test_1.it)("wrapCoordinatorStageError keeps prior stage", () => {
        const inner = (0, errors_js_1.wrapCoordinatorStageError)("snapshot_build_failed", "snapshot_build_failed", new Error("boom"));
        const outer = (0, errors_js_1.wrapCoordinatorStageError)("runtime_import_failed", "runtime_import_failed", inner);
        strict_1.default.equal(outer.stage, "snapshot_build_failed");
    });
    (0, node_test_1.it)("safe detail strips newlines and truncates", () => {
        const detail = (0, errors_js_1.safeCoordinatorErrorDetail)(new Error("line1\nline2"), 20);
        strict_1.default.equal(detail.includes("\n"), false);
        strict_1.default.ok(detail.length <= 20);
    });
});
