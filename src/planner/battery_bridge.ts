import type { PlannerBatteryDecision } from "./types";
import type { BatteryDeviceIntent } from "../addons/battery/core/types";

export function deviceIntentFromPlannerDecision(
	decision: PlannerBatteryDecision,
	revision: number,
	resolvedAt: string,
): BatteryDeviceIntent | null {
	if (decision.action !== "charge") return null;
	return {
		requestId: `planner-${revision}`,
		action: "charge",
		targetSocPct: decision.target_soc_pct,
		maxChargeW: decision.max_charge_w > 0 ? decision.max_charge_w : null,
		maxDischargeW: null,
		energySource: "pv",
		validFrom: null,
		validUntil: null,
		issuedAt: resolvedAt,
		reason: decision.reason_de,
		source: "planner",
	};
}

export function parsePlannerIntentJson(raw: unknown): {
	revision: number;
	resolved_at: string;
	battery: PlannerBatteryDecision;
} | null {
	if (!raw) return null;
	try {
		const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
		if (!parsed || typeof parsed !== "object") return null;
		const p = parsed as Record<string, unknown>;
		if (p.schema_version !== 1) return null;
		const battery = p.battery as PlannerBatteryDecision | undefined;
		if (!battery || typeof battery !== "object") return null;
		return {
			revision: typeof p.revision === "number" ? p.revision : 0,
			resolved_at: typeof p.resolved_at === "string" ? p.resolved_at : new Date().toISOString(),
			battery,
		};
	} catch {
		return null;
	}
}
