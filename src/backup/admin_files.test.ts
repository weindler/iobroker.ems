import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { listRestoreFileOptions, parseBackupFileStamp, writeRestoreUploadToInbox } from "./admin_files";
import { restoreInboxDir } from "../restore/source";

describe("backup admin_files", () => {
	it("lists emsbackup from backup and inbox dirs", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-admin-files-"));
		try {
			const host = {
				getAbsoluteInstanceDataDir: () => path.join(tmp, "ems.0"),
				namespace: "ems.0",
			};
			const { resolveEmsPaths } = await import("../backup_integration/paths.js");
			const layout = resolveEmsPaths(host);
			await fs.mkdir(path.join(layout.runtimeExportsDir, "backup"), { recursive: true });
			await fs.mkdir(layout.runtimeRestoreInboxDir, { recursive: true });
			await fs.writeFile(path.join(layout.runtimeExportsDir, "backup", "ems-light-a.emsbackup"), "a");
			await fs.writeFile(path.join(layout.runtimeRestoreInboxDir, "ems-light-b.emsbackup"), "b");
			await fs.writeFile(path.join(layout.runtimeExportsDir, "backup", "ignore.txt"), "z");
			const opts = await listRestoreFileOptions(host);
			assert.ok(opts.some((o) => o.value === "ems-light-a.emsbackup"));
			assert.ok(opts.some((o) => o.value === "ems-light-b.emsbackup"));
			assert.ok(!opts.some((o) => o.value === "ignore.txt"));
		} finally {
			await fs.rm(tmp, { recursive: true, force: true });
		}
	});


	it("labels newest backup with timestamp and NEUESTE", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-admin-label-"));
		try {
			const host = {
				getAbsoluteInstanceDataDir: () => path.join(tmp, "ems.0"),
				namespace: "ems.0",
			};
			const { resolveEmsPaths } = await import("../backup_integration/paths.js");
			const layout = resolveEmsPaths(host);
			await fs.mkdir(path.join(layout.runtimeExportsDir, "backup"), { recursive: true });
			await fs.writeFile(
				path.join(layout.runtimeExportsDir, "backup", "ems-light-0.1.1-backup-2026-07-19T100000000Z.emsbackup"),
				"a",
			);
			await fs.writeFile(
				path.join(layout.runtimeExportsDir, "backup", "ems-light-0.1.1-backup-2026-07-19T090000000Z.emsbackup"),
				"b",
			);
			const opts = await listRestoreFileOptions(host);
			assert.equal(opts[0]?.value, "ems-light-0.1.1-backup-2026-07-19T100000000Z.emsbackup");
			assert.match(String(opts[0]?.label), /NEUESTE/);
			assert.match(String(opts[0]?.label), /2026-07-19 10:00:00/);
			assert.ok(parseBackupFileStamp("ems-light-0.1.171-backup-2026-07-19T095123951Z.emsbackup"));
		} finally {
			await fs.rm(tmp, { recursive: true, force: true });
		}
	});

	it("writes upload into inbox with valid name", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-admin-up-"));
		try {
			const host = {
				getAbsoluteInstanceDataDir: () => path.join(tmp, "ems.0"),
				namespace: "ems.0",
			};
			const payload = Buffer.from("PK\x03\x04dummy-zip-content-for-test-xx").toString("base64");
			const res = await writeRestoreUploadToInbox(host, "x.emsbackup", payload);
			assert.equal(res.ok, true);
			if (res.ok) {
				assert.match(res.fileName, /^ems-light-upload-.+\.emsbackup$/);
				const st = await fs.stat(path.join(restoreInboxDir(host), res.fileName));
				assert.ok(st.size > 10);
			}
		} finally {
			await fs.rm(tmp, { recursive: true, force: true });
		}
	});
});
