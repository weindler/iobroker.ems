import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ACTIVE_AUTHORITY_SCHEMA_VERSION } from "./constants";
import type { ActivePlannerAuthorityPointer } from "./types";
import type { PlannerPathLayout } from "../planner_paths/paths";
import { isPlannerRequestedAuthority } from "../planner_config/authoritative_source";

export interface PointerValidationResult {
	ok: boolean;
	code: string | null;
}

function isUnder(candidate: string, root: string): boolean {
	const c = path.resolve(candidate);
	const r = path.resolve(root);
	return c === r || c.startsWith(r + path.sep);
}

/**
 * Validate a pointer's structure and — for worker_dryrun — that the plan path is
 * confined to the worker canonical dir and never under the candidate area.
 */
export function validatePointer(
	pointer: unknown,
	layout: PlannerPathLayout,
): PointerValidationResult {
	if (!pointer || typeof pointer !== "object") return { ok: false, code: "not_object" };
	const p = pointer as Partial<ActivePlannerAuthorityPointer>;
	if (p.schemaVersion !== ACTIVE_AUTHORITY_SCHEMA_VERSION) return { ok: false, code: "schema_mismatch" };
	if (!isPlannerRequestedAuthority(p.source)) return { ok: false, code: "invalid_source" };
	if (typeof p.generation !== "number" || !Number.isInteger(p.generation) || p.generation < 0) {
		return { ok: false, code: "invalid_generation" };
	}

	if (p.source === "legacy") {
		if (p.planPath !== null) return { ok: false, code: "legacy_plan_path_present" };
		return { ok: true, code: null };
	}

	// worker_dryrun
	if (typeof p.planPath !== "string" || p.planPath.length === 0) {
		return { ok: false, code: "missing_plan_path" };
	}
	if (typeof p.planRevision !== "string" || p.planRevision.length === 0) {
		return { ok: false, code: "missing_plan_revision" };
	}
	if (p.planPath.includes("..")) return { ok: false, code: "path_traversal" };
	if (isUnder(p.planPath, layout.runtimeCandidateDir)) {
		return { ok: false, code: "plan_path_under_candidate" };
	}
	if (!isUnder(p.planPath, layout.workerCanonicalDir)) {
		return { ok: false, code: "plan_path_outside_worker_canonical" };
	}
	return { ok: true, code: null };
}

export async function writePointerAtomic(
	layout: PlannerPathLayout,
	pointer: ActivePlannerAuthorityPointer,
): Promise<void> {
	const validation = validatePointer(pointer, layout);
	if (!validation.ok) {
		throw new Error(`invalid_pointer:${validation.code}`);
	}
	const target = layout.activeAuthorityPointerPath;
	await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
	const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
	const json = `${JSON.stringify(pointer, null, 2)}\n`;
	await fs.writeFile(tmp, json, { mode: 0o600 });
	await fs.rename(tmp, target);
}

export async function readPointer(
	layout: PlannerPathLayout,
): Promise<ActivePlannerAuthorityPointer | null> {
	try {
		const raw = await fs.readFile(layout.activeAuthorityPointerPath, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (!validatePointer(parsed, layout).ok) return null;
		return parsed as ActivePlannerAuthorityPointer;
	} catch {
		return null;
	}
}

export async function writeLegacyPointer(
	layout: PlannerPathLayout,
	input: { generation: number; sessionId: string; nowMs: number },
): Promise<void> {
	await writePointerAtomic(layout, {
		schemaVersion: ACTIVE_AUTHORITY_SCHEMA_VERSION,
		source: "legacy",
		generation: input.generation,
		planPath: null,
		planRevision: null,
		updatedAt: new Date(input.nowMs).toISOString(),
		sessionId: input.sessionId,
	});
}

export async function writeWorkerPointer(
	layout: PlannerPathLayout,
	input: {
		generation: number;
		planPath: string;
		planRevision: string;
		sessionId: string;
		nowMs: number;
	},
): Promise<void> {
	await writePointerAtomic(layout, {
		schemaVersion: ACTIVE_AUTHORITY_SCHEMA_VERSION,
		source: "worker_dryrun",
		generation: input.generation,
		planPath: input.planPath,
		planRevision: input.planRevision,
		updatedAt: new Date(input.nowMs).toISOString(),
		sessionId: input.sessionId,
	});
}
