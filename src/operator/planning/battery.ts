import type { PlannerBatteryDecision, PlannerConstraints } from "../../planner/types";
import type { PlannerModePolicy } from "../../planner/mode_policy";
import { isEvccBatteryHoldMode } from "../../addons/battery/hold_freshness";

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
	/** Wallbox Boost/externes Laden — nicht MinPV/PV. */
	wallboxChargeHold?: boolean;
	wallboxChargeHoldReasonDe?: string | null;
}): PlannerConstraints {
	const modeHold = isEvccBatteryHoldMode(input.evccBatteryMode);
	const dischargeControl = input.evccBatteryDischargeControl === true;
	const userHold = input.userIntentBatteryHold;
	const wallboxHold = input.wallboxChargeHold === true;
	const batteryHoldActive = modeHold || userHold || wallboxHold;

	const parts: string[] = [];
	if (userHold) parts.push("user_intent hold (z. B. günstiger Strompreis)");
	if (modeHold) parts.push(`EVCC batteryMode=${input.evccBatteryMode}`);
	if (wallboxHold) {
		const frag = (input.wallboxChargeHoldReasonDe ?? "").trim();
		parts.push(frag || "Wallbox Boost/externes Fahrzeugladen");
	}

	return {
		evcc_battery_hold: modeHold,
		evcc_battery_discharge_control: dischargeControl,
		user_intent_battery_hold: userHold,
		battery_hold_active: batteryHoldActive,
		reason_de: batteryHoldActive
			? `Hausbatterie gesperrt: ${parts.join(", ")}.`
			: "Keine EVCC-/Intent-Sperre.",
		battery_consumer_immersion_allowed: false,
		battery_consumer_immersion_reason_de: "",
		battery_consumer_climate_allowed: false,
		battery_consumer_climate_reason_de: "",
		battery_consumer_wallbox_allowed: false,
		battery_consumer_wallbox_reason_de: "",
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

	// Sonnen Mode 2 übernimmt PV-Laden/Entladung. Der Planner steuert die Batterie nicht
	// mehr per Mode-1-FSM (kein Dryrun-/Live-Charge aus Überschuss). Ausnahmen: Winter-Netz
	// (planner.intent.battery.winter.*, read-only) und später user_intent / Netzausgleich.
	return none(
		`${input.modePolicy.labelDe} — Sonnen Mode 2 passiv; kein Planner-PV-Laden (Winter: planner.intent.battery.winter.*).`,
	);
}
