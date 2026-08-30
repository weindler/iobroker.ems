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
const constants_js_1 = require("../day_telemetry/constants.js");
const persist_js_1 = require("../day_telemetry/persist.js");
const test_helpers_js_1 = require("./test_helpers.js");
const constants_js_2 = require("./constants.js");
const persist_js_2 = require("./persist.js");
const run_js_1 = require("./run.js");
function makeHost(root) {
    const states = new Map();
    return {
        states,
        getAbsolutePath: (category) => path.join(root, category ?? "root"),
        setStateAsync: async (id, state) => {
            states.set(id, state.val);
        },
    };
}
async function completeDay(dateKey) {
    const day = (0, test_helpers_js_1.freshDay)(dateKey);
    day.complete = true;
    day.lastSampleIso = `${dateKey}T22:00:00.000Z`;
    return day;
}
(0, node_test_1.describe)("daily_evaluator run (Batch-Trigger)", () => {
    (0, node_test_1.it)("Backlog: mehrere unevaluierte, vollständige Tage werden chronologisch nachgearbeitet (Korrektur #11)", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "daily-evaluator-run-"));
        try {
            const telemetryDir = path.join(root, constants_js_1.DAY_TELEMETRY_CATEGORY);
            await fs.mkdir(telemetryDir, { recursive: true });
            const days = ["2026-06-13", "2026-06-14", "2026-06-15"];
            for (const dk of days) {
                await (0, persist_js_1.writeDayTelemetryDay)(telemetryDir, await completeDay(dk));
            }
            const host = makeHost(root);
            const result = await (0, run_js_1.runDailyEvaluatorBatch)(host, { now: new Date("2026-06-16T03:00:00.000Z") });
            strict_1.default.deepEqual(result.processedDateKeys, days);
            strict_1.default.deepEqual(result.errors, []);
            strict_1.default.equal(host.states.get(constants_js_2.DAILY_EVALUATOR_STATES.status), "ok");
            strict_1.default.equal(host.states.get(constants_js_2.DAILY_EVALUATOR_STATES.lastEvaluatedDateKey), "2026-06-15");
            const scoresDir = path.join(root, constants_js_2.DAILY_EVALUATOR_SCORES_CATEGORY);
            for (const dk of days) {
                const record = await (0, persist_js_2.readScoresDay)(scoresDir, dk);
                strict_1.default.equal(record?.dateKey, dk);
            }
        }
        finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)("Idempotenz: zweiter Lauf ohne neue Tage verarbeitet nichts erneut", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "daily-evaluator-run-"));
        try {
            const telemetryDir = path.join(root, constants_js_1.DAY_TELEMETRY_CATEGORY);
            await fs.mkdir(telemetryDir, { recursive: true });
            await (0, persist_js_1.writeDayTelemetryDay)(telemetryDir, await completeDay("2026-06-15"));
            const host = makeHost(root);
            const now = new Date("2026-06-16T03:00:00.000Z");
            const first = await (0, run_js_1.runDailyEvaluatorBatch)(host, { now });
            strict_1.default.deepEqual(first.processedDateKeys, ["2026-06-15"]);
            const second = await (0, run_js_1.runDailyEvaluatorBatch)(host, { now });
            strict_1.default.deepEqual(second.processedDateKeys, []);
            strict_1.default.deepEqual(second.skippedAlreadyEvaluated, ["2026-06-15"]);
        }
        finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)("unvollständiger Tag (day.complete=false) wird übersprungen statt bewertet", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "daily-evaluator-run-"));
        try {
            const telemetryDir = path.join(root, constants_js_1.DAY_TELEMETRY_CATEGORY);
            await fs.mkdir(telemetryDir, { recursive: true });
            const incompleteDay = (0, test_helpers_js_1.freshDay)("2026-06-15");
            incompleteDay.complete = false;
            await (0, persist_js_1.writeDayTelemetryDay)(telemetryDir, incompleteDay);
            const host = makeHost(root);
            const result = await (0, run_js_1.runDailyEvaluatorBatch)(host, { now: new Date("2026-06-16T03:00:00.000Z") });
            strict_1.default.deepEqual(result.processedDateKeys, []);
            strict_1.default.deepEqual(result.skippedIncomplete, ["2026-06-15"]);
        }
        finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)("heutiger/zukünftiger Tag wird nie als complete verarbeitet, auch wenn day.complete=true gesetzt ist", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "daily-evaluator-run-"));
        try {
            const telemetryDir = path.join(root, constants_js_1.DAY_TELEMETRY_CATEGORY);
            await fs.mkdir(telemetryDir, { recursive: true });
            await (0, persist_js_1.writeDayTelemetryDay)(telemetryDir, await completeDay("2026-06-16"));
            const host = makeHost(root);
            const result = await (0, run_js_1.runDailyEvaluatorBatch)(host, { now: new Date("2026-06-16T10:00:00.000Z") });
            strict_1.default.deepEqual(result.processedDateKeys, []);
            strict_1.default.deepEqual(result.skippedIncomplete, []);
            strict_1.default.deepEqual(result.errors, []);
        }
        finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)("fehlende Telemetrie-Tagesdatei (gelistet, aber nicht lesbar) landet in errors statt Abbruch des ganzen Batches", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "daily-evaluator-run-"));
        try {
            const telemetryDir = path.join(root, constants_js_1.DAY_TELEMETRY_CATEGORY);
            await fs.mkdir(telemetryDir, { recursive: true });
            await fs.writeFile(path.join(telemetryDir, "2026-06-14.json"), "not valid json {{{");
            await (0, persist_js_1.writeDayTelemetryDay)(telemetryDir, await completeDay("2026-06-15"));
            const host = makeHost(root);
            const result = await (0, run_js_1.runDailyEvaluatorBatch)(host, { now: new Date("2026-06-16T03:00:00.000Z") });
            strict_1.default.deepEqual(result.processedDateKeys, ["2026-06-15"]);
            strict_1.default.equal(result.errors.length, 1);
            strict_1.default.equal(result.errors[0].dateKey, "2026-06-14");
        }
        finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)("learning_state_v1.json wird über den Batch hinweg fortgeschrieben (lastProcessedDateKey = letzter verarbeiteter Tag)", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "daily-evaluator-run-"));
        try {
            const telemetryDir = path.join(root, constants_js_1.DAY_TELEMETRY_CATEGORY);
            await fs.mkdir(telemetryDir, { recursive: true });
            await (0, persist_js_1.writeDayTelemetryDay)(telemetryDir, await completeDay("2026-06-14"));
            await (0, persist_js_1.writeDayTelemetryDay)(telemetryDir, await completeDay("2026-06-15"));
            const host = makeHost(root);
            await (0, run_js_1.runDailyEvaluatorBatch)(host, { now: new Date("2026-06-16T03:00:00.000Z") });
            const stateDir = path.join(root, constants_js_2.DAILY_EVALUATOR_STATE_CATEGORY);
            const raw = await fs.readFile(path.join(stateDir, "learning_state_v1.json"), "utf8");
            const state = JSON.parse(raw);
            strict_1.default.equal(state.lastProcessedDateKey, "2026-06-15");
        }
        finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)("Retention: Zurückliegen älter als DAY_TELEMETRY_RETENTION_DAYS wird nicht mehr aufgeholt", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "daily-evaluator-run-"));
        try {
            const telemetryDir = path.join(root, constants_js_1.DAY_TELEMETRY_CATEGORY);
            await fs.mkdir(telemetryDir, { recursive: true });
            const now = new Date("2026-06-16T03:00:00.000Z");
            const tooOld = (0, time_js_1.addDaysToDateKey)("2026-06-16", -100);
            await (0, persist_js_1.writeDayTelemetryDay)(telemetryDir, await completeDay(tooOld));
            await (0, persist_js_1.writeDayTelemetryDay)(telemetryDir, await completeDay("2026-06-15"));
            const host = makeHost(root);
            const result = await (0, run_js_1.runDailyEvaluatorBatch)(host, { now });
            strict_1.default.deepEqual(result.processedDateKeys, ["2026-06-15"]);
        }
        finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)("force=true erlaubt Re-Evaluation, überschreibt findings/scores, lässt Learning-State standardmäßig unverändert für den Re-Run", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "daily-evaluator-run-"));
        try {
            const telemetryDir = path.join(root, constants_js_1.DAY_TELEMETRY_CATEGORY);
            await fs.mkdir(telemetryDir, { recursive: true });
            await (0, persist_js_1.writeDayTelemetryDay)(telemetryDir, await completeDay("2026-06-15"));
            const host = makeHost(root);
            const now = new Date("2026-06-16T03:00:00.000Z");
            await (0, run_js_1.runDailyEvaluatorBatch)(host, { now });
            const stateDir = path.join(root, constants_js_2.DAILY_EVALUATOR_STATE_CATEGORY);
            const before = JSON.parse(await fs.readFile(path.join(stateDir, "learning_state_v1.json"), "utf8"));
            const forced = await (0, run_js_1.runDailyEvaluatorBatch)(host, { now, force: true });
            strict_1.default.deepEqual(forced.processedDateKeys, ["2026-06-15"]);
            const after = JSON.parse(await fs.readFile(path.join(stateDir, "learning_state_v1.json"), "utf8"));
            strict_1.default.deepEqual(after, before);
        }
        finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });
});
