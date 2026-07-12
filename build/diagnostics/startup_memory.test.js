"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const init_guard_js_1 = require("./init_guard.js");
const memory_inventory_js_1 = require("./memory_inventory.js");
const startup_memory_js_1 = require("./startup_memory.js");
const engine_js_1 = require("../policy/engine.js");
(0, node_test_1.describe)("startup memory diagnostics", () => {
    (0, node_test_1.afterEach)(() => {
        (0, startup_memory_js_1.clearPostReadyMemoryProbesForTest)();
        (0, startup_memory_js_1.resetStartupMemoryDiagnosticsForTest)();
        (0, init_guard_js_1.resetModuleInitGuardForTest)();
        (0, memory_inventory_js_1.resetMemoryInventoryForTest)();
        (0, engine_js_1.resetPolicyEngineMemoryDiagnosticsForTest)();
        (0, engine_js_1.stopPolicyEngine)();
    });
    (0, node_test_1.it)("does not keep permanent intervals and unrefs delayed probes", () => {
        (0, startup_memory_js_1.schedulePostReadyMemoryProbes)(undefined);
        strict_1.default.equal((0, startup_memory_js_1.getDelayedProbeTimerCountForTest)(), 2);
        strict_1.default.deepEqual((0, startup_memory_js_1.getDelayedProbeTimersUnrefForTest)(), [true, true]);
        (0, startup_memory_js_1.clearPostReadyMemoryProbesForTest)();
        strict_1.default.equal((0, startup_memory_js_1.getDelayedProbeTimerCountForTest)(), 0);
    });
    (0, node_test_1.it)("detects duplicate module initialization", () => {
        strict_1.default.equal((0, init_guard_js_1.markModuleInit)("learning_runtime").duplicate, false);
        strict_1.default.equal((0, init_guard_js_1.markModuleInit)("learning_runtime").duplicate, true);
        strict_1.default.equal((0, init_guard_js_1.getDuplicateModuleInits)().length, 1);
    });
    (0, node_test_1.it)("records history inventory without retaining raw rows", () => {
        (0, memory_inventory_js_1.recordHistoryFetchInventory)("house_load", 1200, { queryKind: "lookback", daysOrSlots: 14 });
        const report = (0, startup_memory_js_1.buildMemoryDiagnosticReport)();
        strict_1.default.ok(report.inventoryModules.includes("house_load"));
    });
    (0, node_test_1.it)("flags duplicate policy startup init marks without requiring a second engine run", () => {
        strict_1.default.equal((0, init_guard_js_1.markModuleInit)("policy_engine_startup").duplicate, false);
        strict_1.default.equal((0, init_guard_js_1.markModuleInit)("policy_engine_startup").duplicate, true);
    });
    (0, node_test_1.it)("records startup checkpoints for report", () => {
        (0, startup_memory_js_1.probeStartupMemory)(undefined, "onready_start");
        (0, startup_memory_js_1.probeStartupMemory)(undefined, "after_backup_integration");
        const report = (0, startup_memory_js_1.buildMemoryDiagnosticReport)();
        strict_1.default.equal(report.checkpoints.length, 2);
        strict_1.default.equal(report.checkpoints[0].checkpoint, "onready_start");
    });
});
