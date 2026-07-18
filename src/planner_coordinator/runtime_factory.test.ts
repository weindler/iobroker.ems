import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { assertJobPathNotUnderDurableDataFolder } from "../planner_paths/paths.js";
import { createPlannerRuntimeContext, type PlannerCoordinatorAdapterHost } from "./runtime_factory.js";

/** Minimal real adapter contract — no getAbsoluteInstanceDataDir. */
function minimalAdapter(namespace: string): PlannerCoordinatorAdapterHost {
	return {
		namespace,
		config: { planner_runtime_mode: "shadow_auto", global_execution_mode: "dryrun" },
		getStateAsync: async () => null,
	};
}

describe("planner_coordinator runtime_factory paths", () => {
	it("creates runtime from minimal adapter without getAbsoluteInstanceDataDir", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "ems-runtime-factory-"));
		const durable = path.join(root, "ems.0");
		const adapter = minimalAdapter("ems.0");
		assert.equal(
			typeof (adapter as { getAbsoluteInstanceDataDir?: unknown }).getAbsoluteInstanceDataDir,
			"undefined",
		);
		const ctx = createPlannerRuntimeContext(adapter, { paths: durable });
		assert.equal(ctx.durableDataDir, durable);
		assert.equal(ctx.runtimeDataDir, path.join(root, "ems-runtime.0"));
		assert.equal(ctx.runtimeJobsDir, path.join(root, "ems-runtime.0", "planner", "jobs"));
		assert.doesNotThrow(() =>
			assertJobPathNotUnderDurableDataFolder(path.join(ctx.runtimeJobsDir, "job-1"), ctx.durableDataDir),
		);
		assert.ok(typeof ctx.deps.buildSnapshot === "function");
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("resolves distinct durable/runtime dirs for instance 0 and 1", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "ems-runtime-inst-"));
		const ctx0 = createPlannerRuntimeContext(minimalAdapter("ems.0"), {
			paths: path.join(root, "ems.0"),
		});
		const ctx1 = createPlannerRuntimeContext(minimalAdapter("ems.1"), {
			paths: path.join(root, "ems.1"),
		});
		assert.equal(ctx0.durableDataDir, path.join(root, "ems.0"));
		assert.equal(ctx1.durableDataDir, path.join(root, "ems.1"));
		assert.equal(ctx0.runtimeDataDir, path.join(root, "ems-runtime.0"));
		assert.equal(ctx1.runtimeDataDir, path.join(root, "ems-runtime.1"));
		assert.notEqual(ctx0.runtimeJobsDir, ctx1.runtimeJobsDir);
		assert.ok(!ctx0.runtimeJobsDir.startsWith(ctx0.durableDataDir + path.sep));
		assert.ok(!ctx1.runtimeJobsDir.startsWith(ctx1.durableDataDir + path.sep));
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("accepts host durableDataDir path contract without adapter method", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "ems-runtime-inject-"));
		const durable = path.join(root, "ems.0");
		const adapter = {
			...minimalAdapter("ems.0"),
			durableDataDir: durable,
		};
		const ctx = createPlannerRuntimeContext(adapter);
		assert.equal(ctx.durableDataDir, durable);
		assert.equal(ctx.runtimeDataDir, path.join(root, "ems-runtime.0"));
		assert.doesNotThrow(() =>
			assertJobPathNotUnderDurableDataFolder(path.join(ctx.runtimeJobsDir, "x"), durable),
		);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("keeps factory job layout under runtime, not durable", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "ems-runtime-trav-"));
		const durable = path.join(root, "ems.0");
		const ctx = createPlannerRuntimeContext(minimalAdapter("ems.0"), { paths: durable });
		assert.ok(ctx.runtimeJobsDir.includes(`${path.sep}ems-runtime.0${path.sep}`));
		assert.ok(!ctx.runtimeJobsDir.startsWith(durable + path.sep));
		assert.throws(() =>
			assertJobPathNotUnderDurableDataFolder(path.join(durable, "planner", "jobs", "x"), durable),
		);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("buildSnapshot progresses past path resolution (no runtime_import_failed)", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "ems-runtime-snap-"));
		const durable = path.join(root, "ems.0");
		fs.mkdirSync(path.join(durable, "learning", "house_load"), { recursive: true });
		const adapter = minimalAdapter("ems.0");
		const ctx = createPlannerRuntimeContext(adapter, { paths: durable });
		try {
			await ctx.deps.buildSnapshot();
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			assert.ok(
				!message.includes("getAbsoluteInstanceDataDir"),
				`unexpected adapter method error: ${message}`,
			);
			assert.ok(!message.includes("runtime_import_failed"), `unexpected import stage: ${message}`);
		}
		fs.rmSync(root, { recursive: true, force: true });
	});
});
