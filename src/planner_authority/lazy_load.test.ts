import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const HEAVY = [
	"/build/planner_authority/service.js",
	"/build/planner_authority/publish.js",
	"/build/planner_coordinator/compose.js",
];

function run(body: string): string[] {
	const r = spawnSync(process.execPath, ["-e", body], {
		cwd: process.cwd(),
		encoding: "utf8",
		env: { ...process.env, NODE_OPTIONS: "" },
	});
	assert.equal(r.status, 0, r.stderr || r.stdout);
	return r.stdout.trim().split("\n").filter(Boolean).map((l) => l.replace(process.cwd(), ""));
}

describe("planner_authority lazy load", () => {
	it("authoritative_source parse alone does not load service", () => {
		const modules = run(`
const path = require("path");
require(path.join(process.cwd(), "build/planner_config/authoritative_source.js"));
console.log(Object.keys(require.cache).join("\\n"));
`);
		for (const m of HEAVY) {
			assert.ok(!modules.some((e) => e.includes(m)), m);
		}
	});

	it("action_bridge alone does not load service", () => {
		const modules = run(`
const path = require("path");
require(path.join(process.cwd(), "build/planner_authority/action_bridge.js"));
console.log(Object.keys(require.cache).join("\\n"));
`);
		assert.ok(!modules.some((e) => e.includes("/build/planner_authority/service.js")));
	});
});
