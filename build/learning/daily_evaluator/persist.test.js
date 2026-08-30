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
const time_js_1 = require("../../operator/time.js");
const test_helpers_js_1 = require("./test_helpers.js");
const persist_js_1 = require("./persist.js");
const types_js_1 = require("./types.js");
function baseRecord(dateKey) {
    return {
        evaluatorSchemaVersion: 1,
        sourceTelemetrySchemaVersion: 1,
        sourceUpdatedAtIso: `${dateKey}T23:00:00.000Z`,
        dateKey,
        timezone: "Europe/Berlin",
        evaluatedAtIso: `${dateKey}T23:30:00.000Z`,
        dayComplete: true,
        dayEvaluable: true,
        dayCoveragePct: 100,
        eligibility: [],
        findingsCount: 0,
        findingsByDomain: { battery: 0, thermal: 0, climate: 0, ev: 0 },
        scores: [],
        globalScore: null,
        globalScoreWeights: {},
    };
}
async function withTempDirs(fn) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "daily-evaluator-"));
    try {
        const findingsDir = path.join(root, "findings");
        const scoresDir = path.join(root, "scores");
        await fs.mkdir(findingsDir, { recursive: true });
        await fs.mkdir(scoresDir, { recursive: true });
        return await fn(findingsDir, scoresDir, root);
    }
    finally {
        await fs.rm(root, { recursive: true, force: true });
    }
}
(0, node_test_1.describe)("daily_evaluator persist", () => {
    (0, node_test_1.it)("findings/scores atomic write roundtrip", async () => {
        await withTempDirs(async (findingsDir, scoresDir) => {
            const findings = [(0, test_helpers_js_1.makeFinding)({ dateKey: "2026-06-15" })];
            await (0, persist_js_1.writeFindingsDay)(findingsDir, "2026-06-15", findings);
            const loadedFindings = await (0, persist_js_1.readFindingsDay)(findingsDir, "2026-06-15");
            strict_1.default.equal(loadedFindings?.length, 1);
            strict_1.default.equal(loadedFindings?.[0].id, findings[0].id);
            const record = baseRecord("2026-06-15");
            await (0, persist_js_1.writeScoresDay)(scoresDir, record);
            const loadedRecord = await (0, persist_js_1.readScoresDay)(scoresDir, "2026-06-15");
            strict_1.default.equal(loadedRecord?.dateKey, "2026-06-15");
            strict_1.default.equal(loadedRecord?.evaluatorSchemaVersion, 1);
        });
    });
    (0, node_test_1.it)("readFindingsDay/readScoresDay: nicht vorhandener Tag → null (kein Fehler)", async () => {
        await withTempDirs(async (findingsDir, scoresDir) => {
            strict_1.default.equal(await (0, persist_js_1.readFindingsDay)(findingsDir, "2026-06-15"), null);
            strict_1.default.equal(await (0, persist_js_1.readScoresDay)(scoresDir, "2026-06-15"), null);
        });
    });
    (0, node_test_1.it)("pruneDailyEvaluatorFiles: 91 Tage → ältester wird entfernt, Retention 90", async () => {
        await withTempDirs(async (findingsDir, scoresDir) => {
            const start = "2026-01-01";
            for (let i = 0; i < 91; i++) {
                const dk = (0, time_js_1.addDaysToDateKey)(start, i);
                await (0, persist_js_1.writeFindingsDay)(findingsDir, dk, []);
                await (0, persist_js_1.writeScoresDay)(scoresDir, baseRecord(dk));
            }
            const today = (0, time_js_1.addDaysToDateKey)(start, 90);
            const { removedFindings, removedScores } = await (0, persist_js_1.pruneDailyEvaluatorFiles)(findingsDir, scoresDir, today, 90);
            strict_1.default.deepEqual(removedFindings, [start]);
            strict_1.default.deepEqual(removedScores, [start]);
            const remaining = await (0, persist_js_1.listEvaluatedDateKeys)(scoresDir);
            strict_1.default.equal(remaining.size, 90);
            strict_1.default.ok(!remaining.has(start));
            strict_1.default.ok(remaining.has(today));
        });
    });
    (0, node_test_1.it)("pruneDailyEvaluatorFiles: unter Retention-Grenze → keine Löschung", async () => {
        await withTempDirs(async (findingsDir, scoresDir) => {
            await (0, persist_js_1.writeFindingsDay)(findingsDir, "2026-06-15", []);
            await (0, persist_js_1.writeScoresDay)(scoresDir, baseRecord("2026-06-15"));
            const { removedFindings, removedScores } = await (0, persist_js_1.pruneDailyEvaluatorFiles)(findingsDir, scoresDir, "2026-06-15", 90);
            strict_1.default.deepEqual(removedFindings, []);
            strict_1.default.deepEqual(removedScores, []);
        });
    });
    (0, node_test_1.it)("listEvaluatedDateKeys: liefert nur tatsächlich vorhandene YYYY-MM-DD Score-Dateien", async () => {
        await withTempDirs(async (findingsDir, scoresDir) => {
            await (0, persist_js_1.writeScoresDay)(scoresDir, baseRecord("2026-06-14"));
            await (0, persist_js_1.writeScoresDay)(scoresDir, baseRecord("2026-06-15"));
            const keys = await (0, persist_js_1.listEvaluatedDateKeys)(scoresDir);
            strict_1.default.deepEqual([...keys].sort(), ["2026-06-14", "2026-06-15"]);
        });
    });
    (0, node_test_1.it)("learning_state_v1.json: fehlende Datei → emptyDailyEvaluatorLearningState (kein Fehler)", async () => {
        await withTempDirs(async (_findingsDir, _scoresDir, learningDir) => {
            const state = await (0, persist_js_1.loadDailyEvaluatorLearningState)(learningDir);
            strict_1.default.deepEqual(state, { ...(0, types_js_1.emptyDailyEvaluatorLearningState)(), updatedAtIso: state.updatedAtIso });
            strict_1.default.equal(state.lastProcessedDateKey, null);
        });
    });
    (0, node_test_1.it)("learning_state_v1.json: write/load roundtrip, restorewürdig unter fixem Dateinamen", async () => {
        await withTempDirs(async (_findingsDir, _scoresDir, learningDir) => {
            const state = (0, types_js_1.emptyDailyEvaluatorLearningState)();
            state.lastProcessedDateKey = "2026-06-15";
            await (0, persist_js_1.writeDailyEvaluatorLearningState)(learningDir, state);
            const filePath = (0, persist_js_1.learningStatePath)(learningDir);
            strict_1.default.equal(path.basename(filePath), "learning_state_v1.json");
            const loaded = await (0, persist_js_1.loadDailyEvaluatorLearningState)(learningDir);
            strict_1.default.equal(loaded.lastProcessedDateKey, "2026-06-15");
            strict_1.default.equal(loaded.module, "daily_evaluator");
        });
    });
    (0, node_test_1.it)("normalizeLearningState: Fremd-JSON ohne module-Feld wird verworfen → empty state statt Fehlinterpretation", async () => {
        await withTempDirs(async (_findingsDir, _scoresDir, learningDir) => {
            await fs.writeFile((0, persist_js_1.learningStatePath)(learningDir), JSON.stringify({ foo: "bar" }));
            const loaded = await (0, persist_js_1.loadDailyEvaluatorLearningState)(learningDir);
            strict_1.default.equal(loaded.lastProcessedDateKey, null);
            strict_1.default.equal(loaded.module, "daily_evaluator");
        });
    });
});
