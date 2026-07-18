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
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const paths_js_1 = require("../planner_paths/paths.js");
const runtime_factory_js_1 = require("./runtime_factory.js");
/** Minimal real adapter contract — no getAbsoluteInstanceDataDir. */
function minimalAdapter(namespace) {
    return {
        namespace,
        config: { planner_runtime_mode: "shadow_auto", global_execution_mode: "dryrun" },
        getStateAsync: async () => null,
    };
}
(0, node_test_1.describe)("planner_coordinator runtime_factory paths", () => {
    (0, node_test_1.it)("creates runtime from minimal adapter without getAbsoluteInstanceDataDir", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "ems-runtime-factory-"));
        const durable = path.join(root, "ems.0");
        const adapter = minimalAdapter("ems.0");
        strict_1.default.equal(typeof adapter.getAbsoluteInstanceDataDir, "undefined");
        const ctx = (0, runtime_factory_js_1.createPlannerRuntimeContext)(adapter, { paths: durable });
        strict_1.default.equal(ctx.durableDataDir, durable);
        strict_1.default.equal(ctx.runtimeDataDir, path.join(root, "ems-runtime.0"));
        strict_1.default.equal(ctx.runtimeJobsDir, path.join(root, "ems-runtime.0", "planner", "jobs"));
        strict_1.default.doesNotThrow(() => (0, paths_js_1.assertJobPathNotUnderDurableDataFolder)(path.join(ctx.runtimeJobsDir, "job-1"), ctx.durableDataDir));
        strict_1.default.ok(typeof ctx.deps.buildSnapshot === "function");
        fs.rmSync(root, { recursive: true, force: true });
    });
    (0, node_test_1.it)("resolves distinct durable/runtime dirs for instance 0 and 1", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "ems-runtime-inst-"));
        const ctx0 = (0, runtime_factory_js_1.createPlannerRuntimeContext)(minimalAdapter("ems.0"), {
            paths: path.join(root, "ems.0"),
        });
        const ctx1 = (0, runtime_factory_js_1.createPlannerRuntimeContext)(minimalAdapter("ems.1"), {
            paths: path.join(root, "ems.1"),
        });
        strict_1.default.equal(ctx0.durableDataDir, path.join(root, "ems.0"));
        strict_1.default.equal(ctx1.durableDataDir, path.join(root, "ems.1"));
        strict_1.default.equal(ctx0.runtimeDataDir, path.join(root, "ems-runtime.0"));
        strict_1.default.equal(ctx1.runtimeDataDir, path.join(root, "ems-runtime.1"));
        strict_1.default.notEqual(ctx0.runtimeJobsDir, ctx1.runtimeJobsDir);
        strict_1.default.ok(!ctx0.runtimeJobsDir.startsWith(ctx0.durableDataDir + path.sep));
        strict_1.default.ok(!ctx1.runtimeJobsDir.startsWith(ctx1.durableDataDir + path.sep));
        fs.rmSync(root, { recursive: true, force: true });
    });
    (0, node_test_1.it)("accepts host durableDataDir path contract without adapter method", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "ems-runtime-inject-"));
        const durable = path.join(root, "ems.0");
        const adapter = {
            ...minimalAdapter("ems.0"),
            durableDataDir: durable,
        };
        const ctx = (0, runtime_factory_js_1.createPlannerRuntimeContext)(adapter);
        strict_1.default.equal(ctx.durableDataDir, durable);
        strict_1.default.equal(ctx.runtimeDataDir, path.join(root, "ems-runtime.0"));
        strict_1.default.doesNotThrow(() => (0, paths_js_1.assertJobPathNotUnderDurableDataFolder)(path.join(ctx.runtimeJobsDir, "x"), durable));
        fs.rmSync(root, { recursive: true, force: true });
    });
    (0, node_test_1.it)("keeps factory job layout under runtime, not durable", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "ems-runtime-trav-"));
        const durable = path.join(root, "ems.0");
        const ctx = (0, runtime_factory_js_1.createPlannerRuntimeContext)(minimalAdapter("ems.0"), { paths: durable });
        strict_1.default.ok(ctx.runtimeJobsDir.includes(`${path.sep}ems-runtime.0${path.sep}`));
        strict_1.default.ok(!ctx.runtimeJobsDir.startsWith(durable + path.sep));
        strict_1.default.throws(() => (0, paths_js_1.assertJobPathNotUnderDurableDataFolder)(path.join(durable, "planner", "jobs", "x"), durable));
        fs.rmSync(root, { recursive: true, force: true });
    });
    (0, node_test_1.it)("buildSnapshot progresses past path resolution (no runtime_import_failed)", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "ems-runtime-snap-"));
        const durable = path.join(root, "ems.0");
        fs.mkdirSync(path.join(durable, "learning", "house_load"), { recursive: true });
        const adapter = minimalAdapter("ems.0");
        const ctx = (0, runtime_factory_js_1.createPlannerRuntimeContext)(adapter, { paths: durable });
        try {
            await ctx.deps.buildSnapshot();
        }
        catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            strict_1.default.ok(!message.includes("getAbsoluteInstanceDataDir"), `unexpected adapter method error: ${message}`);
            strict_1.default.ok(!message.includes("runtime_import_failed"), `unexpected import stage: ${message}`);
        }
        fs.rmSync(root, { recursive: true, force: true });
    });
});
