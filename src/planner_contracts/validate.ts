import { PLANNER_IPC_BUDGET_BYTES, PLANNER_JOB_MODES, PLANNER_JOB_TRIGGERS, PLANNER_SCHEMA_VERSION, PLANNER_WORKER_STATUSES } from "./constants";
import type {
	AddonAllocationPublic,
	PlannerCompactSummary,
	PlannerFileDescriptor,
	PlannerInputSnapshot,
	PlannerJobRequest,
	PlannerWorkerResult,
} from "./types";

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
	return typeof v === "string" && v.trim() !== "";
}

function isIsoString(v: unknown): boolean {
	return typeof v === "string" && !Number.isNaN(Date.parse(v));
}

export function utf8ByteLength(text: string): number {
	return Buffer.byteLength(text, "utf8");
}

export function assertWithinIpcBudget(text: string, label: string): void {
	if (utf8ByteLength(text) > PLANNER_IPC_BUDGET_BYTES) {
		throw new Error(`${label} exceeds IPC budget (${PLANNER_IPC_BUDGET_BYTES} bytes)`);
	}
}

export function validatePlannerJobRequest(raw: unknown): { valid: boolean; errors: string[]; value?: PlannerJobRequest } {
	const errors: string[] = [];
	if (!isObject(raw)) {
		return { valid: false, errors: ["request must be an object"] };
	}
	if (raw.schemaVersion !== PLANNER_SCHEMA_VERSION) errors.push("invalid schemaVersion");
	if (!isNonEmptyString(raw.jobId)) errors.push("jobId required");
	if (typeof raw.generation !== "number" || !Number.isFinite(raw.generation) || raw.generation < 0) {
		errors.push("generation must be a non-negative number");
	}
	if (!PLANNER_JOB_TRIGGERS.includes(raw.trigger as never)) errors.push("invalid trigger");
	if (!PLANNER_JOB_MODES.includes(raw.mode as never)) errors.push("invalid mode");
	if (!isIsoString(raw.requestedAt)) errors.push("requestedAt must be ISO timestamp");
	if (typeof raw.timeoutMs !== "number" || raw.timeoutMs <= 0) errors.push("timeoutMs must be positive");
	if (!isNonEmptyString(raw.inputSnapshotPath)) errors.push("inputSnapshotPath required");
	if (errors.length) return { valid: false, errors };
	return {
		valid: true,
		errors: [],
		value: raw as unknown as PlannerJobRequest,
	};
}

export function validatePlannerInputSnapshot(raw: unknown): { valid: boolean; errors: string[]; value?: PlannerInputSnapshot } {
	const errors: string[] = [];
	if (!isObject(raw)) return { valid: false, errors: ["input must be an object"] };
	if (raw.schemaVersion !== PLANNER_SCHEMA_VERSION) errors.push("invalid schemaVersion");
	if (!isIsoString(raw.capturedAt)) errors.push("capturedAt must be ISO timestamp");
	if (!isNonEmptyString(raw.timezone)) errors.push("timezone required");
	if (!isNonEmptyString(raw.globalMode)) errors.push("globalMode required");
	if (raw.context !== undefined && !isObject(raw.context)) errors.push("context must be an object");
	if (errors.length) return { valid: false, errors };
	return { valid: true, errors: [], value: raw as unknown as PlannerInputSnapshot };
}

function validateFileDescriptor(raw: unknown, errors: string[], index: number): PlannerFileDescriptor | null {
	if (!isObject(raw)) {
		errors.push(`files[${index}] must be an object`);
		return null;
	}
	if (!isNonEmptyString(raw.fileName)) errors.push(`files[${index}].fileName required`);
	if (typeof raw.byteSize !== "number" || raw.byteSize < 0) errors.push(`files[${index}].byteSize invalid`);
	if (!isNonEmptyString(raw.sha256) || !/^[a-f0-9]{64}$/.test(raw.sha256)) {
		errors.push(`files[${index}].sha256 must be 64-char hex`);
	}
	if (errors.length) return null;
	return raw as unknown as PlannerFileDescriptor;
}

function validateCompactSummary(raw: unknown, errors: string[]): PlannerCompactSummary | null {
	if (!isObject(raw)) {
		errors.push("summary must be an object");
		return null;
	}
	const forecast = raw.forecast;
	const daily = raw.daily;
	const quality = raw.quality;
	if (!isObject(forecast) || !isObject(daily) || !isObject(quality)) {
		errors.push("summary.forecast/daily/quality required");
		return null;
	}
	return raw as unknown as PlannerCompactSummary;
}

function validateAllocation(raw: unknown, errors: string[], index: number): AddonAllocationPublic | null {
	if (!isObject(raw)) {
		errors.push(`allocations[${index}] must be an object`);
		return null;
	}
	if (!isNonEmptyString(raw.addonId)) errors.push(`allocations[${index}].addonId required`);
	if (!isNonEmptyString(raw.status)) errors.push(`allocations[${index}].status required`);
	if (typeof raw.revision !== "number") errors.push(`allocations[${index}].revision invalid`);
	if (typeof raw.reasonDe !== "string") errors.push(`allocations[${index}].reasonDe required`);
	if (typeof raw.payloadJson !== "string") errors.push(`allocations[${index}].payloadJson required`);
	if (errors.length) return null;
	return raw as unknown as AddonAllocationPublic;
}

export function validatePlannerWorkerResult(raw: unknown): { valid: boolean; errors: string[]; value?: PlannerWorkerResult } {
	const errors: string[] = [];
	if (!isObject(raw)) return { valid: false, errors: ["result must be an object"] };
	if (raw.schemaVersion !== PLANNER_SCHEMA_VERSION) errors.push("invalid schemaVersion");
	if (!isNonEmptyString(raw.jobId)) errors.push("jobId required");
	if (typeof raw.generation !== "number" || !Number.isFinite(raw.generation)) errors.push("generation invalid");
	if (!PLANNER_WORKER_STATUSES.includes(raw.status as never)) errors.push("invalid status");
	if (!isNonEmptyString(raw.semanticRevision)) errors.push("semanticRevision required");
	const summary = validateCompactSummary(raw.summary, errors);
	if (!Array.isArray(raw.files)) errors.push("files must be an array");
	const files: PlannerFileDescriptor[] = [];
	if (Array.isArray(raw.files)) {
		for (let i = 0; i < raw.files.length; i++) {
			const fd = validateFileDescriptor(raw.files[i], errors, i);
			if (fd) files.push(fd);
		}
	}
	const allocations: AddonAllocationPublic[] = [];
	if (!Array.isArray(raw.allocations)) {
		errors.push("allocations must be an array");
	} else {
		for (let i = 0; i < raw.allocations.length; i++) {
			const a = validateAllocation(raw.allocations[i], errors, i);
			if (a) allocations.push(a);
		}
	}
	if (raw.error !== undefined) {
		if (!isObject(raw.error) || !isNonEmptyString(raw.error.code) || typeof raw.error.messageDe !== "string") {
			errors.push("error must have code and messageDe");
		}
	}
	if (errors.length || !summary) return { valid: false, errors };
	const value: PlannerWorkerResult = {
		...(raw as unknown as PlannerWorkerResult),
		summary,
		files,
		allocations,
	};
	try {
		assertWithinIpcBudget(JSON.stringify(value), "result");
	} catch (e) {
		errors.push(String(e));
	}
	if (errors.length) return { valid: false, errors };
	return { valid: true, errors: [], value };
}
