import type { PlannerBatteryDecision, PlannerConstraints } from "../types";
import { PLANNER_BATTERY_MIN_SURPLUS_W, PLANNER_BATTERY_TARGET_SOC_PCT } from "../inputs";

export interface BatteryPlanInput {
	surplusW: number | null;
	socPct: number | null;
	governanceEnabled: boolean;
	constraints: PlannerConstraints;
	thermalAllocatedW: number;
	targetSocPct?: number;
}

export function buildPlannerConstraints(input: {
	evccBatteryMode: string | null;
	evccBatteryDischargeControl: boolean | null;
	userIntentBatteryHold: boolean;
}): PlannerConstraints {
	const modeHold = (input.evccBatteryMode ?? "").toLowerCase() === "hold";
	const dischargeControl = input.evccBatteryDischargeControl === true;
	const evccHold = modeHold || dischargeControl || input.userIntentBatteryHold;

	const parts: string[] = [];
	if (input.userIntentBatteryHold) parts.push("user_intent hold");
	if (modeHold) parts.push(`EVCC batteryMode=${input.evccBatteryMode}`);
	if (dischargeControl) parts.push("EVCC Entladesteuerung aktiv");

	return {
		evcc_battery_hold: evccHold,
		evcc_battery_discharge_control: dischargeControl,
		reason_de: evccHold ? `Hausbatterie gesperrt: ${parts.join(", ")}.` : "Keine EVCC-/Intent-Sperre.",
	};
}

export function planBattery(input: BatteryPlanInput): PlannerBatteryDecision {
	const none = (reason: string): PlannerBatteryDecision => ({
		action: "none",
		max_charge_w: 0,
		target_soc_pct: null,
		reason_de: reason,
	});

	if (input.constraints.evcc_battery_hold) {
		return none(input.constraints.reason_de || "EVCC-Hold — Batterie-Planner pausiert.");
	}
	if (!input.governanceEnabled) {
		return none("Batterie-Governance deaktiviert.");
	}
	if (input.surplusW === null) {
		return none("PV-Überschuss unbekannt.");
	}

	const available = Math.max(0, Math.round(input.surplusW - input.thermalAllocatedW));
	if (available < PLANNER_BATTERY_MIN_SURPLUS_W) {
		return none(
			`Rest-Überschuss ${available} W nach Heizstab unter Minimum ${PLANNER_BATTERY_MIN_SURPLUS_W} W.`,
		);
	}

	const target = input.targetSocPct ?? PLANNER_BATTERY_TARGET_SOC_PCT;
	if (input.socPct !== null && input.socPct >= target) {
		return none(`SOC ${input.socPct.toFixed(0)} % ≥ Ziel ${target} % — kein Überschuss-Laden.`);
	}

	return {
		action: "charge",
		max_charge_w: available,
		target_soc_pct: target,
		reason_de: `PV-Überschuss-Laden: ${available} W bis ${target} % SOC (ohne Netz).`,
	};
}
