import { createHash } from "node:crypto";
import type { ForecastPlan, ForecastPlanDay, ForecastPlanExcludedContributor, ForecastPlanSlot } from "./types";
import type { PlanContribution } from "../types";

/** Detail keys that must not bump revision when alone changed. */
const REVISION_OMIT_DETAIL_KEYS = new Set([
	"lastUpdate",
	"lastUpdateTs",
	"calculated_at",
	"calculatedAt",
	"runtimeId",
	"runtime_id",
	"generatedAt",
	"validUntil",
	"forecastHorizonStart",
	"forecastHorizonEnd",
	"todayDateKey",
	"tomorrowDateKey",
]);

function stripVolatileDetails(details: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(details)) {
		if (REVISION_OMIT_DETAIL_KEYS.has(key)) continue;
		out[key] = value;
	}
	return out;
}

function dayForRevision(day: ForecastPlanDay): Record<string, unknown> {
	return {
		date: day.date,
		pvEnergyKwh: day.pvEnergyKwh,
		houseLoadEnergyKwh: day.houseLoadEnergyKwh,
		renewableBalanceKwh: day.renewableBalanceKwh,
		weatherMinTempC: day.weatherMinTempC,
		weatherMaxTempC: day.weatherMaxTempC,
	};
}

function slotForRevision(slot: ForecastPlanSlot): Record<string, unknown> {
	return {
		slot: slot.slot,
		pvPowerW: slot.pvPowerW,
		houseLoadPowerW: slot.houseLoadPowerW,
		fixedBalancePowerW: slot.fixedBalancePowerW,
		gridPriceCtPerKwh: slot.gridPriceCtPerKwh,
		gridImportAllowed: slot.gridImportAllowed,
		gridMaxImportPowerW: slot.gridMaxImportPowerW,
		outdoorTempC: slot.outdoorTempC,
	};
}

function excludedForRevision(entry: ForecastPlanExcludedContributor): Record<string, unknown> {
	return {
		contributionId: entry.contributionId,
		contributor: entry.contributor,
	};
}

function contributionForRevision(c: PlanContribution): Record<string, unknown> {
	return {
		contributionId: c.contributionId,
		flow: c.flow,
		contributor: c.contributor,
		roles: c.roles,
		enabled: c.enabled,
		quality: {
			status: c.quality.status,
			confidencePct: c.quality.confidencePct,
		},
		details: stripVolatileDetails(c.details),
	};
}

function horizonEndDateKey(horizonEnd: string): string {
	return horizonEnd.slice(0, 10);
}

/** Semantic revision payload — energy/price core only, no volatile metadata. */
export function forecastPlanRevisionPayload(plan: ForecastPlan): string {
	const payload = {
		status: plan.status,
		timezone: plan.timezone,
		horizonEndDate: horizonEndDateKey(plan.horizonEnd),
		slotMinutes: plan.slotMinutes,
		activeContributors: plan.activeContributors,
		excludedContributors: plan.excludedContributors.map(excludedForRevision),
		days: plan.days.map(dayForRevision),
		slots: plan.slots.map(slotForRevision),
		contributions: plan.contributions.map(contributionForRevision),
	};
	return JSON.stringify(payload);
}

export function forecastPlanSemanticRevisionHash(plan: ForecastPlan): string {
	return createHash("sha256").update(forecastPlanRevisionPayload(plan)).digest("hex");
}

const USABLE_FORECAST_STATUSES = new Set<ForecastPlan["status"]>(["ready", "degraded"]);

export function parseForecastPlanFromJson(raw: string | null): ForecastPlan | null {
	if (!raw || !raw.trim()) return null;
	try {
		const parsed = JSON.parse(raw) as ForecastPlan;
		if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.slots)) return null;
		return parsed;
	} catch {
		return null;
	}
}

export function isUsableStoredForecastPlan(plan: ForecastPlan | null): boolean {
	if (!plan) return false;
	return USABLE_FORECAST_STATUSES.has(plan.status);
}

export function isBootstrapForecastPlanJson(raw: string | null): boolean {
	if (!raw || raw.trim() === "" || raw.trim() === "{}") return false;
	return raw.length >= 100;
}
