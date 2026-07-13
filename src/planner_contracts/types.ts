import type { PLANNER_JOB_MODES, PLANNER_JOB_TRIGGERS, PLANNER_WORKER_STATUSES } from "./constants";

export type PlannerJobTrigger = (typeof PLANNER_JOB_TRIGGERS)[number];
export type PlannerJobMode = (typeof PLANNER_JOB_MODES)[number];
export type PlannerWorkerStatus = (typeof PLANNER_WORKER_STATUSES)[number];

/** Job request written by the main process before spawning the worker. */
export interface PlannerJobRequest {
	schemaVersion: 1;
	jobId: string;
	generation: number;
	trigger: PlannerJobTrigger;
	mode: PlannerJobMode;
	requestedAt: string;
	timeoutMs: number;
	inputSnapshotPath: string;
}

/** Serializable planner input — no adapter, functions, credentials, or device paths. */
export interface PlannerInputSnapshot {
	schemaVersion: 1;
	capturedAt: string;
	timezone: string;
	globalMode: string;
	/** Opaque extension bucket for future phases; must remain JSON-serializable. */
	context?: Record<string, unknown>;
}

export interface PlannerFileDescriptor {
	fileName: "forecast_plan_v1.json" | "daily_plan_v1.json" | string;
	byteSize: number;
	sha256: string;
}

export interface AddonAllocationPublic {
	addonId: string;
	status: string;
	revision: number;
	nextAction: string | null;
	nextWindowStart: string | null;
	nextWindowEnd: string | null;
	powerW: number | null;
	energyKwh: number | null;
	reasonDe: string;
	payloadJson: string;
}

export interface PlannerCompactSummary {
	forecast: {
		status: string;
		revision: number;
		horizonStart: string;
		horizonEnd: string;
		reasonDe: string;
	};
	daily: {
		status: string;
		revision: number;
		date: string;
		validUntil: string | null;
		reasonDe: string;
	};
	quality: {
		forecast: string;
		daily: string;
	};
}

/**
 * Worker result — compact only. No full plan objects.
 * Transport and on-disk size must stay within PLANNER_IPC_BUDGET_BYTES.
 */
export interface PlannerWorkerResult {
	schemaVersion: 1;
	jobId: string;
	generation: number;
	status: PlannerWorkerStatus;
	semanticRevision: string;
	summary: PlannerCompactSummary;
	allocations: AddonAllocationPublic[];
	files: PlannerFileDescriptor[];
	error?: {
		code: string;
		messageDe: string;
	};
}

export interface PlannerJobOutputValidation {
	valid: boolean;
	errors: string[];
	forecastDescriptor?: PlannerFileDescriptor;
	dailyDescriptor?: PlannerFileDescriptor;
	result?: PlannerWorkerResult;
}

export interface PlannerPublishResult {
	published: boolean;
	reason: string;
	semanticRevision?: string;
}
