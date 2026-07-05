import type { PlannerBatteryDecision, PlannerConstraints } from "../types";
import type { PlannerModePolicy } from "../mode_policy";
import { PLANNER_BATTERY_MIN_SURPLUS_W, PLANNER_SURPLUS_MIN_W } from "../inputs";

export interface BatteryPlanInput {
	surplusW: number | null;
	deficitW: number | null;
	socPct: number | null;
	governanceEnabled: boolean;
	constraints: PlannerConstraints;
	/** Reservierte Leistung für Verbraucher (Heizstab + Klima + spätere Add-ons). */
	consumerAllocatedW: number;
	modePolicy: PlannerModePolicy;
}

export function buildPlannerConstraints(input: {
	evccBatteryMode: string | null;
	evccBatteryDischargeControl: boolean | null;
	userIntentBatteryHold: boolean;
}): PlannerConstraints {
	const modeHold = (input.evccBatteryMode ?? "").toLowerCase() === "hold";
	const dischargeControl = input.evccBatteryDischargeControl === true;
	const userHold = input.userIntentBatteryHold;
	const batteryHoldActive = modeHold || dischargeControl || userHold;

	const parts: string[] = [];
	if (userHold) parts.push("user_intent hold (z. B. günstiger Strompreis)");
	if (modeHold) parts.push(`EVCC batteryMode=${input.evccBatteryMode}`);
	if (dischargeControl) parts.push("EVCC Entladesteuerung aktiv");

	return {
		evcc_battery_hold: modeHold || dischargeControl,
		evcc_battery_discharge_control: dischargeControl,
		user_intent_battery_hold: userHold,
		battery_hold_active: batteryHoldActive,
		reason_de: batteryHoldActive
			? `Hausbatterie gesperrt: ${parts.join(", ")}.`
			: "Keine EVCC-/Intent-Sperre.",
	};
}

export function computeDeficitW(pvPowerW: number | null, houseLoadW: number | null): number | null {
	if (pvPowerW === null || houseLoadW === null) return null;
	if (!Number.isFinite(pvPowerW) || !Number.isFinite(houseLoadW)) return null;
	return Math.max(0, Math.round(houseLoadW - pvPowerW));
}

export function planBattery(input: BatteryPlanInput): PlannerBatteryDecision {
	const none = (reason: string): PlannerBatteryDecision => ({
		action: "none",
		max_charge_w: 0,
		target_soc_pct: null,
		reason_de: reason,
	});

	if (!input.modePolicy.allowOptimization) {
		return none(`${input.modePolicy.labelDe} — kein Batterie-Auftrag.`);
	}
	if (input.constraints.battery_hold_active) {
		return {
			action: "hold",
			max_charge_w: 0,
			target_soc_pct: null,
			reason_de: input.constraints.reason_de || "Batterie-Hold aktiv — Planner greift nicht ein.",
		};
	}
	if (!input.governanceEnabled) {
		return none("Batterie-Governance deaktiviert.");
	}

	const minSurplus = Math.round(
		PLANNER_BATTERY_MIN_SURPLUS_W * input.modePolicy.batterySurplusMinFactor,
	);

	if (
		input.modePolicy.supportBatteryOnDeficit &&
		input.deficitW !== null &&
		input.deficitW >= PLANNER_SURPLUS_MIN_W
	) {
		if (input.socPct !== null && input.socPct < input.modePolicy.batteryMinSocForDeficitPct) {
			return none(
				`SOC ${input.socPct.toFixed(0)} % unter Reserve ${input.modePolicy.batteryMinSocForDeficitPct} % — keine Entladung.`,
			);
		}
		return {
			action: "self_consumption",
			max_charge_w: 0,
			target_soc_pct: null,
			reason_de: `${input.modePolicy.labelDe}: PV-Unterdeckung ${input.deficitW} W — Batterie für Eigenverbrauch.`,
		};
	}

	if (!input.modePolicy.allowPvCharge) {
		return none(`${input.modePolicy.labelDe} — kein Überschuss-Laden.`);
	}
	if (input.surplusW === null) {
		return none("PV-Überschuss unbekannt.");
	}

	const available = Math.max(0, Math.round(input.surplusW - input.consumerAllocatedW));
	if (available < minSurplus) {
		return none(
			`Rest-Überschuss ${available} W nach Verbrauchern unter Minimum ${minSurplus} W (${input.modePolicy.mode}).`,
		);
	}

	const target = input.modePolicy.chargeTargetSocPct;
	if (input.socPct !== null && input.socPct >= target) {
		return none(`SOC ${input.socPct.toFixed(0)} % ≥ Ziel ${target} % — kein Überschuss-Laden.`);
	}

	return {
		action: "charge",
		max_charge_w: available,
		target_soc_pct: target,
		reason_de: `PV-Überschuss-Laden (${input.modePolicy.mode}): ${available} W bis ${target} % SOC (ohne Netz).`,
	};
}
