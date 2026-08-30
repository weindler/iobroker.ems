"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const test_helpers_js_1 = require("./test_helpers.js");
const evaluate_js_1 = require("./evaluate.js");
const quality_mask_js_1 = require("../day_telemetry/quality_mask.js");
(0, node_test_1.describe)("daily_evaluator evaluate (Orchestrator)", () => {
    (0, node_test_1.it)("leerer Tag ohne jede Evidenz → alle 4 Domänen not_applicable, keine erfundenen Scores", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        const { record, findings } = (0, evaluate_js_1.evaluateDay)({
            day,
            nextDay: null,
            sourceUpdatedAtIso: "2026-06-15T22:00:00.000Z",
            sourceTelemetrySchemaVersion: 2,
            evaluatedAtIso: "2026-06-16T03:00:00.000Z",
        });
        strict_1.default.equal(record.evaluatorSchemaVersion, 1);
        strict_1.default.equal(record.sourceTelemetrySchemaVersion, 2);
        strict_1.default.equal(record.sourceUpdatedAtIso, "2026-06-15T22:00:00.000Z");
        strict_1.default.equal(record.dateKey, "2026-06-15");
        strict_1.default.equal(record.eligibility.length, 4);
        strict_1.default.ok(record.eligibility.every((e) => e.status === "not_applicable"));
        strict_1.default.equal(findings.length, 4);
        strict_1.default.ok(findings.every((f) => f.notApplicable === true));
        strict_1.default.equal(record.findingsCount, 4);
        strict_1.default.equal(record.globalScore, null);
        strict_1.default.deepEqual(record.globalScoreWeights, {});
    });
    (0, node_test_1.it)("Battery evaluable + reserve_held → genau ein Battery-Finding, andere Domänen bleiben not_applicable", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        day.forecastSnapshots.push((0, test_helpers_js_1.makeSnapshot)({
            tsIso: "2026-06-15T18:00:00.000Z",
            batterySocPct: 40,
            batteryDecision: {
                action: "discharge_allowed",
                dischargeAllowed: true,
                requiredSocAtPvEndPct: 30,
                holdActive: false,
                reasonCode: "price_and_reserve_ok",
            },
        }));
        for (let ms = Date.parse("2026-06-15T18:00:00.000Z"); ms < Date.parse("2026-06-15T22:00:00.000Z"); ms += 15 * 60_000) {
            const idx = Math.floor((ms - day.startMs) / (15 * 60_000));
            day.buckets.batterySocEndPct[idx] = 40;
        }
        const batteryOkMask = (0, quality_mask_js_1.encodeQualityMask)({ BATTERY: quality_mask_js_1.DOMAIN_QUALITY.ok });
        for (let i = 0; i < day.buckets.qualityMask.length; i++)
            day.buckets.qualityMask[i] = batteryOkMask;
        const { record, findings } = (0, evaluate_js_1.evaluateDay)({
            day,
            nextDay: null,
            sourceUpdatedAtIso: "2026-06-15T22:00:00.000Z",
            sourceTelemetrySchemaVersion: 2,
        });
        const batteryElig = record.eligibility.find((e) => e.domain === "battery");
        strict_1.default.equal(batteryElig.status, "evaluable");
        const batteryFindings = findings.filter((f) => f.domain === "battery");
        strict_1.default.equal(batteryFindings.length, 1);
        strict_1.default.ok(batteryFindings[0].reasonCodes.includes("reserve_held"));
        strict_1.default.equal(record.findingsByDomain.battery, 1);
        const otherDomainFindings = findings.filter((f) => f.domain !== "battery");
        strict_1.default.ok(otherDomainFindings.every((f) => f.notApplicable === true));
        const batteryScore = record.scores.find((s) => s.topic === "battery");
        strict_1.default.equal(batteryScore.value, 100);
        strict_1.default.equal(record.globalScore, 100);
        strict_1.default.equal(Object.keys(record.globalScoreWeights).length, 1);
    });
    (0, node_test_1.it)("reine Funktion: gleicher Input → identisches Ergebnis (Idempotenz auf Record-Ebene)", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        const input = {
            day,
            nextDay: null,
            sourceUpdatedAtIso: "2026-06-15T22:00:00.000Z",
            sourceTelemetrySchemaVersion: 2,
            evaluatedAtIso: "2026-06-16T03:00:00.000Z",
        };
        const first = (0, evaluate_js_1.evaluateDay)(input);
        const second = (0, evaluate_js_1.evaluateDay)(input);
        strict_1.default.deepEqual(first.record, second.record);
        strict_1.default.deepEqual(first.findings, second.findings);
    });
    (0, node_test_1.it)("dayComplete/dayEvaluable/dayCoveragePct werden 1:1 aus day_telemetry gespiegelt (kein Learning-Ausschluss hier)", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        day.complete = false;
        day.evaluable = false;
        day.coveragePct = 12.3;
        const { record } = (0, evaluate_js_1.evaluateDay)({
            day,
            nextDay: null,
            sourceUpdatedAtIso: "2026-06-15T22:00:00.000Z",
            sourceTelemetrySchemaVersion: 2,
        });
        strict_1.default.equal(record.dayComplete, false);
        strict_1.default.equal(record.dayEvaluable, false);
        strict_1.default.equal(record.dayCoveragePct, 12.3);
    });
});
