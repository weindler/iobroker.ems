import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { resetModuleInitGuardForTest, markModuleInit, getDuplicateModuleInits } from "./init_guard.js";
import { resetMemoryInventoryForTest, recordHistoryFetchInventory } from "./memory_inventory.js";
import {
	clearPostReadyMemoryProbesForTest,
	getDelayedProbeTimerCountForTest,
	getDelayedProbeTimersUnrefForTest,
	probeStartupMemory,
	resetStartupMemoryDiagnosticsForTest,
	schedulePostReadyMemoryProbes,
	buildMemoryDiagnosticReport,
} from "./startup_memory.js";
import { resetPolicyEngineMemoryDiagnosticsForTest, stopPolicyEngine } from "../policy/engine.js";

describe("startup memory diagnostics", () => {
	afterEach(() => {
		clearPostReadyMemoryProbesForTest();
		resetStartupMemoryDiagnosticsForTest();
		resetModuleInitGuardForTest();
		resetMemoryInventoryForTest();
		resetPolicyEngineMemoryDiagnosticsForTest();
		stopPolicyEngine();
	});

	it("does not keep permanent intervals and unrefs delayed probes", () => {
		schedulePostReadyMemoryProbes(undefined);
		assert.equal(getDelayedProbeTimerCountForTest(), 2);
		assert.deepEqual(getDelayedProbeTimersUnrefForTest(), [true, true]);
		clearPostReadyMemoryProbesForTest();
		assert.equal(getDelayedProbeTimerCountForTest(), 0);
	});

	it("detects duplicate module initialization", () => {
		assert.equal(markModuleInit("learning_runtime").duplicate, false);
		assert.equal(markModuleInit("learning_runtime").duplicate, true);
		assert.equal(getDuplicateModuleInits().length, 1);
	});

	it("records history inventory without retaining raw rows", () => {
		recordHistoryFetchInventory("house_load", 1200, { queryKind: "lookback", daysOrSlots: 14 });
		const report = buildMemoryDiagnosticReport();
		assert.ok(report.inventoryModules.includes("house_load"));
	});

	it("flags duplicate policy startup init marks without requiring a second engine run", () => {
		assert.equal(markModuleInit("policy_engine_startup").duplicate, false);
		assert.equal(markModuleInit("policy_engine_startup").duplicate, true);
	});

	it("records startup checkpoints for report", () => {
		probeStartupMemory(undefined, "onready_start");
		probeStartupMemory(undefined, "after_backup_integration");
		const report = buildMemoryDiagnosticReport();
		assert.equal(report.checkpoints.length, 2);
		assert.equal(report.checkpoints[0].checkpoint, "onready_start");
	});
});
