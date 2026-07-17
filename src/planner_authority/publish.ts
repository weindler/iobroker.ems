import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { PlannerPathLayout } from "../planner_paths/paths";
import {
	computeCandidateRevision,
	type PlannerPlanCandidate,
} from "../planner_candidate/types";
import {
	consumePermit,
	isCanonicalPublishPermit,
	permitExpired,
	type CanonicalPublishPermit,
} from "../planner_publish/permit";

export class WorkerPublishError extends Error {
	constructor(public readonly code: string) {
		super(code);
		this.name = "WorkerPublishError";
	}
}

export interface WorkerCanonicalPublishInput {
	candidate: PlannerPlanCandidate;
	generation: number;
	layout: PlannerPathLayout;
	permit: CanonicalPublishPermit;
	nowMs?: number;
}

export interface WorkerCanonicalPublishResult {
	planPath: string;
	planRevision: string;
	contentSha256: string;
}

function sha256(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Publish a validated candidate as the worker canonical plan under the runtime
 * worker canonical generation dir. Verifies the permit, writes atomically, reads
 * back, verifies revision + content hash, then consumes the permit.
 * Throws WorkerPublishError with a code on any failure so callers can fall back.
 */
export async function publishWorkerCanonicalFromCandidate(
	input: WorkerCanonicalPublishInput,
): Promise<WorkerCanonicalPublishResult> {
	const { candidate, generation, layout, permit } = input;
	const nowMs = input.nowMs ?? Date.now();

	if (!isCanonicalPublishPermit(permit)) throw new WorkerPublishError("permit_invalid");
	if (permit.consumed) throw new WorkerPublishError("permit_consumed");
	if (permitExpired(permit, nowMs)) throw new WorkerPublishError("permit_expired");
	if (permit.scope !== "worker_dryrun" || permit.executionMode !== "dryrun") {
		throw new WorkerPublishError("permit_scope_invalid");
	}
	if (permit.generation !== generation) throw new WorkerPublishError("generation_mismatch");
	if (permit.candidateRevision !== candidate.candidateRevision) {
		throw new WorkerPublishError("candidate_revision_mismatch");
	}
	if (permit.planRevision !== candidate.candidateRevision) {
		throw new WorkerPublishError("plan_revision_mismatch");
	}

	// Independent integrity check: recompute candidate revision from content.
	const { candidateRevision, generatedAt, ...rest } = candidate;
	void generatedAt;
	const recomputed = computeCandidateRevision(rest);
	if (recomputed !== candidateRevision) throw new WorkerPublishError("candidate_hash_mismatch");

	const planPath = layout.workerCanonicalPlanPath(generation);
	const dir = path.dirname(planPath);
	await fs.mkdir(dir, { recursive: true, mode: 0o700 });
	const json = `${JSON.stringify(candidate, null, 2)}\n`;
	const contentSha256 = sha256(json);
	const tmp = `${planPath}.${process.pid}.${nowMs}.tmp`;
	await fs.writeFile(tmp, json, { mode: 0o600 });
	await fs.rename(tmp, planPath);

	// Read back and verify.
	const readBack = await fs.readFile(planPath, "utf8");
	if (sha256(readBack) !== contentSha256) throw new WorkerPublishError("readback_hash_mismatch");
	let parsed: PlannerPlanCandidate;
	try {
		parsed = JSON.parse(readBack) as PlannerPlanCandidate;
	} catch {
		throw new WorkerPublishError("readback_parse_failed");
	}
	if (parsed.candidateRevision !== candidate.candidateRevision) {
		throw new WorkerPublishError("readback_revision_mismatch");
	}

	if (!consumePermit(permit)) throw new WorkerPublishError("permit_consume_failed");

	return { planPath, planRevision: candidate.candidateRevision, contentSha256 };
}
