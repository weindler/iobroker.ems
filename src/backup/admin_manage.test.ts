import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { deleteBackupFile, deleteOldBackups, listBackupFileNames, readBackupFileBase64 } from "./admin_files";

async function setup() {
	const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-manage-"));
	const deletedAdapterFiles: string[] = [];
	const host = {
		getAbsoluteInstanceDataDir: () => path.join(tmp, "ems.0"),
		namespace: "ems.0",
		writeFileAsync: async () => undefined,
		delFileAsync: async (_a: string, f: string) => {
			deletedAdapterFiles.push(f);
		},
	};
	const { resolveEmsPaths } = await import("../backup_integration/paths.js");
	const layout = resolveEmsPaths(host);
	const dir = path.join(layout.runtimeExportsDir, "backup");
	await fs.mkdir(dir, { recursive: true });
	for (const n of ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]) {
		await fs.writeFile(path.join(dir, `ems-light-${n}T10-00-00-000Z.emsbackup`), "x".repeat(64));
	}
	return { tmp, host, dir, deletedAdapterFiles };
}

describe("backup verwalten", () => {
	it("listet neueste zuerst, lädt und löscht eine Datei", async () => {
		const { tmp, host, dir, deletedAdapterFiles } = await setup();
		try {
			const names = await listBackupFileNames(host);
			assert.equal(names.length, 4);
			assert.ok(names[0]!.includes("2026-11-13"));
			const dl = await readBackupFileBase64(host, names[0]!);
			assert.ok(dl.ok && dl.sizeBytes === 64 && dl.downloadPath === `/files/ems.0/backup/${names[0]}`);
			const del = await deleteBackupFile(host, names[3]!);
			assert.ok(del.ok);
			assert.equal((await fs.readdir(dir)).length, 3);
			assert.ok(deletedAdapterFiles.includes(`backup/${names[3]}`));
		} finally {
			await fs.rm(tmp, { recursive: true, force: true });
		}
	});
	it("lehnt unsichere Dateinamen ab", async () => {
		const { tmp, host } = await setup();
		try {
			assert.equal((await deleteBackupFile(host, "../x.emsbackup")).ok, false);
			assert.equal((await deleteBackupFile(host, "evil.emsbackup")).ok, false);
			assert.equal((await readBackupFileBase64(host, "ems-light-x.txt")).ok, false);
		} finally {
			await fs.rm(tmp, { recursive: true, force: true });
		}
	});
	it("löscht alle außer den neuesten N", async () => {
		const { tmp, host } = await setup();
		try {
			const r = await deleteOldBackups(host, 2);
			assert.equal(r.deleted.length, 2);
			assert.equal(r.kept.length, 2);
			assert.ok(r.kept[0]!.includes("2026-11-13"));
			assert.equal((await deleteOldBackups(host, 0)).kept.length, 1);
		} finally {
			await fs.rm(tmp, { recursive: true, force: true });
		}
	});
});
