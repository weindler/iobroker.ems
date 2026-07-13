import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import * as os from "node:os";
import {
	assertJobPathNotUnderDurableDataFolder,
	resolvePlannerPaths,
} from "./paths.js";
import { durableDataDirFromRoot, runtimeDataDirFromRoot } from "../backup_integration/paths.js";
import {
	CANONICAL_DAILY_PLAN_FILE,
	CANONICAL_FORECAST_PLAN_FILE,
} from "./constants.js";

describe("planner_paths", () => {
	it("separates durable canonical plans from runtime job dirs", () => {
		const root = path.join(os.tmpdir(), `ems-planner-paths-${Date.now()}`);
		const durable = durableDataDirFromRoot(root, 0);
		const layout = resolvePlannerPaths({ namespace: "ems.0", getAbsoluteInstanceDataDir: () => durable });

		assert.equal(layout.canonicalForecastPlanPath, path.join(durable, "planner", CANONICAL_FORECAST_PLAN_FILE));
		assert.equal(layout.canonicalDailyPlanPath, path.join(durable, "planner", CANONICAL_DAILY_PLAN_FILE));
		assert.equal(
			layout.runtimePlannerDir,
			path.join(runtimeDataDirFromRoot(root, 0), "planner"),
		);
		assert.equal(layout.jobDir("job-1"), path.join(layout.runtimeJobsDir, "job-1"));
		assert.equal(layout.simulationDir("sim-1"), path.join(layout.runtimeSimulationsDir, "sim-1"));
	});

	it("keeps job files outside durable dataFolder", () => {
		const root = path.join(os.tmpdir(), `ems-planner-outside-${Date.now()}`);
		const durable = durableDataDirFromRoot(root, 0);
		const layout = resolvePlannerPaths({ namespace: "ems.0", getAbsoluteInstanceDataDir: () => durable });
		const jobDir = layout.jobDir("test-job");
		assert.doesNotThrow(() => assertJobPathNotUnderDurableDataFolder(jobDir, durable));
		assert.throws(() => assertJobPathNotUnderDurableDataFolder(path.join(durable, "planner", "jobs", "x"), durable));
	});

	it("rejects path traversal in job ids", () => {
		const durable = path.join(os.tmpdir(), "ems.0");
		const layout = resolvePlannerPaths({ namespace: "ems.0", getAbsoluteInstanceDataDir: () => durable });
		assert.throws(() => layout.jobDir("../evil"));
	});
});
