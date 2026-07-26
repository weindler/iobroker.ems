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
(0, node_test_1.describe)("ems_light production tick", () => {
    (0, node_test_1.it)("loads the daily plan path without any Shadow/Takeover/Authority core (removed, Block 4)", () => {
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
        strict_1.default.ok(!lines.some((e) => e.includes("/build/planner_")), "legacy planner_* shadow-stack must not exist / load on the production path");
        strict_1.default.ok(!lines.some((e) => e.includes("/build/planner/run.js")), "legacy runPlannerTick module must not load on the production path (Roadmap Block 4)");
        strict_1.default.ok(lines.some((e) => e.includes("/build/operator/daily_plan/tick.js")), "daily plan tick must load on production path");
    });
});
