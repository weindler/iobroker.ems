"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const import_graph_js_1 = require("../test_support/import_graph.js");
(0, node_test_1.describe)("planner_preparation import boundaries", () => {
    (0, node_test_1.it)("does not transitively import operator modules", () => {
        strict_1.default.doesNotThrow(() => (0, import_graph_js_1.assertNoForbiddenImportRoots)(["planner_preparation/prepare.ts", "planner_preparation/validate.ts"], ["operator"]));
    });
    (0, node_test_1.it)("imports neutral grid_supply core", () => {
        const files = (0, import_graph_js_1.collectTransitiveRelativeImports)("planner_preparation/prepare.ts");
        strict_1.default.ok(files.some((f) => f.includes("/grid_supply/forecast.ts")));
    });
});
(0, node_test_1.describe)("planner_worker import boundaries", () => {
    (0, node_test_1.it)("does not transitively import operator modules", () => {
        strict_1.default.doesNotThrow(() => (0, import_graph_js_1.assertNoForbiddenImportRoots)(["planner_worker/worker_job.ts", "planner_worker/main.ts"], ["operator"]));
    });
});
