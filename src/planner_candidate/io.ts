import * as fs from "node:fs/promises";
import * as path from "node:path";
import { sha256Hex } from "../planner_repository/hash";
import {
	PLANNER_CANDIDATE_BUDGET_BYTES,
	PLANNER_CANDIDATE_FILE,
	type PlannerPlanCandidate,
} from "./types";

export async function writePlanCandidateAtomic(
	dir: string,
	candidate: PlannerPlanCandidate,
): Promise<{ path: string; byteSize: number; sha256: string }> {
	await fs.mkdir(dir, { recursive: true, mode: 0o700 });
	const target = path.join(dir, PLANNER_CANDIDATE_FILE);
	const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
	const json = `${JSON.stringify(candidate, null, 2)}\n`;
	const byteSize = Buffer.byteLength(json, "utf8");
	if (byteSize > PLANNER_CANDIDATE_BUDGET_BYTES) {
		throw new Error(`candidate_budget_exceeded:${byteSize}`);
	}
	await fs.writeFile(tmp, json, { mode: 0o600 });
	await fs.rename(tmp, target);
	return { path: target, byteSize, sha256: sha256Hex(json) };
}

export async function readPlanCandidateFile(dir: string): Promise<PlannerPlanCandidate> {
	const raw = await fs.readFile(path.join(dir, PLANNER_CANDIDATE_FILE), "utf8");
	const byteSize = Buffer.byteLength(raw, "utf8");
	if (byteSize > PLANNER_CANDIDATE_BUDGET_BYTES) {
		throw new Error(`candidate_budget_exceeded:${byteSize}`);
	}
	const parsed = JSON.parse(raw) as PlannerPlanCandidate;
	if (parsed?.schemaVersion !== 1 || typeof parsed.candidateRevision !== "string") {
		throw new Error("candidate_invalid_schema");
	}
	return parsed;
}
