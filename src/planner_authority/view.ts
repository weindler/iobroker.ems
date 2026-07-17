import * as fs from "node:fs/promises";
import type { PlannerPathLayout } from "../planner_paths/paths";
import type { PlannerPlanCandidate } from "../planner_candidate/types";
import { WORKER_PLAN_STALE_GRACE_MS } from "./constants";
import { readPointer } from "./pointer";
import type {
	ActivePlannerAuthorityPointer,
	AuthoritativePlannerSlot,
	AuthoritativePlannerView,
} from "./types";

function compactSlot(
	candidate: PlannerPlanCandidate,
	slotStart: string,
	slotEnd: string,
): AuthoritativePlannerSlot {
	const allocations = candidate.allocations
		.filter((a) => a.slotStart === slotStart && a.slotEnd === slotEnd)
		.map((a) => ({
			contributionId: a.contributionId,
			powerW: a.powerW,
			energyKwh: a.energyKwh,
			status: a.status,
		}));
	return { slotStart, slotEnd, allocations };
}

function findSlots(
	candidate: PlannerPlanCandidate,
	nowMs: number,
): { current: AuthoritativePlannerSlot | null; next: AuthoritativePlannerSlot | null } {
	const slots = [...candidate.forecastSlots].sort(
		(a, b) => Date.parse(a.start) - Date.parse(b.start),
	);
	let currentIdx = -1;
	for (let i = 0; i < slots.length; i++) {
		const start = Date.parse(slots[i].start);
		const end = Date.parse(slots[i].end);
		if (nowMs >= start && nowMs < end) {
			currentIdx = i;
			break;
		}
	}
	if (currentIdx === -1) return { current: null, next: null };
	const cur = slots[currentIdx];
	const nxt = slots[currentIdx + 1];
	return {
		current: compactSlot(candidate, cur.start, cur.end),
		next: nxt ? compactSlot(candidate, nxt.start, nxt.end) : null,
	};
}

export interface BuildAuthoritativeViewInput {
	layout: PlannerPathLayout;
	pointer: ActivePlannerAuthorityPointer | null;
	nowMs: number;
}

/**
 * Build a compact authoritative view. Only the current + next slot metadata are
 * retained — the full plan is never held in a long-lived store.
 */
export async function buildAuthoritativePlannerView(
	input: BuildAuthoritativeViewInput,
): Promise<AuthoritativePlannerView> {
	const nowIso = new Date(input.nowMs).toISOString();
	const pointer = input.pointer;
	if (!pointer || pointer.source === "legacy") {
		return {
			source: "legacy",
			quality: pointer ? "valid" : "missing",
			generation: pointer?.generation ?? null,
			planRevision: null,
			currentSlot: null,
			nextSlot: null,
			loadedAt: nowIso,
		};
	}

	// worker_dryrun
	if (!pointer.planPath) {
		return baseWorker(pointer, "missing", nowIso);
	}
	let raw: string;
	try {
		raw = await fs.readFile(pointer.planPath, "utf8");
	} catch {
		return baseWorker(pointer, "missing", nowIso);
	}
	let candidate: PlannerPlanCandidate;
	try {
		candidate = JSON.parse(raw) as PlannerPlanCandidate;
	} catch {
		return baseWorker(pointer, "invalid", nowIso);
	}
	if (candidate.candidateRevision !== pointer.planRevision) {
		return baseWorker(pointer, "invalid", nowIso);
	}

	const { current, next } = findSlots(candidate, input.nowMs);
	let quality: AuthoritativePlannerView["quality"] = "valid";
	if (!current) {
		const horizonEnd = Date.parse(candidate.horizonEnd);
		quality =
			Number.isFinite(horizonEnd) && input.nowMs > horizonEnd + WORKER_PLAN_STALE_GRACE_MS
				? "stale"
				: "invalid";
	}

	return {
		source: "worker_dryrun",
		quality,
		generation: pointer.generation,
		planRevision: pointer.planRevision,
		currentSlot: current,
		nextSlot: next,
		loadedAt: nowIso,
	};
}

function baseWorker(
	pointer: ActivePlannerAuthorityPointer,
	quality: AuthoritativePlannerView["quality"],
	nowIso: string,
): AuthoritativePlannerView {
	return {
		source: "worker_dryrun",
		quality,
		generation: pointer.generation,
		planRevision: pointer.planRevision,
		currentSlot: null,
		nextSlot: null,
		loadedAt: nowIso,
	};
}

let cachedView: AuthoritativePlannerView | null = null;

export async function getActiveAuthoritativePlannerView(input: {
	layout: PlannerPathLayout;
	nowMs: number;
	refresh?: boolean;
}): Promise<AuthoritativePlannerView> {
	if (cachedView && !input.refresh) return cachedView;
	const pointer = await readPointer(input.layout);
	cachedView = await buildAuthoritativePlannerView({
		layout: input.layout,
		pointer,
		nowMs: input.nowMs,
	});
	return cachedView;
}

export function clearAuthoritativeViewCacheForTest(): void {
	cachedView = null;
}
