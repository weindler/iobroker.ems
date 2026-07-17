"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_child_process_1 = require("node:child_process");
const HEAVY = [
    "/build/planner_authorization/service.js",
    "/build/planner_authorization/audit_io.js",
    "/build/planner_takeover/record.js",
    "/build/planner_candidate/build.js",
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
(0, node_test_1.describe)("planner_authorization lazy load", () => {
    (0, node_test_1.it)("authorization_mode parse alone does not load service", () => {
        const modules = run(`
const path = require("path");
require(path.join(process.cwd(), "build/planner_config/authorization_mode.js"));
console.log(Object.keys(require.cache).join("\\n"));
`);
        for (const m of HEAVY) {
            strict_1.default.ok(!modules.some((e) => e.includes(m)), m);
        }
    });
    (0, node_test_1.it)("action_bridge alone does not load service or audit_io", () => {
        const modules = run(`
const path = require("path");
require(path.join(process.cwd(), "build/planner_authorization/action_bridge.js"));
console.log(Object.keys(require.cache).join("\\n"));
`);
        strict_1.default.ok(!modules.some((e) => e.includes("/build/planner_authorization/service.js")));
        strict_1.default.ok(!modules.some((e) => e.includes("/build/planner_authorization/audit_io.js")));
    });
});
