import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	EXPORT_DIR_MODE,
	EXPORT_FILE_MODE,
	adapterFileDownloadPath,
	applyReadableExportDirs,
} from "./export_permissions.js";
import { writeAtomicArchive } from "./retention.js";

describe("export permissions", () => {
	let tmp = "";
	beforeEach(async () => {
		tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-export-mode-"));
	});
	afterEach(async () => {
		await fs.rm(tmp, { recursive: true, force: true });
	});

	it("schreibt Archive 0644 in Verzeichnis 0755", async () => {
		const dir = path.join(tmp, "backup");
		const file = path.join(dir, "ems-light-test-backup-20260901T120000000Z.emsbackup");
		await writeAtomicArchive(file, Buffer.from("pk"));
		const stFile = await fs.stat(file);
		const stDir = await fs.stat(dir);
		assert.equal(stFile.mode & 0o777, EXPORT_FILE_MODE);
		assert.equal(stDir.mode & 0o777, EXPORT_DIR_MODE);
	});

	it("korrigiert bestehende 0600-Dateien", async () => {
		const dir = path.join(tmp, "support");
		await fs.mkdir(dir, { recursive: true, mode: 0o700 });
		const file = path.join(dir, "old.emssupport");
		await fs.writeFile(file, "x", { mode: 0o600 });
		await applyReadableExportDirs([dir]);
		assert.equal((await fs.stat(dir)).mode & 0o777, EXPORT_DIR_MODE);
		assert.equal((await fs.stat(file)).mode & 0o777, EXPORT_FILE_MODE);
	});

	it("Admin-Download-Pfad enthält Dateiname und Endung", () => {
		assert.equal(
			adapterFileDownloadPath("ems.0", "support", "ems-light-x.emssupport"),
			"/files/ems.0/support/ems-light-x.emssupport",
		);
	});
});
