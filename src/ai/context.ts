import { governedAddonEntry, governedAddonIds } from "../addons/governance/registry";
import { isAddonAiOptimizationAllowed, isAddonEnabled } from "../addons/governance/config";
import type {
	AiDailyPlanDigest,
	AiDigestSlot,
	AiLearningDigest,
	AiOptimizationRequestContext,
} from "./types";
import type { DailyPlan, DailyPlanSlot } from "../operator/daily_plan/types";
import { asNum } from "../ems_light/state_util";

export type ContextHost = {
	config: unknown;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
};

/** Nur Add-ons, die aktiv UND per Governance für KI-Optimierung freigegeben sind — sonst darf die KI sie nicht mal erwähnen. */
export function resolveAllowedAddonIds(config: unknown): string[] {
	return governedAddonIds().filter((id) => isAddonEnabled(config, id) && isAddonAiOptimizationAllowed(config, id));
}

/** Summe der flexiblen (nicht-mandatory) Allokation eines Add-on-Präfixes in einem Slot. */
export function addonFlexPowerInSlot(slot: DailyPlanSlot, contributionPrefix: string): number {
	let sum = 0;
	for (const a of slot.allocations) {
		if (a.mandatory) continue;
		if (!a.contributionId.startsWith(contributionPrefix)) continue;
		sum += a.allocatedPowerW ?? 0;
	}
	return sum;
}

function addonAnyPowerInSlot(slot: DailyPlanSlot, contributionPrefix: string): number {
	let sum = 0;
	for (const a of slot.allocations) {
		if (!a.contributionId.startsWith(contributionPrefix)) continue;
		sum += a.allocatedPowerW ?? 0;
	}
	return sum;
}

/** Vollständige Slot-Zeilen über den gesamten Daily-Plan-Horizont (Block 6 — kein slot-only-Minimalkontext). */
function buildSlotDigest(plan: DailyPlan, allowedAddonIds: string[]): AiDigestSlot[] {
	const ihAllowed = allowedAddonIds.includes("immersion_heater");
	const acAllowed = allowedAddonIds.includes("climate");
	const ihPrefix = governedAddonEntry("immersion_heater").runtimeAddonId;
	const acPrefix = governedAddonEntry("climate").runtimeAddonId;
	const batPrefix = governedAddonEntry("battery").runtimeAddonId;
	const wbPrefix = governedAddonEntry("wallbox").runtimeAddonId;
	return plan.slots.map((slot) => ({
		t: slot.slot.startIso,
		priceCtPerKwh: slot.gridPriceCtPerKwh,
		pvSurplusW: slot.availablePvSurplusPowerW,
		houseLoadW: slot.fixedHouseLoadPowerW,
		ihFlexW: ihAllowed ? Math.round(addonFlexPowerInSlot(slot, ihPrefix)) : 0,
		acW: acAllowed ? Math.round(addonFlexPowerInSlot(slot, acPrefix)) : 0,
		batteryChargeW: Math.round(addonAnyPowerInSlot(slot, batPrefix)),
		wallboxW: Math.round(addonAnyPowerInSlot(slot, wbPrefix)),
		allocatedPvW: Math.round(slot.allocatedPvPowerW),
		allocatedGridW: Math.round(slot.allocatedGridPowerW),
	}));
}

function digestFromDailyPlan(plan: DailyPlan, allowedAddonIds: string[]): AiDailyPlanDigest {
	return {
		date: plan.date,
		globalMode: plan.globalMode,
		status: plan.status,
		timezone: plan.timezone,
		slotMinutes: plan.slotMinutes,
		horizonSlotCount: plan.slots.length,
		validUntil: plan.validUntil,
		activeContributionIds: plan.activeContributionIds,
		excludedContributionIds: plan.excludedContributions.map((e) => e.contributionId),
		totals: {
			pvForecastEnergyKwh: plan.totals.pvForecastEnergyKwh,
			fixedHouseLoadEnergyKwh: plan.totals.fixedHouseLoadEnergyKwh,
			flexibleRequestedEnergyKwh: plan.totals.flexibleRequestedEnergyKwh,
			flexibleAllocatedEnergyKwh: plan.totals.flexibleAllocatedEnergyKwh,
			flexibleUnallocatedEnergyKwh: plan.totals.flexibleUnallocatedEnergyKwh,
			pvAllocatedEnergyKwh: plan.totals.pvAllocatedEnergyKwh,
			gridAllocatedEnergyKwh: plan.totals.gridAllocatedEnergyKwh,
			batteryChargeEnergyKwh: plan.totals.batteryChargeEnergyKwh,
			wallboxEnergyKwh: plan.totals.wallboxEnergyKwh,
			immersionHeaterEnergyKwh: plan.totals.immersionHeaterEnergyKwh,
			airConditioningEnergyKwh: plan.totals.airConditioningEnergyKwh,
			estimatedGridCostCt: plan.totals.estimatedGridCostCt,
		},
		unallocated: plan.unallocated.map((u) => ({
			contributionId: u.contributionId,
			unallocatedEnergyKwh: u.unallocatedEnergyKwh,
			reasonDe: u.reasonDe,
		})),
		slots: buildSlotDigest(plan, allowedAddonIds),
	};
}

async function readStr(host: ContextHost, id: string): Promise<string | null> {
	try {
		const st = await host.getStateAsync(id);
		if (st?.val == null) return null;
		const s = String(st.val).trim();
		return s.length > 0 ? s : null;
	} catch {
		return null;
	}
}

async function readNum(host: ContextHost, id: string): Promise<number | null> {
	try {
		return asNum((await host.getStateAsync(id))?.val);
	} catch {
		return null;
	}
}

async function readJson(host: ContextHost, id: string): Promise<Record<string, unknown>> {
	try {
		const st = await host.getStateAsync(id);
		if (typeof st?.val !== "string" || !st.val) return {};
		const parsed = JSON.parse(st.val) as unknown;
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/** Kuratierter Learning-Digest — Skalare aus Learning-States, keine History-Dumps. */
export async function buildLearningDigest(host: ContextHost): Promise<AiLearningDigest> {
	const [
		pvBiasStatus,
		pvToday,
		pvTomorrow,
		thermalStatus,
		thermalEmpty,
		batteryStatus,
		topOffDays,
		priceStatus,
		priceAvg,
		houseStatus,
	] = await Promise.all([
		readStr(host, "learning.pv_bias.status"),
		readNum(host, "learning.pv_bias.corrected_today_kwh"),
		readNum(host, "learning.pv_bias.corrected_tomorrow_kwh"),
		readStr(host, "learning.thermal_runtime.status"),
		readStr(host, "learning.thermal_runtime.estimated_empty_at"),
		readStr(host, "learning.battery_runtime.status"),
		readNum(host, "learning.battery_runtime.topoff_interval_days"),
		readStr(host, "learning.price_learning.status"),
		readNum(host, "learning.price_learning.avg_price_7d"),
		readStr(host, "learning.house_load.status"),
	]);
	return {
		pvBiasStatus,
		pvCorrectedTodayKwh: pvToday,
		pvCorrectedTomorrowKwh: pvTomorrow,
		thermalRuntimeStatus: thermalStatus,
		thermalEstimatedEmptyAt: thermalEmpty,
		batteryRuntimeStatus: batteryStatus,
		batteryTopOffIntervalDays: topOffDays,
		priceLearningStatus: priceStatus,
		priceAvgEurPerKwh7d: priceAvg,
		houseLoadStatus: houseStatus,
	};
}

/** Nur ausgewählte, unkritische Policy-Kennzahlen — kein voller Snapshot. */
function pickPolicyHighlights(policy: Record<string, unknown>): Record<string, unknown> {
	const limits = policy.limits as Record<string, { value?: unknown }> | undefined;
	const economics = policy.economics as Record<string, { value?: unknown }> | undefined;
	return {
		houseFuseLimitW: limits?.houseFuseLimitW?.value ?? null,
		maxGridImportW: limits?.maxGridImportW?.value ?? null,
		gridImportAllowed: economics?.gridImportAllowed?.value ?? null,
	};
}

export async function buildAiOptimizationContext(
	host: ContextHost,
	plan: DailyPlan,
	triggerReason: string,
): Promise<AiOptimizationRequestContext> {
	const policyRaw = await readJson(host, "policy.global.effective_json");
	const allowedAddonIds = resolveAllowedAddonIds(host.config);
	const learning = await buildLearningDigest(host);
	return {
		generatedAt: new Date().toISOString(),
		timezone: plan.timezone,
		globalMode: plan.globalMode,
		allowedAddonIds,
		dailyPlan: digestFromDailyPlan(plan, allowedAddonIds),
		learning,
		policyHighlights: pickPolicyHighlights(policyRaw),
		triggerReason,
	};
}
