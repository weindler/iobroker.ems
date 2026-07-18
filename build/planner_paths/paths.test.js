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
const path = __importStar(require("node:path"));
const os = __importStar(require("node:os"));
const paths_js_1 = require("./paths.js");
const paths_js_2 = require("../backup_integration/paths.js");
const constants_js_1 = require("./constants.js");
(0, node_test_1.describe)("planner_paths", () => {
    (0, node_test_1.it)("separates durable canonical plans from runtime job dirs", () => {
        const root = path.join(os.tmpdir(), `ems-planner-paths-${Date.now()}`);
        const durable = (0, paths_js_2.durableDataDirFromRoot)(root, 0);
        const layout = (0, paths_js_1.resolvePlannerPaths)(durable);
        strict_1.default.equal(layout.canonicalForecastPlanPath, path.join(durable, "planner", constants_js_1.CANONICAL_FORECAST_PLAN_FILE));
        strict_1.default.equal(layout.canonicalDailyPlanPath, path.join(durable, "planner", constants_js_1.CANONICAL_DAILY_PLAN_FILE));
        strict_1.default.equal(layout.runtimePlannerDir, path.join((0, paths_js_2.runtimeDataDirFromRoot)(root, 0), "planner"));
        strict_1.default.equal(layout.jobDir("job-1"), path.join(layout.runtimeJobsDir, "job-1"));
        strict_1.default.equal(layout.simulationDir("sim-1"), path.join(layout.runtimeSimulationsDir, "sim-1"));
    });
    (0, node_test_1.it)("keeps job files outside durable dataFolder for instance 0 and 1", () => {
        const root = path.join(os.tmpdir(), `ems-planner-outside-${Date.now()}`);
        for (const instance of [0, 1]) {
            const durable = (0, paths_js_2.durableDataDirFromRoot)(root, instance);
            const layout = (0, paths_js_1.resolvePlannerPaths)(durable);
            const jobDir = layout.jobDir(`test-job-${instance}`);
            strict_1.default.equal(layout.runtimePlannerDir, path.join((0, paths_js_2.runtimeDataDirFromRoot)(root, instance), "planner"));
            strict_1.default.doesNotThrow(() => (0, paths_js_1.assertJobPathNotUnderDurableDataFolder)(jobDir, durable));
            strict_1.default.throws(() => (0, paths_js_1.assertJobPathNotUnderDurableDataFolder)(path.join(durable, "planner", "jobs", "x"), durable));
        }
    });
    (0, node_test_1.it)("rejects path traversal in job ids", () => {
        const durable = path.join(os.tmpdir(), "ems.0");
        const layout = (0, paths_js_1.resolvePlannerPaths)(durable);
        strict_1.default.throws(() => layout.jobDir("../evil"));
    });
    (0, node_test_1.it)("rejects invalid instance folder names via string path basename", () => {
        const layout = (0, paths_js_1.resolvePlannerPaths)(path.join(os.tmpdir(), "not-an-ems-instance"));
        // basename is not ems.N → namespace defaults to ems.0; runtime still colocated under parent.
        strict_1.default.ok(layout.runtimeJobsDir.includes("ems-runtime.0"));
    });
});
