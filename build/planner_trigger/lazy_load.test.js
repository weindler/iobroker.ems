"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_child_process_1 = require("node:child_process");
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
function run(body) {
    const r = (0, node_child_process_1.spawnSync)(process.execPath, ["-e", body], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, NODE_OPTIONS: "" },
    });
    strict_1.default.equal(r.status, 0, r.stderr || r.stdout);
    return r.stdout.trim().split("\n").filter(Boolean).map((l) => l.replace(process.cwd(), ""));
}
(0, node_test_1.describe)("planner_trigger lazy load", () => {
    (0, node_test_1.it)("trigger module alone does not load heavy planner cores", () => {
        const modules = run(`
const path = require("path");
require(path.join(process.cwd(), "build/planner_trigger/index.js"));
console.log(Object.keys(require.cache).join("\\n"));
`);
        for (const m of HEAVY) {
            strict_1.default.ok(!modules.some((e) => e.includes(m)), m);
        }
    });
    (0, node_test_1.it)("off mode shadow init does not load heavy modules", () => {
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
  durableDataDir: "/tmp/ems-3e-lazy/ems.0",
};
compose.createPlannerOnDemandCoordinatorFromAdapter({
  namespace: "ems.0",
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
            strict_1.default.ok(!modules.some((e) => e.includes(m)), m);
        }
    });
    (0, node_test_1.it)("ems_light tick loads daily plan but not shadow/worker cores", () => {
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
        strict_1.default.ok(modules.some((e) => e.includes("/build/operator/daily_plan/tick.js")), "daily plan tick must load");
        for (const m of [
            "/build/planner_coordinator/runtime_factory.js",
            "/build/planner_worker/",
            "/build/planner_candidate/build.js",
            "/build/planner_authorization/runtime.js",
            "/build/planner_authority/runtime.js",
        ]) {
            strict_1.default.ok(!modules.some((e) => e.includes(m)), m);
        }
    });
});
