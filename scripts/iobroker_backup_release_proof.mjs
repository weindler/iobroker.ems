#!/usr/bin/env node
/**
 * Simulates ioBroker backup scope for EMS dataFolder (ems.%INSTANCE% only).
 * Used when no live ioBroker installation is available for release proof.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";

const instance = process.env.EMS_INSTANCE ?? "0";
const durable = `ems.${instance}`;
const runtime = `ems-runtime.${instance}`;

async function writeTree(root, rel, files) {
	for (const [relPath, content] of Object.entries(files)) {
		const full = path.join(root, rel, relPath);
		await fs.mkdir(path.dirname(full), { recursive: true });
		await fs.writeFile(full, content);
	}
}

async function main() {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "iobroker-data-proof-"));
	const archive = path.join(root, "iobroker-backup-simulated.tar.gz");

	await writeTree(root, durable, {
		"learning/test.json": '{"marker":"durable-learning"}\n',
		"policy/policy_global_v1.json": '{"version":1}\n',
		"manifest.json": '{"format":"ems-light-instance-data"}\n',
		"migration/status.json": '{"status":"completed"}\n',
	});
	await writeTree(root, runtime, {
		"runtime/intent/intent_v1.json": '{"runtime":true}\n',
		"exports/backup/test.emsbackup": "fake\n",
		"restore/inbox/x.emsbackup": "fake\n",
		"restore/transactions/tx-1/journal.json": "{}\n",
		"recovery/boot-guard.json": "{}\n",
		"quarantine/journal-x": "orphan\n",
	});

	execFileSync("tar", ["-czf", archive, durable], { cwd: root, stdio: "pipe" });
	const listing = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" });
	const lines = listing.trim().split("\n").filter(Boolean);

	const mustInclude = [
		`${durable}/learning/test.json`,
		`${durable}/policy/policy_global_v1.json`,
		`${durable}/manifest.json`,
		`${durable}/migration/status.json`,
	];
	const mustExclude = [
		`${runtime}/`,
		"exports/",
		"restore/inbox/",
		"restore/transactions/",
		".emsbackup",
		".emssupport",
	];

	const missing = mustInclude.filter((p) => !lines.some((l) => l === p || l.startsWith(p)));
	const leaked = lines.filter((l) =>
		mustExclude.some((bad) => l.includes(bad) || l.startsWith(`${runtime}/`)),
	);

	console.log(JSON.stringify({
		ok: missing.length === 0 && leaked.length === 0,
		backupMethod: "simulated tar of dataFolder only (ems.%INSTANCE%)",
		archive,
		entryCount: lines.length,
		includedSample: lines.slice(0, 20),
		missing,
		leaked,
		note: "Live iobroker backup CLI was not available in this environment.",
	}, null, 2));

	await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
	process.exit(missing.length === 0 && leaked.length === 0 ? 0 : 1);
}

main().catch((e) => {
	console.error(e);
	process.exit(2);
});
