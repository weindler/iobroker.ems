import { governedAddonIds } from "../addons/governance/registry";
import { isAddonAiOptimizationAllowed, isAddonEnabled } from "../addons/governance/config";
import type { AiDailyPlanDigest, AiOptimizationRequestContext } from "./types";
import type { DailyPlan } from "../operator/daily_plan/types";

export type ContextHost = {
	config: unknown;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
};

/** Nur Add-ons, die aktiv UND per Governance für KI-Optimierung freigegeben sind — sonst darf die KI sie nicht mal erwähnen. */
export function resolveAllowedAddonIds(config: unknown): string[] {
	return governedAddonIds().filter((id) => isAddonEnabled(config, id) && isAddonAiOptimizationAllowed(config, id));
}

function digestFromDailyPlan(plan: DailyPlan): AiDailyPlanDigest {
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
	return {
		generatedAt: new Date().toISOString(),
		timezone: plan.timezone,
		globalMode: plan.globalMode,
		allowedAddonIds: resolveAllowedAddonIds(host.config),
		dailyPlan: digestFromDailyPlan(plan),
		policyHighlights: pickPolicyHighlights(policyRaw),
		triggerReason,
	};
}
