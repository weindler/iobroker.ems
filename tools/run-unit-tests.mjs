#!/usr/bin/env node
/**
 * Runs the explicit unit-test allowlist (same files as the former package.json
 * `node --test …` line). Kept out of package.json so VS Code npm task detection
 * can parse scripts.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const listPath = join(root, "tools", "unit-test-files.txt");
const files = readFileSync(listPath, "utf8")
	.split(/\r?\n/)
	.map((line) => line.trim())
	.filter((line) => line.length > 0 && !line.startsWith("#"));

if (files.length === 0) {
	console.error(`No test files listed in ${listPath}`);
	process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...files], {
	cwd: root,
	stdio: "inherit",
});
process.exit(result.status ?? 1);
