import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as path from "node:path";

function run(body: string): { lines: string[]; stdout: string } {
	const r = spawnSync(process.execPath, ["-e", body], {
		cwd: process.cwd(),
		encoding: "utf8",
		env: { ...process.env, NODE_OPTIONS: "" },
	});
	assert.equal(r.status, 0, r.stderr || r.stdout);
	const stdout = r.stdout.trim();
	return {
		stdout,
		lines: stdout.split("\n").filter(Boolean).map((l) => l.replace(process.cwd(), "")),
	};
}

describe("ems_light production tick", () => {
	it("loads the daily plan path without any Shadow/Takeover/Authority core (removed, Block 4)", () => {
		const { lines } = run(`
const tick = require(${JSON.stringify(path.join(process.cwd(), "build/ems_light/tick.js"))});
const host = {
  namespace: "ems.0",
  config: { global_execution_mode: "dryrun" },
  log: { debug(){}, info(){}, warn(){}, error(){} },
  getStateAsync: async () => null,
  setStateAsync: async () => undefined,
  getForeignStateAsync: async () => null,
};
(async () => {
  await tick.runEmsLightPhase1Tick(host);
  console.log(Object.keys(require.cache).join("\\n"));
})();
`);
		assert.ok(
			!lines.some((e) => e.includes("/build/planner_")),
			"legacy planner_* shadow-stack must not exist / load on the production path",
		);
		assert.ok(
			!lines.some((e) => e.includes("/build/planner/run.js")),
			"legacy runPlannerTick module must not load on the production path (Roadmap Block 4)",
		);
		assert.ok(
			lines.some((e) => e.includes("/build/operator/daily_plan/tick.js")),
			"daily plan tick must load on production path",
		);
	});
});
