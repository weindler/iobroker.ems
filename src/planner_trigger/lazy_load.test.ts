import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as path from "node:path";

const HEAVY = [
	"/build/planner_coordinator/runtime_factory.js",
	"/build/planner_worker/",
	"/build/planner_preparation/prepare.js",
	"/build/planner_candidate/build.js",
	"/build/planner_snapshot/from_iobroker.js",
	"/build/planner_takeover/record.js",
	"/build/planner_takeover/dual_run_bridge.js",
	"/build/planner_takeover/evidence_io.js",
	"/build/operator/forecast/tick.js",
	"/build/operator/forecast/build.js",
	"/build/operator/daily_plan/tick.js",
	"/build/operator/daily_plan/allocation.js",
	"/build/planner_authorization/runtime.js",
	"/build/planner_authority/runtime.js",
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

describe("planner_trigger lazy load", () => {
	it("trigger module alone does not load heavy planner cores", () => {
		const modules = run(`
const path = require("path");
require(path.join(process.cwd(), "build/planner_trigger/index.js"));
console.log(Object.keys(require.cache).join("\\n"));
`);
		for (const m of HEAVY) {
			assert.ok(!modules.some((e) => e.includes(m)), m);
		}
	});

	it("off mode shadow init does not load heavy modules", () => {
		const modules = run(`
const path = require("path");
const compose = require(path.join(process.cwd(), "build/planner_coordinator/compose.js"));
const shadow = require(path.join(process.cwd(), "build/planner_shadow/runtime.js"));
const host = {
  namespace: "ems.0",
  config: { planner_runtime_mode: "off" },
  log: { debug(){}, info(){}, warn(){}, error(){} },
  getStateAsync: async () => null,
  setStateAsync: async () => undefined,
  setObjectNotExistsAsync: async () => undefined,
  subscribeStatesAsync: async () => undefined,
  unsubscribeStatesAsync: async () => undefined,
};
compose.createPlannerOnDemandCoordinatorFromAdapter({
  namespace: "ems.0",
  getAbsoluteInstanceDataDir: () => "/tmp/ems-3e-lazy",
  getStateAsync: async () => null,
  config: { planner_runtime_mode: "off" },
}, { enabled: false });
(async () => {
  await shadow.initPlannerShadowRuntime(host);
  console.log(Object.keys(require.cache).join("\\n"));
  await shadow.stopPlannerShadowRuntime();
  await compose.stopPlannerOnDemandCoordinator();
})();
`);
		for (const m of HEAVY) {
			assert.ok(!modules.some((e) => e.includes(m)), m);
		}
	});

	it("off/legacy ems_light tick does not load forecast or allocation cores", () => {
		const modules = run(`
const path = require("path");
const tick = require(path.join(process.cwd(), "build/ems_light/tick.js"));
const host = {
  namespace: "ems.0",
  config: {
    planner_runtime_mode: "off",
    planner_takeover_evaluation_mode: "disabled",
    planner_takeover_authorization_mode: "disabled",
    planner_authoritative_source: "legacy",
    global_execution_mode: "dryrun",
  },
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
		for (const m of [
			"/build/operator/forecast/tick.js",
			"/build/operator/forecast/build.js",
			"/build/operator/daily_plan/tick.js",
			"/build/operator/daily_plan/allocation.js",
			"/build/planner_coordinator/runtime_factory.js",
			"/build/planner_worker/",
			"/build/planner_candidate/build.js",
		]) {
			assert.ok(!modules.some((e) => e.includes(m)), m);
		}
	});
});
