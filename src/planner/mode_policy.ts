import { DEFAULT_GLOBAL_MODE, type GlobalMode } from "../global_modes/constants";
import { isGlobalMode } from "../global_modes/config";

/** Default charge target used by balanced/comfort mode policies. */
export const PLANNER_BATTERY_TARGET_SOC_PCT = 95;

export interface PlannerModePolicy {
	mode: GlobalMode;
	/** false bei off — kein aktiver Planner-Auftrag. */
	allowOptimization: boolean;
	allowThermalAuto: boolean;
	allowPvCharge: boolean;
	/** comfort/forced: bei PV-Unterdeckung Eigenverbrauch mit Batterie explizit unterstützen. */
	supportBatteryOnDeficit: boolean;
	/** Mindest-SOC für Defizit-Unterstützung (comfort/forced). */
	batteryMinSocForDeficitPct: number;
	chargeTargetSocPct: number;
	/** >1 = höhere Überschuss-Anforderung (eco). */
	batterySurplusMinFactor: number;
	labelDe: string;
}

const MODE_POLICIES: Record<GlobalMode, PlannerModePolicy> = {
	off: {
		mode: "off",
		allowOptimization: false,
		allowThermalAuto: false,
		allowPvCharge: false,
		supportBatteryOnDeficit: false,
		batteryMinSocForDeficitPct: 100,
		chargeTargetSocPct: PLANNER_BATTERY_TARGET_SOC_PCT,
		batterySurplusMinFactor: 1,
		labelDe: "Off — keine Planner-Optimierung",
	},
	eco: {
		mode: "eco",
		allowOptimization: true,
		allowThermalAuto: true,
		allowPvCharge: true,
		supportBatteryOnDeficit: false,
		batteryMinSocForDeficitPct: 100,
		chargeTargetSocPct: 90,
		batterySurplusMinFactor: 1.15,
		labelDe: "Eco — nur PV-Überschuss, sparsames Laden",
	},
	balanced: {
		mode: "balanced",
		allowOptimization: true,
		allowThermalAuto: true,
		allowPvCharge: true,
		supportBatteryOnDeficit: false,
		batteryMinSocForDeficitPct: 100,
		chargeTargetSocPct: PLANNER_BATTERY_TARGET_SOC_PCT,
		batterySurplusMinFactor: 1,
		labelDe: "Balanced — Überschuss Heizstab, dann Batterie",
	},
	comfort: {
		mode: "comfort",
		allowOptimization: true,
		allowThermalAuto: true,
		allowPvCharge: true,
		supportBatteryOnDeficit: true,
		batteryMinSocForDeficitPct: 15,
		chargeTargetSocPct: PLANNER_BATTERY_TARGET_SOC_PCT,
		batterySurplusMinFactor: 1,
		labelDe: "Comfort — Batterie bei Wolken mitnutzen",
	},
	forced: {
		mode: "forced",
		allowOptimization: true,
		allowThermalAuto: true,
		allowPvCharge: true,
		supportBatteryOnDeficit: true,
		batteryMinSocForDeficitPct: 10,
		chargeTargetSocPct: 98,
		batterySurplusMinFactor: 1,
		labelDe: "Forced — maximale Eigenverbrauchs-Nutzung",
	},
};

export function plannerModePolicyFromGlobalMode(raw: unknown): PlannerModePolicy {
	const s = String(raw ?? "").trim().toLowerCase();
	if (isGlobalMode(s)) {
		return MODE_POLICIES[s];
	}
	return MODE_POLICIES[DEFAULT_GLOBAL_MODE];
}
