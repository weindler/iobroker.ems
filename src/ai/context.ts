import { governedAddonEntry, governedAddonIds } from "../addons/governance/registry";
import { isAddonAiOptimizationAllowed, isAddonEnabled } from "../addons/governance/config";
import type { AiDailyPlanDigest, AiDigestSlot, AiOptimizationRequestContext } from "./types";
import type { DailyPlan, DailyPlanSlot } from "../operator/daily_plan/types";

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

/** Compact per-slot rows for immersion_heater/climate — nur befüllt, wenn eines der beiden freigegeben ist. */
function buildSlotDigest(plan: DailyPlan, allowedAddonIds: string[]): AiDigestSlot[] {
	const ihAllowed = allowedAddonIds.includes("immersion_heater");
	const acAllowed = allowedAddonIds.includes("climate");
	if (!ihAllowed && !acAllowed) return [];
	const ihPrefix = governedAddonEntry("immersion_heater").runtimeAddonId;
	const acPrefix = governedAddonEntry("climate").runtimeAddonId;
	return plan.slots.map((slot) => ({
		t: slot.slot.startIso,
		priceCtPerKwh: slot.gridPriceCtPerKwh,
		pvSurplusW: slot.availablePvSurplusPowerW,
		ihFlexW: ihAllowed ? Math.round(addonFlexPowerInSlot(slot, ihPrefix)) : 0,
		acW: acAllowed ? Math.round(addonFlexPowerInSlot(slot, acPrefix)) : 0,
	}));
}

function digestFromDailyPlan(plan: DailyPlan, allowedAddonIds: string[]): AiDailyPlanDigest {
	return {
		date: plan.date,
		globalMode: plan.globalMode,
		status: plan.status,
		activeContributionIds: plan.activeContributionIds,
		excludedContributionIds: plan.excludedContributions.map((e) => e.contributionId),
		totals: {
			pvForecastEnergyKwh: plan.totals.pvForecastEnergyKwh,
			flexibleAllocatedEnergyKwh: plan.totals.flexibleAllocatedEnergyKwh,
			flexibleUnallocatedEnergyKwh: plan.totals.flexibleUnallocatedEnergyKwh,
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

/** Nur ausgewählte, unkritische Policy-Kennzahlen — kein voller Snapshot (Tokens sparen, kein Leck von Rohdaten). */
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
	return {
		generatedAt: new Date().toISOString(),
		timezone: plan.timezone,
		globalMode: plan.globalMode,
		allowedAddonIds,
		dailyPlan: digestFromDailyPlan(plan, allowedAddonIds),
		policyHighlights: pickPolicyHighlights(policyRaw),
		triggerReason,
	};
}
