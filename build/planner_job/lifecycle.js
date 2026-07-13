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
exports.PlannerJobLifecycle = void 0;
const node_child_process_1 = require("node:child_process");
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const constants_1 = require("../planner_paths/constants");
const validate_1 = require("../planner_contracts/validate");
const constants_2 = require("./constants");
const ipc_1 = require("./ipc");
class PlannerJobLifecycle {
    paths;
    repository;
    child = null;
    activeJob = null;
    timeoutTimer = null;
    killTimer = null;
    failedJobIds = [];
    constructor(paths, repository) {
        this.paths = paths;
        this.repository = repository;
    }
    isRunning() {
        return this.child !== null;
    }
    getActiveJob() {
        return this.activeJob;
    }
    resolveWorkerPath(adapterPackageRoot) {
        return path.join(adapterPackageRoot, "build", "planner_worker", "main.js");
    }
    async runJob(options) {
        if (this.child) {
            throw new Error("planner worker already running");
        }
        const timeoutMs = options.timeoutMs ?? options.request.timeoutMs ?? constants_2.PLANNER_DEFAULT_JOB_TIMEOUT_MS;
        const jobDir = this.paths.jobDir(options.request.jobId);
        await fs.mkdir(jobDir, { recursive: true, mode: 0o700 });
        const requestJson = `${JSON.stringify(options.request, null, 2)}\n`;
        const inputJson = `${JSON.stringify(options.input, null, 2)}\n`;
        (0, validate_1.assertWithinIpcBudget)(requestJson, "request");
        (0, validate_1.assertWithinIpcBudget)(inputJson, "input");
        await fs.writeFile(path.join(jobDir, constants_1.JOB_REQUEST_FILE), requestJson, { mode: 0o600 });
        await fs.writeFile(path.join(jobDir, constants_1.JOB_INPUT_FILE), inputJson, { mode: 0o600 });
        this.activeJob = { jobId: options.request.jobId, generation: options.request.generation };
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        const exitPromise = new Promise((resolve) => {
            const child = (0, node_child_process_1.spawn)(process.execPath, [options.workerScriptPath, "--job-dir", jobDir], {
                env: { ...process.env, PLANNER_JOB_DIR: jobDir },
                stdio: ["ignore", "pipe", "pipe"],
                windowsHide: true,
            });
            this.child = child;
            child.stdout?.on("data", (chunk) => {
                stdout = (0, ipc_1.captureStdioChunk)(stdout, chunk, constants_2.PLANNER_WORKER_STDIO_BUDGET_BYTES);
            });
            child.stderr?.on("data", (chunk) => {
                stderr = (0, ipc_1.captureStdioChunk)(stderr, chunk, constants_2.PLANNER_WORKER_STDIO_BUDGET_BYTES);
            });
            child.on("error", () => resolve(null));
            child.on("close", (code) => resolve(code));
            this.timeoutTimer = setTimeout(() => {
                timedOut = true;
                if (child && !child.killed) {
                    child.kill("SIGTERM");
                    this.killTimer = setTimeout(() => {
                        if (child && !child.killed) {
                            child.kill("SIGKILL");
                        }
                    }, constants_2.PLANNER_SIGKILL_GRACE_MS);
                }
            }, timeoutMs);
        });
        const exitCode = await exitPromise;
        this.clearTimers();
        this.child = null;
        const generation = options.request.generation;
        const jobId = options.request.jobId;
        let published = false;
        let publishReason = timedOut ? "timeout" : `exit_${exitCode}`;
        if (!timedOut && exitCode === 0 && this.activeJob) {
            const publish = await this.repository.publishCurrentJob({
                jobId,
                expectedGeneration: generation,
                isStale: false,
            });
            published = publish.published;
            publishReason = publish.reason;
            if (published) {
                await this.pruneFailedJobs();
            }
            else {
                await this.rememberFailedJob(jobId);
            }
        }
        else {
            await this.rememberFailedJob(jobId);
        }
        this.activeJob = null;
        return {
            jobId,
            generation,
            exitCode,
            timedOut,
            published,
            publishReason,
            stdoutBytes: Buffer.byteLength(stdout, "utf8"),
            stderrBytes: Buffer.byteLength(stderr, "utf8"),
        };
    }
    async publishIfCurrent(jobId, expectedGeneration, isStale) {
        return this.repository.publishCurrentJob({ jobId, expectedGeneration, isStale });
    }
    async shutdown() {
        this.clearTimers();
        const child = this.child;
        if (!child || child.killed) {
            this.child = null;
            this.activeJob = null;
            return;
        }
        await new Promise((resolve) => {
            const onClose = () => resolve();
            child.once("close", onClose);
            child.kill("SIGTERM");
            this.killTimer = setTimeout(() => {
                if (!child.killed)
                    child.kill("SIGKILL");
            }, constants_2.PLANNER_SIGKILL_GRACE_MS);
        });
        this.clearTimers();
        this.child = null;
        this.activeJob = null;
    }
    clearTimers() {
        if (this.timeoutTimer) {
            clearTimeout(this.timeoutTimer);
            this.timeoutTimer = null;
        }
        if (this.killTimer) {
            clearTimeout(this.killTimer);
            this.killTimer = null;
        }
    }
    async rememberFailedJob(jobId) {
        if (!this.failedJobIds.includes(jobId)) {
            this.failedJobIds.push(jobId);
        }
        while (this.failedJobIds.length > constants_2.PLANNER_MAX_FAILED_JOB_RETENTION) {
            const oldest = this.failedJobIds.shift();
            if (oldest) {
                await fs.rm(this.paths.jobDir(oldest), { recursive: true, force: true }).catch(() => undefined);
            }
        }
    }
    async pruneFailedJobs() {
        // successful publish — keep failed list as-is for diagnostics until retention limit
    }
}
exports.PlannerJobLifecycle = PlannerJobLifecycle;
