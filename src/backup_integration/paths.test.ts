import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import * as os from "node:os";
import {
	categoryDataPath,
	durableDataDirFromRoot,
	resolveEmsPaths,
	runtimeDataDirFromRoot,
	assertPathWithinRoot,
	parseInstanceFromNamespace,
} from "./paths.js";

describe("backup_integration paths", () => {
	it("isolates instance 0 and 1 durable/runtime dirs", () => {
		const root = path.join(os.tmpdir(), "ems-path-test-root");
		const d0 = durableDataDirFromRoot(root, 0);
		const d1 = durableDataDirFromRoot(root, 1);
		const r0 = runtimeDataDirFromRoot(root, 0);
		const r1 = runtimeDataDirFromRoot(root, 1);
		assert.equal(d0, path.join(root, "ems.0"));
		assert.equal(d1, path.join(root, "ems.1"));
		assert.equal(r0, path.join(root, "ems-runtime.0"));
		assert.equal(r1, path.join(root, "ems-runtime.1"));
		assert.notEqual(d0, d1);
		assert.notEqual(r0, r1);
	});

	it("maps learning to durable and intent to runtime", () => {
		const root = path.join(os.tmpdir(), "ems-path-layout");
		const durable = path.join(root, "ems.0");
		const layout = resolveEmsPaths({ namespace: "ems.0", getAbsoluteInstanceDataDir: () => durable });
		assert.equal(categoryDataPath(layout, "learning/house_load"), path.join(durable, "learning/house_load"));
		assert.equal(categoryDataPath(layout, "policy"), path.join(durable, "policy"));
		assert.equal(categoryDataPath(layout, "intent"), path.join(layout.runtimeDataDir, "runtime", "intent"));
		assert.equal(
			categoryDataPath(layout, "immersion_heater"),
			path.join(layout.runtimeDataDir, "runtime", "addons", "immersion_heater"),
		);
	});

	it("uses colocated runtime for arbitrary test durable roots", () => {
		const tmp = path.join(os.tmpdir(), "ems-isolated-test-xyz");
		const layout = resolveEmsPaths({ namespace: "ems.0", getAbsoluteInstanceDataDir: () => tmp });
		assert.equal(layout.runtimeDataDir, path.join(tmp, "ems-runtime.0"));
	});

	it("blocks path traversal in categories", () => {
		const layout = resolveEmsPaths({ namespace: "ems.0", getAbsoluteInstanceDataDir: () => "/tmp/ems.0" });
		assert.throws(() => categoryDataPath(layout, "../secret"));
	});

	it("assertPathWithinRoot accepts children only", () => {
		const root = "/tmp/ems.0/learning";
		assert.doesNotThrow(() => assertPathWithinRoot("/tmp/ems.0/learning/file.json", root));
		assert.throws(() => assertPathWithinRoot("/tmp/ems.0/policy/file.json", root));
	});

	it("uses durableDataDir injection without getAbsoluteInstanceDataDir", () => {
		const root = path.join(os.tmpdir(), "ems-durable-inject");
		const durable = path.join(root, "ems.0");
		const layout = resolveEmsPaths({ namespace: "ems.0", durableDataDir: durable });
		assert.equal(layout.durableDataDir, path.resolve(durable));
		assert.equal(layout.runtimeDataDir, path.resolve(path.join(root, "ems-runtime.0")));
	});

	it("parseInstanceFromNamespace", () => {
		assert.equal(parseInstanceFromNamespace("ems.0"), 0);
		assert.equal(parseInstanceFromNamespace("ems.1"), 1);
	});
});
