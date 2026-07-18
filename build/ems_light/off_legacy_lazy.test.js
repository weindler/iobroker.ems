"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_child_process_1 = require("node:child_process");
const path = __importStar(require("node:path"));
const HEAVY = [
    "/build/operator/forecast/tick.js",
    "/build/operator/forecast/build.js",
    "/build/operator/daily_plan/tick.js",
    "/build/operator/daily_plan/allocation.js",
    "/build/planner_candidate/build.js",
    "/build/planner_coordinator/runtime_factory.js",
    "/build/planner_worker/",
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
    const stdout = r.stdout.trim();
    return {
        stdout,
        lines: stdout.split("\n").filter(Boolean).map((l) => l.replace(process.cwd(), "")),
    };
}
function assertNoHeavy(modules) {
    for (const m of HEAVY) {
        strict_1.default.ok(!modules.some((e) => e.includes(m)), `unexpected heavy load: ${m}`);
    }
}
(0, node_test_1.describe)("ems_light off/legacy start path", () => {
    (0, node_test_1.it)("off tick never loads forecast, daily plan or allocation cores", () => {
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
    });
    (0, node_test_1.it)("off ensure + five ticks + stop loads no forecast/daily/candidate/authority/worker cores", () => {
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
  await planner.ensurePlannerStateTree(host, { includeTakeoverStates: false });
  compose.createPlannerOnDemandCoordinatorFromAdapter(host, { enabled: false });
  await shadow.initPlannerShadowRuntime(host);
  for (let i = 0; i < 5; i++) await tick.runEmsLightPhase1Tick(host);
  await shadow.stopPlannerShadowRuntime();
  await compose.stopPlannerOnDemandCoordinator();
  console.log(Object.keys(require.cache).join("\\n"));
})();
`);
        assertNoHeavy(lines);
    });
    (0, node_test_1.it)("shadow_auto construction stays lazy until the first real coordinator run", () => {
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
        strict_1.default.equal(parts.length, 2);
        const afterInit = parts[0].replace("AFTER_INIT", "").split("\n").filter(Boolean);
        const afterRun = parts[1].split("\n").filter(Boolean);
        strict_1.default.ok(!afterInit.some((e) => e.includes("/build/planner_coordinator/runtime_factory.js")), "runtime_factory loaded before first run");
        strict_1.default.ok(afterRun.some((e) => e.includes("/build/planner_coordinator/runtime_factory.js")), "runtime_factory missing after first run");
    });
});
