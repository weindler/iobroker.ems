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
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPlannerTestJob = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const constants_1 = require("../planner_paths/constants");
const validate_1 = require("../planner_contracts/validate");
const hash_1 = require("../planner_repository/hash");
const schema_1 = require("../planner_repository/schema");
function buildTestForecastPlan(capturedAt) {
    return {
        schema_version: 1,
        revision: 1,
        generated_at: capturedAt,
        status: "ready",
        horizon_start: capturedAt,
        horizon_end: capturedAt,
        slot_minutes: 15,
        slots: [{ start: capturedAt, end: capturedAt, net_surplus_w: 0 }],
    };
}
function buildTestDailyPlan(capturedAt, date) {
    return {
        schema_version: 1,
        revision: 1,
        generated_at: capturedAt,
        status: "ready",
        date,
        valid_until: null,
        allocations: [{ addon_id: "battery", power_w: 0 }],
    };
}
function semanticRevision(forecast, daily) {
    const payload = {
        forecast: {
            revision: forecast.revision,
            status: forecast.status,
            horizon_start: forecast.horizon_start,
            horizon_end: forecast.horizon_end,
            slot_count: forecast.slots.length,
        },
        daily: {
            revision: daily.revision,
            status: daily.status,
            date: daily.date,
            allocation_count: daily.allocations.length,
        },
    };
    return (0, hash_1.sha256Hex)((0, hash_1.stableSemanticStringify)(payload));
}
/**
 * Phase-2 deterministic worker job: validates request/input, writes compact test plans + result.
 * Does not touch canonical durable paths.
 */
async function runPlannerTestJob(jobDir) {
    const requestPath = path.join(jobDir, constants_1.JOB_REQUEST_FILE);
    const inputPath = path.join(jobDir, constants_1.JOB_INPUT_FILE);
    let requestRaw;
    let inputRaw;
    try {
        requestRaw = await fs.readFile(requestPath, "utf8");
        inputRaw = await fs.readFile(inputPath, "utf8");
    }
    catch (e) {
        return { exitCode: 2, message: `missing job files: ${String(e)}` };
    }
    let requestParsed;
    let inputParsed;
    try {
        requestParsed = JSON.parse(requestRaw);
        inputParsed = JSON.parse(inputRaw);
    }
    catch {
        return { exitCode: 2, message: "invalid JSON in request or input" };
    }
    const requestCheck = (0, validate_1.validatePlannerJobRequest)(requestParsed);
    if (!requestCheck.valid || !requestCheck.value) {
        return { exitCode: 2, message: `invalid request: ${requestCheck.errors.join("; ")}` };
    }
    const inputCheck = (0, validate_1.validatePlannerInputSnapshot)(inputParsed);
    if (!inputCheck.valid || !inputCheck.value) {
        return { exitCode: 2, message: `invalid input: ${inputCheck.errors.join("; ")}` };
    }
    const request = requestCheck.value;
    const input = inputCheck.value;
    if (request.mode === "explain") {
        return { exitCode: 0, message: "explain mode — no artifacts written" };
    }
    const forecast = buildTestForecastPlan(input.capturedAt);
    const daily = buildTestDailyPlan(input.capturedAt, input.capturedAt.slice(0, 10));
    const forecastPath = path.join(jobDir, constants_1.CANONICAL_FORECAST_PLAN_FILE);
    const dailyPath = path.join(jobDir, constants_1.CANONICAL_DAILY_PLAN_FILE);
    const forecastJson = `${JSON.stringify(forecast, null, 2)}\n`;
    const dailyJson = `${JSON.stringify(daily, null, 2)}\n`;
    await fs.writeFile(forecastPath, forecastJson, { mode: 0o600 });
    await fs.writeFile(dailyPath, dailyJson, { mode: 0o600 });
    const fVal = (0, schema_1.validateCanonicalForecastPlan)(forecast);
    const dVal = (0, schema_1.validateCanonicalDailyPlan)(daily);
    if (!fVal.valid || !dVal.valid) {
        return { exitCode: 2, message: "internal test plan schema invalid" };
    }
    const forecastHash = await (0, hash_1.sha256File)(forecastPath);
    const dailyHash = await (0, hash_1.sha256File)(dailyPath);
    const forecastStat = await fs.stat(forecastPath);
    const dailyStat = await fs.stat(dailyPath);
    const semRev = semanticRevision(forecast, daily);
    const summary = {
        forecast: {
            status: forecast.status,
            revision: forecast.revision,
            horizonStart: forecast.horizon_start,
            horizonEnd: forecast.horizon_end,
            reasonDe: "Phase-2 Test-Forecast",
        },
        daily: {
            status: daily.status,
            revision: daily.revision,
            date: daily.date,
            validUntil: daily.valid_until,
            reasonDe: "Phase-2 Test-Daily",
        },
        quality: { forecast: "test", daily: "test" },
    };
    const result = {
        schemaVersion: 1,
        jobId: request.jobId,
        generation: request.generation,
        status: "ok",
        semanticRevision: semRev,
        summary,
        allocations: [
            {
                addonId: "battery",
                status: "ready",
                revision: 1,
                nextAction: null,
                nextWindowStart: null,
                nextWindowEnd: null,
                powerW: 0,
                energyKwh: null,
                reasonDe: "Test-Allocation",
                payloadJson: "[]",
            },
        ],
        files: [
            {
                fileName: constants_1.CANONICAL_FORECAST_PLAN_FILE,
                byteSize: forecastStat.size,
                sha256: forecastHash,
            },
            {
                fileName: constants_1.CANONICAL_DAILY_PLAN_FILE,
                byteSize: dailyStat.size,
                sha256: dailyHash,
            },
        ],
    };
    const summaryJson = `${JSON.stringify(summary, null, 2)}\n`;
    const resultJson = `${JSON.stringify(result, null, 2)}\n`;
    await fs.writeFile(path.join(jobDir, constants_1.JOB_SUMMARY_FILE), summaryJson, { mode: 0o600 });
    await fs.writeFile(path.join(jobDir, constants_1.JOB_RESULT_FILE), resultJson, { mode: 0o600 });
    return { exitCode: 0, message: "ok" };
}
exports.runPlannerTestJob = runPlannerTestJob;
