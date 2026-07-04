import type { PlannerBatteryDecision } from "./types";
import type { BatteryDeviceIntent } from "../addons/battery/core/types";
import { isChargingAction } from "../addons/battery/core/intent";

export function deviceIntentFromPlannerDecision(
	decision: PlannerBatteryDecision,
	revision: number,
	resolvedAt: string,
): BatteryDeviceIntent | null {
	if (decision.action === "none") return null;

	let action: BatteryDeviceIntent["action"];
	if (decision.action === "charge") {
		action = "charge";
	} else if (decision.action === "hold") {
		action = "hold";
	} else {
		action = "self_consumption";
	}

	return {
		requestId: `planner-${revision}`,
		action,
		targetSocPct: decision.target_soc_pct,
		maxChargeW: decision.action === "charge" && decision.max_charge_w > 0 ? decision.max_charge_w : null,
		maxDischargeW: null,
		energySource: decision.action === "charge" ? "pv" : "any",
		validFrom: null,
		validUntil: null,
		issuedAt: resolvedAt,
		reason: decision.reason_de,
		source: "planner",
	};
}

export function plannerWantsActiveBatteryIntent(decision: PlannerBatteryDecision): boolean {
	if (decision.action === "none") return false;
	if (decision.action === "charge") return isChargingAction("charge");
	return decision.action === "self_consumption" || decision.action === "hold";
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
