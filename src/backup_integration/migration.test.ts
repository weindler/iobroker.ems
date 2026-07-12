import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { atomicWriteFile, isAtomicTempFileName } from "../persistence/atomic_write.js";
import { resolveEmsPaths } from "./paths.js";
import { runRuntimeMigration, legacyRuntimePathsRemain } from "./migration.js";

describe("persistence atomic_write", () => {
	it("writes atomically and ignores temp files by name", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "atomic-"));
		const target = path.join(dir, "data.json");
		await atomicWriteFile(target, '{"ok":true}\n');
		const raw = await fs.readFile(target, "utf8");
		assert.equal(raw, '{"ok":true}\n');
		assert.equal(isAtomicTempFileName(".tmp-data.json"), true);
	});
});

describe("runtime migration", () => {
	let durable = "";
	let layout: ReturnType<typeof resolveEmsPaths>;

	before(async () => {
		durable = await fs.mkdtemp(path.join(os.tmpdir(), "ems-mig-"));
		layout = resolveEmsPaths({ namespace: "ems.0", getAbsoluteInstanceDataDir: () => durable });
		await fs.mkdir(path.join(durable, "intent"), { recursive: true });
		await fs.writeFile(path.join(durable, "intent", "intent_v1.json"), "{}\n");
	});

	after(async () => {
		await fs.rm(durable, { recursive: true, force: true }).catch(() => undefined);
		await fs.rm(layout.runtimeDataDir, { recursive: true, force: true }).catch(() => undefined);
	});

	it("moves intent from durable to runtime and removes legacy path", async () => {
		const result = await runRuntimeMigration(layout);
		assert.equal(result.ok, true);
		assert.equal(await legacyRuntimePathsRemain(layout).then((r) => r.includes("intent")), false);
		await assert.rejects(() => fs.access(path.join(durable, "intent")));
		const moved = await fs.readFile(path.join(layout.runtimeIntentDir, "intent_v1.json"), "utf8");
		assert.equal(moved, "{}\n");
	});

	it("is idempotent on second run", async () => {
		const second = await runRuntimeMigration(layout);
		assert.equal(second.status, "completed");
	});

	it("does not overwrite existing valid runtime target on conflict", async () => {
		const conflictRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ems-mig-conflict-"));
		const conflictLayout = resolveEmsPaths({
			namespace: "ems.0",
			getAbsoluteInstanceDataDir: () => conflictRoot,
		});
		await fs.mkdir(path.join(conflictRoot, "exports"), { recursive: true });
		await fs.writeFile(path.join(conflictRoot, "exports", "legacy.txt"), "legacy\n");
		await fs.mkdir(conflictLayout.runtimeExportsDir, { recursive: true });
		await fs.writeFile(path.join(conflictLayout.runtimeExportsDir, "existing.txt"), "keep\n");
		const result = await runRuntimeMigration(conflictLayout);
		assert.equal(result.ok, false);
		assert.match(result.error ?? "", /migration_target_conflict/);
		const legacy = await fs.readFile(path.join(conflictRoot, "exports", "legacy.txt"), "utf8");
		assert.equal(legacy, "legacy\n");
		const kept = await fs.readFile(path.join(conflictLayout.runtimeExportsDir, "existing.txt"), "utf8");
		assert.equal(kept, "keep\n");
		await fs.rm(conflictRoot, { recursive: true, force: true }).catch(() => undefined);
		await fs.rm(conflictLayout.runtimeDataDir, { recursive: true, force: true }).catch(() => undefined);
	});
});
