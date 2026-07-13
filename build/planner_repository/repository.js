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
exports.readJobResult = exports.PlannerRepository = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const atomic_write_1 = require("../persistence/atomic_write");
const constants_1 = require("../planner_paths/constants");
const validate_1 = require("../planner_contracts/validate");
const hash_1 = require("./hash");
const schema_1 = require("./schema");
class PlannerRepository {
    paths;
    constructor(paths) {
        this.paths = paths;
    }
    async readCanonicalForecastPlan() {
        return this.readCanonicalPlanFile(this.paths.canonicalForecastPlanPath, schema_1.validateCanonicalForecastPlan);
    }
    async readCanonicalDailyPlan() {
        return this.readCanonicalPlanFile(this.paths.canonicalDailyPlanPath, schema_1.validateCanonicalDailyPlan);
    }
    async readCompactSummary() {
        const forecast = await this.readCanonicalForecastPlan();
        const daily = await this.readCanonicalDailyPlan();
        if (!forecast || !daily)
            return null;
        return {
            forecast: {
                status: forecast.status,
                revision: forecast.revision,
                horizonStart: forecast.horizon_start,
                horizonEnd: forecast.horizon_end,
                reasonDe: `Forecast revision ${forecast.revision}`,
            },
            daily: {
                status: daily.status,
                revision: daily.revision,
                date: daily.date,
                validUntil: daily.valid_until,
                reasonDe: `Daily plan ${daily.date}`,
            },
            quality: {
                forecast: forecast.status,
                daily: daily.status,
            },
        };
    }
    semanticRevision(forecast, daily) {
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
    async validateJobOutput(jobId) {
        const errors = [];
        const jobDir = this.paths.jobDir(jobId);
        const resultPath = path.join(jobDir, constants_1.JOB_RESULT_FILE);
        const forecastPath = path.join(jobDir, constants_1.CANONICAL_FORECAST_PLAN_FILE);
        const dailyPath = path.join(jobDir, constants_1.CANONICAL_DAILY_PLAN_FILE);
        let resultRaw;
        try {
            resultRaw = await fs.readFile(resultPath, "utf8");
        }
        catch {
            return { valid: false, errors: ["result.json missing"] };
        }
        let parsed;
        try {
            parsed = JSON.parse(resultRaw);
        }
        catch {
            return { valid: false, errors: ["result.json invalid JSON"] };
        }
        const resultCheck = (0, validate_1.validatePlannerWorkerResult)(parsed);
        if (!resultCheck.valid || !resultCheck.value) {
            return { valid: false, errors: resultCheck.errors };
        }
        const result = resultCheck.value;
        if (result.jobId !== jobId) {
            errors.push("result.jobId mismatch");
        }
        if (result.status !== "ok") {
            errors.push(`result.status is ${result.status}`);
        }
        let forecastDescriptor;
        let dailyDescriptor;
        try {
            const forecastHash = await (0, hash_1.sha256File)(forecastPath);
            const dailyHash = await (0, hash_1.sha256File)(dailyPath);
            const forecastStat = await fs.stat(forecastPath);
            const dailyStat = await fs.stat(dailyPath);
            forecastDescriptor = {
                fileName: constants_1.CANONICAL_FORECAST_PLAN_FILE,
                byteSize: forecastStat.size,
                sha256: forecastHash,
            };
            dailyDescriptor = {
                fileName: constants_1.CANONICAL_DAILY_PLAN_FILE,
                byteSize: dailyStat.size,
                sha256: dailyHash,
            };
        }
        catch {
            return { valid: false, errors: ["job plan files missing"] };
        }
        const matchDescriptor = (name, sha, size) => {
            const fd = result.files.find((f) => f.fileName === name);
            if (!fd) {
                errors.push(`result.files missing ${name}`);
                return;
            }
            if (fd.sha256 !== sha)
                errors.push(`sha256 mismatch for ${name}`);
            if (fd.byteSize !== size)
                errors.push(`byteSize mismatch for ${name}`);
        };
        matchDescriptor(constants_1.CANONICAL_FORECAST_PLAN_FILE, forecastDescriptor.sha256, forecastDescriptor.byteSize);
        matchDescriptor(constants_1.CANONICAL_DAILY_PLAN_FILE, dailyDescriptor.sha256, dailyDescriptor.byteSize);
        let forecastPlan;
        let dailyPlan;
        try {
            const forecastRaw = JSON.parse(await fs.readFile(forecastPath, "utf8"));
            const dailyRaw = JSON.parse(await fs.readFile(dailyPath, "utf8"));
            const fVal = (0, schema_1.validateCanonicalForecastPlan)(forecastRaw);
            const dVal = (0, schema_1.validateCanonicalDailyPlan)(dailyRaw);
            if (!fVal.valid)
                errors.push(...fVal.errors);
            else
                forecastPlan = fVal.plan;
            if (!dVal.valid)
                errors.push(...dVal.errors);
            else
                dailyPlan = dVal.plan;
        }
        catch {
            errors.push("plan file JSON parse failed");
        }
        if (forecastPlan && dailyPlan) {
            const expectedRevision = this.semanticRevision(forecastPlan, dailyPlan);
            if (result.semanticRevision !== expectedRevision) {
                errors.push("semanticRevision mismatch");
            }
        }
        return {
            valid: errors.length === 0,
            errors,
            forecastDescriptor,
            dailyDescriptor,
            result: resultCheck.value,
        };
    }
    /**
     * Publish job output to canonical durable paths. Main process only.
     * Worker must never call this.
     */
    async publishCurrentJob(ctx) {
        if (ctx.isStale) {
            return { published: false, reason: "stale_generation" };
        }
        const validation = await this.validateJobOutput(ctx.jobId);
        if (!validation.valid || !validation.result) {
            return { published: false, reason: validation.errors.join("; ") || "validation_failed" };
        }
        const result = validation.result;
        if (result.jobId !== ctx.jobId) {
            return { published: false, reason: "job_id_mismatch" };
        }
        if (result.generation !== ctx.expectedGeneration) {
            return { published: false, reason: "generation_mismatch" };
        }
        if (result.status !== "ok") {
            return { published: false, reason: `status_${result.status}` };
        }
        const jobDir = this.paths.jobDir(ctx.jobId);
        const forecastSrc = path.join(jobDir, constants_1.CANONICAL_FORECAST_PLAN_FILE);
        const dailySrc = path.join(jobDir, constants_1.CANONICAL_DAILY_PLAN_FILE);
        try {
            const forecastContent = await fs.readFile(forecastSrc);
            const dailyContent = await fs.readFile(dailySrc);
            const forecastParsed = JSON.parse(forecastContent.toString("utf8"));
            const dailyParsed = JSON.parse(dailyContent.toString("utf8"));
            const fVal = (0, schema_1.validateCanonicalForecastPlan)(forecastParsed);
            const dVal = (0, schema_1.validateCanonicalDailyPlan)(dailyParsed);
            if (!fVal.valid || !dVal.valid) {
                return { published: false, reason: "schema_invalid_at_publish" };
            }
            await (0, atomic_write_1.atomicWriteFile)(this.paths.canonicalForecastPlanPath, forecastContent, {
                validate: () => {
                    const check = (0, schema_1.validateCanonicalForecastPlan)(JSON.parse(forecastContent.toString("utf8")));
                    if (!check.valid)
                        throw new Error(check.errors.join("; "));
                },
            });
            await (0, atomic_write_1.atomicWriteFile)(this.paths.canonicalDailyPlanPath, dailyContent, {
                validate: () => {
                    const check = (0, schema_1.validateCanonicalDailyPlan)(JSON.parse(dailyContent.toString("utf8")));
                    if (!check.valid)
                        throw new Error(check.errors.join("; "));
                },
            });
            await this.cleanupJobDir(jobDir, true);
            return { published: true, reason: "ok", semanticRevision: result.semanticRevision };
        }
        catch (e) {
            return { published: false, reason: `publish_failed:${String(e)}` };
        }
    }
    /**
     * Simulation artifacts stay under runtime/simulations — never touch canonical durable files.
     */
    async writeSimulationArtifacts(jobId, forecastContent, dailyContent) {
        const simDir = this.paths.simulationDir(jobId);
        await fs.mkdir(simDir, { recursive: true, mode: 0o700 });
        await (0, atomic_write_1.atomicWriteFile)(path.join(simDir, constants_1.CANONICAL_FORECAST_PLAN_FILE), forecastContent);
        await (0, atomic_write_1.atomicWriteFile)(path.join(simDir, constants_1.CANONICAL_DAILY_PLAN_FILE), dailyContent);
    }
    async writeSeedCanonicalPlans(forecast, daily) {
        await fs.mkdir(this.paths.durablePlannerDir, { recursive: true, mode: 0o700 });
        await (0, atomic_write_1.atomicWriteFile)(this.paths.canonicalForecastPlanPath, `${JSON.stringify(forecast, null, 2)}\n`, {
            validate: () => {
                const check = (0, schema_1.validateCanonicalForecastPlan)(forecast);
                if (!check.valid)
                    throw new Error(check.errors.join("; "));
            },
        });
        await (0, atomic_write_1.atomicWriteFile)(this.paths.canonicalDailyPlanPath, `${JSON.stringify(daily, null, 2)}\n`, {
            validate: () => {
                const check = (0, schema_1.validateCanonicalDailyPlan)(daily);
                if (!check.valid)
                    throw new Error(check.errors.join("; "));
            },
        });
    }
    async cleanupJobDir(jobDir, removeSummary = false) {
        const names = await fs.readdir(jobDir).catch(() => []);
        for (const name of names) {
            if (!removeSummary && (name === constants_1.JOB_SUMMARY_FILE || name === constants_1.JOB_RESULT_FILE))
                continue;
            await fs.unlink(path.join(jobDir, name)).catch(() => undefined);
        }
        if (removeSummary) {
            await fs.rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
        }
    }
    async readCanonicalPlanFile(filePath, validate) {
        try {
            const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
            const check = validate(raw);
            return check.valid && check.plan ? check.plan : null;
        }
        catch {
            return null;
        }
    }
}
exports.PlannerRepository = PlannerRepository;
async function readJobResult(jobDir) {
    try {
        const raw = JSON.parse(await fs.readFile(path.join(jobDir, constants_1.JOB_RESULT_FILE), "utf8"));
        const check = (0, validate_1.validatePlannerWorkerResult)(raw);
        return check.valid ? (check.value ?? null) : null;
    }
    catch {
        return null;
    }
}
exports.readJobResult = readJobResult;
