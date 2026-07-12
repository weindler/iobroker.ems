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
(0, node_test_1.describe)("backup_integration paths", () => {
    (0, node_test_1.it)("isolates instance 0 and 1 durable/runtime dirs", () => {
        const root = path.join(os.tmpdir(), "ems-path-test-root");
        const d0 = (0, paths_js_1.durableDataDirFromRoot)(root, 0);
        const d1 = (0, paths_js_1.durableDataDirFromRoot)(root, 1);
        const r0 = (0, paths_js_1.runtimeDataDirFromRoot)(root, 0);
        const r1 = (0, paths_js_1.runtimeDataDirFromRoot)(root, 1);
        strict_1.default.equal(d0, path.join(root, "ems.0"));
        strict_1.default.equal(d1, path.join(root, "ems.1"));
        strict_1.default.equal(r0, path.join(root, "ems-runtime.0"));
        strict_1.default.equal(r1, path.join(root, "ems-runtime.1"));
        strict_1.default.notEqual(d0, d1);
        strict_1.default.notEqual(r0, r1);
    });
    (0, node_test_1.it)("maps learning to durable and intent to runtime", () => {
        const root = path.join(os.tmpdir(), "ems-path-layout");
        const durable = path.join(root, "ems.0");
        const layout = (0, paths_js_1.resolveEmsPaths)({ namespace: "ems.0", getAbsoluteInstanceDataDir: () => durable });
        strict_1.default.equal((0, paths_js_1.categoryDataPath)(layout, "learning/house_load"), path.join(durable, "learning/house_load"));
        strict_1.default.equal((0, paths_js_1.categoryDataPath)(layout, "policy"), path.join(durable, "policy"));
        strict_1.default.equal((0, paths_js_1.categoryDataPath)(layout, "intent"), path.join(layout.runtimeDataDir, "runtime", "intent"));
        strict_1.default.equal((0, paths_js_1.categoryDataPath)(layout, "immersion_heater"), path.join(layout.runtimeDataDir, "runtime", "addons", "immersion_heater"));
    });
    (0, node_test_1.it)("uses colocated runtime for arbitrary test durable roots", () => {
        const tmp = path.join(os.tmpdir(), "ems-isolated-test-xyz");
        const layout = (0, paths_js_1.resolveEmsPaths)({ namespace: "ems.0", getAbsoluteInstanceDataDir: () => tmp });
        strict_1.default.equal(layout.runtimeDataDir, path.join(tmp, "ems-runtime.0"));
    });
    (0, node_test_1.it)("blocks path traversal in categories", () => {
        const layout = (0, paths_js_1.resolveEmsPaths)({ namespace: "ems.0", getAbsoluteInstanceDataDir: () => "/tmp/ems.0" });
        strict_1.default.throws(() => (0, paths_js_1.categoryDataPath)(layout, "../secret"));
    });
    (0, node_test_1.it)("assertPathWithinRoot accepts children only", () => {
        const root = "/tmp/ems.0/learning";
        strict_1.default.doesNotThrow(() => (0, paths_js_1.assertPathWithinRoot)("/tmp/ems.0/learning/file.json", root));
        strict_1.default.throws(() => (0, paths_js_1.assertPathWithinRoot)("/tmp/ems.0/policy/file.json", root));
    });
    (0, node_test_1.it)("parseInstanceFromNamespace", () => {
        strict_1.default.equal((0, paths_js_1.parseInstanceFromNamespace)("ems.0"), 0);
        strict_1.default.equal((0, paths_js_1.parseInstanceFromNamespace)("ems.1"), 1);
    });
});
