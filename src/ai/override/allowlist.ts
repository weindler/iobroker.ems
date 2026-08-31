/**
 * PHASE 6 — Erlaubte KI-Override-Parameter. Alles andere (insbesondere Safety) ist
 * unwiderruflich gesperrt. Die KI kann diese Liste nicht erweitern.
 */

import { DEFAULT_OPPORTUNITY_MARGIN_CT_PER_KWH } from "../../operator/daily_plan/battery_discharge_authority";
import type { AiOverrideBounds } from "./types";

export const AI_OVERRIDE_PARAM_BATTERY_OPPORTUNITY_MARGIN_CT = "battery.opportunity_margin_ct";

export const AI_OVERRIDEABLE_PARAMETERS: Record<string, AiOverrideBounds> = {
	[AI_OVERRIDE_PARAM_BATTERY_OPPORTUNITY_MARGIN_CT]: {
		minValue: 0,
		maxValue: 10,
		maxChangePerStepAbs: 2,
		minConfidencePct: 70,
		minSampleCount: 1,
		maxDataAgeDays: 14,
		ttlMs: 24 * 60 * 60 * 1000,
	},
};

export function boundsForOverrideParameter(parameter: string): AiOverrideBounds | null {
	return AI_OVERRIDEABLE_PARAMETERS[parameter] ?? null;
}

export function defaultOriginalValueForParameter(parameter: string): number | null {
	if (parameter === AI_OVERRIDE_PARAM_BATTERY_OPPORTUNITY_MARGIN_CT) {
		return DEFAULT_OPPORTUNITY_MARGIN_CT_PER_KWH;
	}
	return null;
}

/** Wirksame Opportunity-Marge: validierter Override ersetzt die Basis, sonst bleibt die Basis. */
export function mergeOpportunityMarginWithOverride(
	baseMarginCt: number,
	overrideValue: number | null,
): number {
	if (overrideValue === null || !Number.isFinite(overrideValue)) return baseMarginCt;
	return Math.max(0, overrideValue);
}
