import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	classifyCoordinatorError,
	PlannerCoordinatorStageError,
	safeCoordinatorErrorDetail,
	wrapCoordinatorStageError,
} from "./errors.js";

describe("planner_coordinator staged errors", () => {
	it("preserves stage errors without collapsing to coordinator_failed", () => {
		const err = new PlannerCoordinatorStageError(
			"runtime_import_failed",
			"runtime_import_failed",
			"Cannot find module './runtime_factory.js'",
		);
		const classified = classifyCoordinatorError(err);
		assert.equal(classified.stage, "runtime_import_failed");
		assert.equal(classified.code, "runtime_import_failed");
		assert.match(classified.detail, /runtime_import_failed/);
	});

	it("maps durable job-path guard to worker_spawn_failed", () => {
		const classified = classifyCoordinatorError(new Error("job path must not be under durable dataFolder"));
		assert.equal(classified.stage, "worker_spawn_failed");
		assert.equal(classified.code, "worker_spawn_failed");
	});

	it("maps getAbsolutePath source failures", () => {
		const classified = classifyCoordinatorError(
			new Error("getAbsolutePath unavailable for planner snapshot file read"),
		);
		assert.equal(classified.stage, "snapshot_source_failed");
	});

	it("wrapCoordinatorStageError keeps prior stage", () => {
		const inner = wrapCoordinatorStageError(
			"snapshot_build_failed",
			"snapshot_build_failed",
			new Error("boom"),
		);
		const outer = wrapCoordinatorStageError("runtime_import_failed", "runtime_import_failed", inner);
		assert.equal(outer.stage, "snapshot_build_failed");
	});

	it("safe detail strips newlines and truncates", () => {
		const detail = safeCoordinatorErrorDetail(new Error("line1\nline2"), 20);
		assert.equal(detail.includes("\n"), false);
		assert.ok(detail.length <= 20);
	});
});
