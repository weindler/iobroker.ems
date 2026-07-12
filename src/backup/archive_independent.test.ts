import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { buildZipArchive, readZipEntryData, readZipEntryNames } from "./archive.js";
import { sha256Buffer } from "./checksum.js";
import { buildExportManifest, buildManifestFileEntries, exportFileName } from "./manifest.js";
import {
	extractManifestFromArchiveEntries,
	validateManifestPayloadConsistency,
	assertSafeArchivePath,
} from "./manifest_validate.js";
import { stableJsonStringify, validateManifest } from "./schema.js";
import { runBackupExport, runExport, resetExportMutexForTest } from "./service.js";

function hasUnzip(): boolean {
	return spawnSync("unzip", ["-h"], { stdio: "ignore" }).status === 0;
}

class ZipTestHost {
	readonly namespace = "ems.0";
	readonly objects = new Map<string, ioBroker.Object>();
	config: Record<string, unknown> = { global_execution_mode: "dryrun" };
	common = { version: "0.1.141" };
	constructor(private dataDir: string) {}
	log = {
		debug: () => undefined,
		info: () => undefined,
		warn: () => undefined,
		error: () => undefined,
		silly: () => undefined,
		level: "info",
	} as unknown as ioBroker.Logger;
	getAbsoluteInstanceDataDir(): string {
		return this.dataDir;
	}
	async getStateAsync(): Promise<null> {
		return null;
	}
	async setStateAsync(): Promise<void> {
		return;
	}
	async setObjectNotExistsAsync(id: string, obj: ioBroker.Object): Promise<void> {
		if (!this.objects.has(id)) this.objects.set(id, { ...obj, _id: id } as ioBroker.Object);
	}
}

describe("independent ZIP compatibility", () => {
	let tmp: string;

	beforeEach(async () => {
		tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-zip-"));
		resetExportMutexForTest();
	});

	afterEach(async () => {
		resetExportMutexForTest();
		await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
	});

	it("builds archive with empty, binary and utf8 payloads", () => {
		const utf8 = "Grüße — 日本語 — emoji 😀";
		const binary = Buffer.from([0x00, 0xff, 0x42, 0x89, 0x50]);
		const entries = [
			{ path: "empty.txt", content: "" },
			{ path: "utf8/data.json", content: stableJsonStringify({ text: utf8 }) },
			{ path: "binary/blob.bin", content: binary },
		];
		const zip = buildZipArchive(entries);
		assert.ok(zip.length > 0);
		for (const e of entries) {
			const buf = typeof e.content === "string" ? Buffer.from(e.content, "utf8") : e.content;
			const extracted = readZipEntryData(zip, e.path);
			assert.ok(extracted);
			assert.equal(extracted!.length, buf.length);
			assert.equal(sha256Buffer(extracted!), sha256Buffer(buf));
		}
	});

	it("rejects unsafe archive paths", () => {
		assert.throws(() => assertSafeArchivePath("../evil"));
		assert.throws(() => assertSafeArchivePath("/etc/passwd"));
		assert.throws(() => assertSafeArchivePath("a\\b"));
		assert.throws(() => buildZipArchive([
			{ path: "ok.txt", content: "a" },
			{ path: "ok.txt", content: "b" },
		]));
	});

	it("manifest.json is not listed in files[]", () => {
		const payload = [{ path: "config/adapter.json", content: "{}\n" }];
		const files = buildManifestFileEntries(payload);
		const manifest = buildExportManifest({
			kind: "backup",
			adapterVersion: "0.1.141",
			instance: 0,
			namespace: "ems.0",
			files,
		});
		assert.ok(!manifest.files.some((f) => f.path === "manifest.json"));
		validateManifestPayloadConsistency(manifest, payload);
	});

	it("support manifest declares restore.supported=false", () => {
		const files = buildManifestFileEntries([{ path: "summary/system.json", content: "{}\n" }]);
		const manifest = buildExportManifest({
			kind: "support",
			adapterVersion: "0.1.141",
			instance: 0,
			namespace: "ems.0",
			files,
		});
		validateManifest(manifest, "support");
		assert.equal(manifest.restore?.supported, false);
	});

	it("unzip accepts .emsbackup and .emssupport and checksums match manifest", async (t) => {
		if (!hasUnzip()) {
			t.skip("unzip not available");
			return;
		}

		const host = new ZipTestHost(tmp);
		const backup = await runBackupExport(host);
		assert.equal(backup.ok, true);
		if (!backup.ok) return;

		const support = await runExport(host, "support", async () => [
			{ path: "logs/errors.ndjson", content: '{"event":"test"}\n' },
		]);
		assert.equal(support.ok, true);
		if (!support.ok) return;

		for (const result of [backup, support]) {
			if (!result.ok) continue;
			const archivePath = result.filePath;
			execFileSync("unzip", ["-t", archivePath], { stdio: "pipe" });

			const extractDir = await fs.mkdtemp(path.join(tmp, "extract-"));
			execFileSync("unzip", ["-o", archivePath, "-d", extractDir], { stdio: "pipe" });

			const buf = await fs.readFile(archivePath);
			const names = readZipEntryNames(buf);
			assert.ok(names.includes("manifest.json"));
			const manifestRaw = await fs.readFile(path.join(extractDir, "manifest.json"), "utf8");
			const manifest = JSON.parse(manifestRaw);
			assert.ok(!manifest.files.some((f: { path: string }) => f.path === "manifest.json"));

			for (const fe of manifest.files) {
				const diskPath = path.join(extractDir, fe.path);
				const diskBuf = await fs.readFile(diskPath);
				assert.equal(diskBuf.length, fe.size_bytes);
				assert.equal(sha256Buffer(diskBuf), fe.sha256);
			}

			const payloadEntries = manifest.files.map((f: { path: string }) => ({
				path: f.path,
				content: readZipEntryData(buf, f.path)!,
			}));
			validateManifestPayloadConsistency(manifest, payloadEntries);
			extractManifestFromArchiveEntries([
				...payloadEntries,
				{ path: "manifest.json", content: manifestRaw },
			]);
		}
	});

	it("crc mismatch is detectable via manifest sha256", async () => {
		const content = stableJsonStringify({ ok: true });
		const payload = [{ path: "config/adapter.json", content }];
		const files = buildManifestFileEntries(payload);
		const manifest = buildExportManifest({
			kind: "backup",
			adapterVersion: "0.1.141",
			instance: 0,
			namespace: "ems.0",
			files,
		});
		manifest.files[0].sha256 = "0".repeat(64);
		assert.throws(() => validateManifestPayloadConsistency(manifest, payload));
	});
});
