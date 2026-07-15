import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
	JOB_INPUT_FILE,
	JOB_REQUEST_FILE,
} from "../planner_paths/constants";
import type { PlannerPathLayout } from "../planner_paths/paths";
import type { PlannerInputSnapshot, PlannerJobRequest } from "../planner_contracts/types";
import { assertWithinIpcBudget } from "../planner_contracts/validate";
import { validatePlannerInputBudget } from "../planner_preparation/validate";
import { PlannerRepository } from "../planner_repository/repository";
import {
	PLANNER_DEFAULT_JOB_TIMEOUT_MS,
	PLANNER_MAX_FAILED_JOB_RETENTION,
	PLANNER_SIGKILL_GRACE_MS,
	PLANNER_WORKER_STDIO_BUDGET_BYTES,
} from "./constants";
import { captureStdioChunk } from "./ipc";

export interface PlannerJobRunOptions {
	request: PlannerJobRequest;
	input: PlannerInputSnapshot;
	workerScriptPath: string;
	timeoutMs?: number;
}

export interface PlannerJobRunResult {
	jobId: string;
	generation: number;
	exitCode: number | null;
	timedOut: boolean;
	published: boolean;
	publishReason: string;
	stdoutBytes: number;
	stderrBytes: number;
}

export class PlannerJobLifecycle {
	private child: ChildProcess | null = null;
	private activeJob: { jobId: string; generation: number } | null = null;
	private timeoutTimer: NodeJS.Timeout | null = null;
	private killTimer: NodeJS.Timeout | null = null;
	private readonly failedJobIds: string[] = [];

	constructor(
		private readonly paths: PlannerPathLayout,
		private readonly repository: PlannerRepository,
	) {}

	isRunning(): boolean {
		return this.child !== null;
	}

	getActiveJob(): { jobId: string; generation: number } | null {
		return this.activeJob;
	}

	resolveWorkerPath(adapterPackageRoot: string): string {
		return path.join(adapterPackageRoot, "build", "planner_worker", "main.js");
	}

	async runJob(options: PlannerJobRunOptions): Promise<PlannerJobRunResult> {
		if (this.child) {
			throw new Error("planner worker already running");
		}

		const timeoutMs = options.timeoutMs ?? options.request.timeoutMs ?? PLANNER_DEFAULT_JOB_TIMEOUT_MS;
		const jobDir = this.paths.jobDir(options.request.jobId);
		await fs.mkdir(jobDir, { recursive: true, mode: 0o700 });

		const requestJson = `${JSON.stringify(options.request, null, 2)}\n`;
		const inputJson = `${JSON.stringify(options.input, null, 2)}\n`;
		assertWithinIpcBudget(requestJson, "request");
		validatePlannerInputBudget(inputJson);

		await fs.writeFile(path.join(jobDir, JOB_REQUEST_FILE), requestJson, { mode: 0o600 });
		await fs.writeFile(path.join(jobDir, JOB_INPUT_FILE), inputJson, { mode: 0o600 });

		this.activeJob = { jobId: options.request.jobId, generation: options.request.generation };

		let stdout = "";
		let stderr = "";
		let timedOut = false;

		const exitPromise = new Promise<number | null>((resolve) => {
			const child = spawn(process.execPath, [options.workerScriptPath, "--job-dir", jobDir], {
				env: { ...process.env, PLANNER_JOB_DIR: jobDir },
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
			});
			this.child = child;

			child.stdout?.on("data", (chunk: Buffer) => {
				stdout = captureStdioChunk(stdout, chunk, PLANNER_WORKER_STDIO_BUDGET_BYTES);
			});
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr = captureStdioChunk(stderr, chunk, PLANNER_WORKER_STDIO_BUDGET_BYTES);
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
					}, PLANNER_SIGKILL_GRACE_MS);
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

		if (!timedOut && exitCode === 0 && this.activeJob && options.request.mode !== "simulation") {
			const publish = await this.repository.publishCurrentJob({
				jobId,
				expectedGeneration: generation,
				isStale: false,
			});
			published = publish.published;
			publishReason = publish.reason;
			if (published) {
				await this.pruneFailedJobs();
			} else {
				await this.rememberFailedJob(jobId);
			}
		} else {
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

	async publishIfCurrent(jobId: string, expectedGeneration: number, isStale: boolean) {
		return this.repository.publishCurrentJob({ jobId, expectedGeneration, isStale });
	}

	async shutdown(): Promise<void> {
		this.clearTimers();
		const child = this.child;
		if (!child || child.killed) {
			this.child = null;
			this.activeJob = null;
			return;
		}
		await new Promise<void>((resolve) => {
			const onClose = () => resolve();
			child.once("close", onClose);
			child.kill("SIGTERM");
			this.killTimer = setTimeout(() => {
				if (!child.killed) child.kill("SIGKILL");
			}, PLANNER_SIGKILL_GRACE_MS);
		});
		this.clearTimers();
		this.child = null;
		this.activeJob = null;
	}

	private clearTimers(): void {
		if (this.timeoutTimer) {
			clearTimeout(this.timeoutTimer);
			this.timeoutTimer = null;
		}
		if (this.killTimer) {
			clearTimeout(this.killTimer);
			this.killTimer = null;
		}
	}

	private async rememberFailedJob(jobId: string): Promise<void> {
		if (!this.failedJobIds.includes(jobId)) {
			this.failedJobIds.push(jobId);
		}
		while (this.failedJobIds.length > PLANNER_MAX_FAILED_JOB_RETENTION) {
			const oldest = this.failedJobIds.shift();
			if (oldest) {
				await fs.rm(this.paths.jobDir(oldest), { recursive: true, force: true }).catch(() => undefined);
			}
		}
	}

	private async pruneFailedJobs(): Promise<void> {
		// successful publish — keep failed list as-is for diagnostics until retention limit
	}
}
