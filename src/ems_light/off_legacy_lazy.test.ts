import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as path from "node:path";

const HEAVY = [
	"/build/planner_candidate/build.js",
	"/build/planner_coordinator/runtime_factory.js",
	"/build/planner_worker/",
	"/build/planner_authorization/runtime.js",
	"/build/planner_authority/runtime.js",
];

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

function assertNoHeavy(modules: string[]): void {
	for (const m of HEAVY) {
		assert.ok(!modules.some((e) => e.includes(m)), `unexpected heavy load: ${m}`);
	}
}

describe("ems_light off/legacy start path", () => {
	it("production tick loads daily plan but never shadow/authority/worker cores", () => {
		const { lines } = run(`
const tick = require(${JSON.stringify(path.join(process.cwd(), "build/ems_light/tick.js"))});
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
		assertNoHeavy(lines);
		assert.ok(
			lines.some((e) => e.includes("/build/operator/daily_plan/tick.js")),
			"daily plan tick must load on production path",
		);
	});

	it("lean ensure + five ticks + stop loads no shadow/authority/worker cores", () => {
		const { lines } = run(`
const path = require("path");
const planner = require(path.join(process.cwd(), "build/planner/index.js"));
const compose = require(path.join(process.cwd(), "build/planner_coordinator/compose.js"));
const shadow = require(path.join(process.cwd(), "build/planner_shadow/runtime.js"));
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
  objects: new Map(),
  states: new Map(),
  async setObjectNotExistsAsync(id, obj) { if (!this.objects.has(id)) this.objects.set(id, obj); },
  async getStateAsync(id) { return this.states.has(id) ? { val: this.states.get(id), ack: true } : null; },
  async setStateAsync(id, st) { const v = st && typeof st === "object" && "val" in st ? st.val : st; this.states.set(id, v); },
  async extendObjectAsync() {},
  async getForeignStateAsync() { return null; },
  async subscribeStatesAsync() {},
  async unsubscribeStatesAsync() {},
  durableDataDir: "/tmp/ems-off-legacy-proof/ems.0",
};
(async () => {
  await planner.ensurePlannerStateTree(host, { includeTakeoverStates: false, leanOperatorSurface: true });
  compose.createPlannerOnDemandCoordinatorFromAdapter(host, { enabled: false });
  await shadow.initPlannerShadowRuntime(host);
  for (let i = 0; i < 5; i++) await tick.runEmsLightPhase1Tick(host);
  await shadow.stopPlannerShadowRuntime();
  await compose.stopPlannerOnDemandCoordinator();
  console.log(Object.keys(require.cache).join("\\n"));
})();
`);
		assertNoHeavy(lines);
		assert.ok(
			lines.some((e) => e.includes("/build/operator/daily_plan/")),
			"daily plan path must load on production path",
		);
	});

	it("shadow_auto construction stays lazy until the first real coordinator run", () => {
		const { stdout } = run(`
const path = require("path");
const compose = require(path.join(process.cwd(), "build/planner_coordinator/compose.js"));
const shadow = require(path.join(process.cwd(), "build/planner_shadow/runtime.js"));
const host = {
  namespace: "ems.0",
  config: { planner_runtime_mode: "shadow_auto", planner_takeover_evaluation_mode: "disabled" },
  log: { debug(){}, info(){}, warn(){}, error(){} },
  getStateAsync: async () => null,
  setStateAsync: async () => undefined,
  setObjectNotExistsAsync: async () => undefined,
  subscribeStatesAsync: async () => undefined,
  unsubscribeStatesAsync: async () => undefined,
  durableDataDir: "/tmp/ems-shadow-auto-lazy/ems.0",
};
(async () => {
  const coordinator = compose.createPlannerOnDemandCoordinatorFromAdapter(host, { enabled: false });
  await shadow.initPlannerShadowRuntime(host);
  const afterInit = Object.keys(require.cache).join("\\n");
  console.log("AFTER_INIT");
  console.log(afterInit);
  coordinator.enable();
  await coordinator.request({ reason: "manual", requestedAt: new Date().toISOString(), force: false }).catch(() => undefined);
  const afterRun = Object.keys(require.cache).join("\\n");
  console.log("AFTER_RUN");
  console.log(afterRun);
  await shadow.stopPlannerShadowRuntime();
  await compose.stopPlannerOnDemandCoordinator();
})();
`);
		const parts = stdout.split("AFTER_RUN");
		assert.equal(parts.length, 2);
		const afterInit = parts[0].replace("AFTER_INIT", "").split("\n").filter(Boolean);
		const afterRun = parts[1].split("\n").filter(Boolean);
		assert.ok(
			!afterInit.some((e) => e.includes("/build/planner_coordinator/runtime_factory.js")),
			"runtime_factory loaded before first run",
		);
		assert.ok(
			afterRun.some((e) => e.includes("/build/planner_coordinator/runtime_factory.js")),
			"runtime_factory missing after first run",
		);
	});
});
