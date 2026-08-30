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
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const block_a_learning_bridge_js_1 = require("./block_a_learning_bridge.js");
const persist_js_1 = require("../../learning/daily_evaluator/persist.js");
const types_js_1 = require("../../learning/daily_evaluator/types.js");
async function withTempDir(fn) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "block-a-bridge-"));
    try {
        return await fn(dir);
    }
    finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}
(0, node_test_1.describe)("Block B - Block-A-Learning-Bridge (read-only)", () => {
    (0, node_test_1.it)("Host ohne getAbsolutePath -> leerer Snapshot, kein Crash", async () => {
        const snapshot = await (0, block_a_learning_bridge_js_1.loadBlockALearningSnapshot)({});
        strict_1.default.equal(snapshot.thermalPriceTimingScore.value, null);
        strict_1.default.equal(snapshot.batteryReserveAccuracyPct.value, null);
        strict_1.default.equal(snapshot.updatedAtIso, null);
    });
    (0, node_test_1.it)("fehlende learning_state_v1.json -> leerer Snapshot, kein Crash", async () => {
        await withTempDir(async (dir) => {
            const snapshot = await (0, block_a_learning_bridge_js_1.loadBlockALearningSnapshot)({ getAbsolutePath: () => dir });
            strict_1.default.equal(snapshot.thermalPriceTimingScore.value, null);
            strict_1.default.equal(snapshot.batteryReserveAccuracyPct.value, null);
        });
    });
    (0, node_test_1.it)("beschaedigte learning_state_v1.json -> leerer Snapshot (Fallback), kein Crash", async () => {
        await withTempDir(async (dir) => {
            await fs.writeFile((0, persist_js_1.learningStatePath)(dir), "{not valid json");
            const snapshot = await (0, block_a_learning_bridge_js_1.loadBlockALearningSnapshot)({ getAbsolutePath: () => dir });
            strict_1.default.equal(snapshot.thermalPriceTimingScore.value, null);
            strict_1.default.equal(snapshot.batteryReserveAccuracyPct.value, null);
        });
    });
    (0, node_test_1.it)("gueltiger Block-A-State -> thermalPriceTimingScore + batteryReserveAccuracyPct 1:1 uebernommen", async () => {
        await withTempDir(async (dir) => {
            const state = (0, types_js_1.emptyDailyEvaluatorLearningState)();
            state.thermalPriceTimingScore = {
                ...(0, types_js_1.emptyLearningMetric)(),
                value: 72,
                sampleCount: 40,
                confidence: 85,
                updatedAtIso: "2026-06-15T23:00:00.000Z",
            };
            state.batteryReserveAccuracyPct = {
                ...(0, types_js_1.emptyLearningMetric)(),
                value: 33,
                sampleCount: 20,
                confidence: 60,
                updatedAtIso: "2026-06-15T23:00:00.000Z",
            };
            await (0, persist_js_1.writeDailyEvaluatorLearningState)(dir, state);
            const snapshot = await (0, block_a_learning_bridge_js_1.loadBlockALearningSnapshot)({ getAbsolutePath: () => dir });
            strict_1.default.deepEqual(snapshot.thermalPriceTimingScore, {
                value: 72,
                sampleCount: 40,
                confidencePct: 85,
            });
            strict_1.default.deepEqual(snapshot.batteryReserveAccuracyPct, {
                value: 33,
                sampleCount: 20,
                confidencePct: 60,
            });
            strict_1.default.equal(snapshot.updatedAtIso, state.updatedAtIso);
        });
    });
    (0, node_test_1.it)("Bridge schreibt niemals in den Block-A-State (rein lesend)", async () => {
        await withTempDir(async (dir) => {
            await (0, block_a_learning_bridge_js_1.loadBlockALearningSnapshot)({ getAbsolutePath: () => dir });
            await strict_1.default.rejects(fs.access((0, persist_js_1.learningStatePath)(dir)));
        });
    });
});
