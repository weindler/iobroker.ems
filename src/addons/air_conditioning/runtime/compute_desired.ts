/**
 * Eine kanonische Desired-Authority für Climate-Cooling.
 *
 * Plan beantwortet: Budget im aktuellen Slot?
 * Demand beantwortet: Kühlbedarf / Abschaltbedarf?
 * Ergebnis: on | off | hold | idle — keine zweite parallele Authority.
 */

import type { AcDecisionSource, AcUnitDailyPlanResolution } from "./daily_plan";
import type { AcUnitFsmResult } from "./fsm";
import type { AcCoolingDesired } from "./stop_intent";

export interface ComputeAcCoolingDesiredInput {
	unitEnabled: boolean;
	governanceEnabled: boolean;
	addonEnabled: boolean;
	cleaningActive: boolean;
	fsm: AcUnitFsmResult;
	dailyPlan: AcUnitDailyPlanResolution;
	feedbackOn: boolean;
	startRetryReady: boolean;
}

export interface AcCoolingControlDecision {
	desired: AcCoolingDesired;
	allowStart: boolean;
	allowStop: boolean;
	allowCleaningWrites: boolean;
	deviceWritesAllowed: boolean;
	decisionSource: AcDecisionSource;
	reasonDe: string;
	/** Explizites Plan-Budget > 0 im aktuellen Slot. */
	plannerBudgetOn: boolean;
	/**
	 * Explizites Planner-OFF: gültiger Plan mit Allocation-Eintrag und Leistung ≤ 0.
	 * Status „none“ (kein NOW-Eintrag, z. B. Runtime-Hold) ist KEIN Planner-OFF.
	 */
	plannerOff: boolean;
	/** Kein NOW-Eintrag bei gültigem Plan — laufendes Gerät halten, nicht neu starten. */
	slotBudgetMissing: boolean;
}

/** Expliziter 0-W-Eintrag (nicht: fehlender Slot-Eintrag). */
export function isExplicitPlannerOff(dailyPlan: AcUnitDailyPlanResolution): boolean {
	if (!dailyPlan.useDailyPlan) return false;
	if (dailyPlan.allocatedPowerW === null || !Number.isFinite(dailyPlan.allocatedPowerW)) return false;
	if (dailyPlan.allocatedPowerW > 0) return false;
	const st = dailyPlan.allocationStatus;
	// „none“ / „missing“ / „unknown“ = kein Eintrag → kein autoritatives OFF
	if (st === "none" || st === "missing" || st === "unknown" || st === "") return false;
	return true;
}

export function isPlannerBudgetOn(dailyPlan: AcUnitDailyPlanResolution): boolean {
	return (
		dailyPlan.useDailyPlan &&
		dailyPlan.allocatedPowerW !== null &&
		Number.isFinite(dailyPlan.allocatedPowerW) &&
		dailyPlan.allocatedPowerW > 0
	);
}

export function isSlotBudgetMissing(dailyPlan: AcUnitDailyPlanResolution): boolean {
	return dailyPlan.useDailyPlan && dailyPlan.allocationStatus === "none";
}

/**
 * Einzige Desired-Funktion. Alle START/STOP/HOLD-Entscheidungen leiten sich daraus ab.
 */
export function computeAcCoolingDesired(input: ComputeAcCoolingDesiredInput): AcCoolingControlDecision {
	const {
		unitEnabled,
		governanceEnabled,
		addonEnabled,
		cleaningActive,
		fsm,
		dailyPlan,
		feedbackOn,
		startRetryReady,
	} = input;

	const deviceWritesAllowed = governanceEnabled && addonEnabled;
	const plannerBudgetOn = isPlannerBudgetOn(dailyPlan);
	const plannerOff = isExplicitPlannerOff(dailyPlan);
	const slotBudgetMissing = isSlotBudgetMissing(dailyPlan);

	const base = {
		allowCleaningWrites: deviceWritesAllowed,
		deviceWritesAllowed,
		plannerBudgetOn,
		plannerOff,
		slotBudgetMissing,
	};

	if (!unitEnabled) {
		return {
			...base,
			desired: feedbackOn && deviceWritesAllowed ? "off" : "idle",
			allowStart: false,
			allowStop: deviceWritesAllowed && (fsm.demandStop || feedbackOn),
			decisionSource: "unit_disabled",
			reasonDe: "Innengerät deaktiviert.",
			allowCleaningWrites: false,
		};
	}

	if (!governanceEnabled) {
		return {
			...base,
			desired: "idle",
			allowStart: false,
			allowStop: false,
			decisionSource: "governance_disabled",
			reasonDe: "Klima-Governance deaktiviert — keine EMS-Steueraktion.",
			deviceWritesAllowed: false,
			allowCleaningWrites: false,
		};
	}

	if (!addonEnabled) {
		return {
			...base,
			desired: feedbackOn ? "off" : "idle",
			allowStart: false,
			allowStop: fsm.demandStop || feedbackOn,
			decisionSource: "unit_disabled",
			reasonDe: "Klima-Add-on deaktiviert.",
			allowCleaningWrites: false,
			deviceWritesAllowed: false,
		};
	}

	if (cleaningActive) {
		return {
			...base,
			desired: "idle",
			allowStart: false,
			allowStop: false,
			decisionSource: "cleaning",
			reasonDe: fsm.reasonDe,
		};
	}

	// --- Explizites Planner-OFF: Desired OFF (Demand darf das nicht zu HOLD umbiegen) ---
	if (plannerOff) {
		return {
			...base,
			desired: feedbackOn ? "off" : "idle",
			allowStart: false,
			allowStop: feedbackOn && deviceWritesAllowed,
			decisionSource: "daily_plan",
			reasonDe: dailyPlan.allocationReasonDe || "Planner-OFF für diesen Slot.",
		};
	}

	// --- Demand-Stop (Komfort erreicht / Fenster / Hard-off) ---
	if (fsm.demandStop) {
		return {
			...base,
			desired: feedbackOn ? "off" : "idle",
			allowStart: false,
			allowStop: feedbackOn && deviceWritesAllowed,
			decisionSource: dailyPlan.useDailyPlan ? "daily_plan" : "climate_fallback",
			reasonDe: fsm.reasonDe,
		};
	}

	// --- Start-Rate-Limit: blockiert nur START, erzeugt kein OFF ---
	if (fsm.demandStart && !feedbackOn && !startRetryReady) {
		return {
			...base,
			desired: "idle",
			allowStart: false,
			allowStop: false,
			decisionSource: "rate_limited",
			reasonDe: "Start-Rate-Limit aktiv.",
		};
	}

	// --- Planner-Budget oder Fallback: Start ---
	if (fsm.demandStart && !feedbackOn) {
		if (dailyPlan.useDailyPlan) {
			if (plannerBudgetOn && dailyPlan.allocationAllowsStart) {
				return {
					...base,
					desired: "on",
					allowStart: deviceWritesAllowed,
					allowStop: false,
					decisionSource: "daily_plan",
					reasonDe: `${fsm.reasonDe} Daily Plan: ${dailyPlan.allocatedPowerW} W freigegeben.`,
				};
			}
			// Slot fehlt (none) oder Budget blockiert — kein Start aus Plan, kein Fake-OFF
			return {
				...base,
				desired: "idle",
				allowStart: false,
				allowStop: false,
				decisionSource: "daily_plan",
				reasonDe: dailyPlan.allocationReasonDe || fsm.reasonDe,
			};
		}
		return {
			...base,
			desired: "idle",
			allowStart: false,
			allowStop: false,
			decisionSource: "climate_fallback",
			reasonDe: "One-Plan-Fallback: Daily Plan nicht nutzbar, daher kein lokaler Klima-Start.",
		};
	}

	// --- Gerät läuft, kein Demand-Stop ---
	if (feedbackOn) {
		if (plannerBudgetOn || !dailyPlan.useDailyPlan || slotBudgetMissing) {
			/*
			 * slotBudgetMissing: typisch Runtime-Hold (NOW ohne Climate-Zelle).
			 * Läuft weiter bis Demand-Stop oder explizites Planner-OFF.
			 */
			return {
				...base,
				desired: "hold",
				allowStart: false,
				allowStop: false,
				/*
				 * temperature_no_demand = laufend/kein neuer Startbedarf (VIS/Hold).
				 * Nicht mit „Planner-OFF“ verwechseln — Desired ist hold.
				 */
				decisionSource: "temperature_no_demand",
				reasonDe: plannerBudgetOn
					? `Daily Plan stellt ${dailyPlan.allocatedPowerW} W bereit — Kühlung läuft.`
					: slotBudgetMissing
						? "Kein NOW-Allocation-Eintrag — laufendes Gerät halten (kein Planner-OFF)."
						: fsm.reasonDe,
			};
		}
	}

	// --- Idle ---
	if (dailyPlan.useDailyPlan && plannerBudgetOn) {
		return {
			...base,
			desired: "idle",
			allowStart: false,
			allowStop: false,
			decisionSource: "temperature_no_demand",
			reasonDe: `Daily Plan stellt ${dailyPlan.allocatedPowerW} W bereit, aktuell kein Kühlbedarf.`,
		};
	}

	return {
		...base,
		desired: "idle",
		allowStart: false,
		allowStop: false,
		decisionSource: dailyPlan.useDailyPlan ? "daily_plan" : "climate_fallback",
		reasonDe: dailyPlan.allocationReasonDe || fsm.reasonDe,
	};
}

/** Map Control-Decision → legacy Permission-Shape (Tests / Surface). */
export function controlToPermission(d: AcCoolingControlDecision): {
	decisionSource: AcDecisionSource;
	reasonDe: string;
	allowStart: boolean;
	allowStop: boolean;
	allowCleaningWrites: boolean;
	deviceWritesAllowed: boolean;
} {
	return {
		decisionSource: d.decisionSource,
		reasonDe: d.reasonDe,
		allowStart: d.allowStart,
		allowStop: d.allowStop,
		allowCleaningWrites: d.allowCleaningWrites,
		deviceWritesAllowed: d.deviceWritesAllowed,
	};
}
