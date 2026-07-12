import { createHash } from "node:crypto";
import type { ForecastPlan } from "./types";

/** Contribution fields excluded from semantic revision (volatile / runtime). */
const REVISION_OMIT_CONTRIBUTION_KEYS = new Set([
	"generatedAt",
	"validUntil",
	"revision",
]);

/** Detail keys that must not bump revision when alone changed. */
const REVISION_OMIT_DETAIL_KEYS = new Set([
	"lastUpdate",
	"lastUpdateTs",
	"calculated_at",
	"calculatedAt",
	"runtimeId",
	"runtime_id",
]);

function stripVolatileDetails(details: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(details)) {
		if (REVISION_OMIT_DETAIL_KEYS.has(key)) continue;
		out[key] = value;
	}
	return out;
}

function contributionForRevision(c: ForecastPlan["contributions"][number]): Record<string, unknown> {
	return {
		contributionId: c.contributionId,
		flow: c.flow,
		contributor: c.contributor,
		roles: c.roles,
		enabled: c.enabled,
		quality: c.quality,
		details: stripVolatileDetails(c.details),
		slots: c.slots,
	};
}

/** Semantic revision payload — excludes generatedAt, horizonStart and other volatile fields. */
export function forecastPlanRevisionPayload(plan: ForecastPlan): string {
	const payload = {
		status: plan.status,
		timezone: plan.timezone,
		horizonEnd: plan.horizonEnd,
		slotMinutes: plan.slotMinutes,
		activeContributors: plan.activeContributors,
		excludedContributors: plan.excludedContributors,
		days: plan.days,
		slots: plan.slots,
		contributions: plan.contributions.map(contributionForRevision),
		quality: plan.quality,
		reasonDe: plan.reasonDe,
	};
	return JSON.stringify(payload);
}

export function forecastPlanSemanticRevisionHash(plan: ForecastPlan): string {
	return createHash("sha256").update(forecastPlanRevisionPayload(plan)).digest("hex");
}
