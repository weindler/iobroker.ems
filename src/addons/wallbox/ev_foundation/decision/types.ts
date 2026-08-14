/**
 * Phase 3 takeover decision types (diagnostic only — no writes).
 * Planner/decision code sees only the neutral EV model, never vendor state IDs.
 */

import type {
	EvExternalAuthorityState,
	EvModuleState,
	EvTakeoverReason,
	EvTakeoverSeverity,
} from "../types";

export const EV_TAKEOVER_OUTCOMES = [
	"external",
	"ems_takeover_required",
	"ems_takeover_recommended",
	"no_external_control",
	"insufficient_data",
	"not_applicable",
] as const;

export type EvTakeoverOutcome = (typeof EV_TAKEOVER_OUTCOMES)[number];

export const EV_CHARGE_POWER_SOURCES = [
	"vehicle_max_ac",
	"evcc_current_phases",
	"evcc_capped_by_vehicle",
	"unknown",
] as const;

export type EvChargePowerSource = (typeof EV_CHARGE_POWER_SOURCES)[number];

export interface EvPriceWindow {
	startMs: number;
	endMs: number;
	importCtPerKwh: number;
}

export interface EvChargePowerResolution {
	chargePowerKw: number | null;
	source: EvChargePowerSource;
	vehicleMaxAcKw: number | null;
	evccDerivedKw: number | null;
	phasesUsed: number | null;
	currentAUsed: number | null;
}

export interface EvEnergyNeed {
	energyToTargetKWh: number | null;
	energyToDepartureMinimumKWh: number | null;
	requiredChargingMinutes: number | null;
	efficiencyUsed: number | null;
}

export interface EvPlanCoverage {
	externalPlanRemainingEnergyKWh: number | null;
	externalPlanRemainingMinutes: number | null;
	externalPlanExpectedSocGainPct: number | null;
	externalPlanExpectedFinalSocPct: number | null;
	externalPlanCoversTarget: boolean | null;
	externalPlanCoversDepartureMinimum: boolean | null;
	remainingEnergyEstimated: boolean;
}

export interface EvTakeoverDecision {
	outcome: EvTakeoverOutcome;
	externalAuthorityState: EvExternalAuthorityState;
	energyToTargetKWh: number | null;
	energyToDepartureMinimumKWh: number | null;
	requiredChargingMinutes: number | null;
	latestRequiredStart: string | null;
	deadlineIso: string | null;
	deadlineRisk: boolean | null;
	externalPlanExpectedSocGainPct: number | null;
	externalPlanExpectedFinalSocPct: number | null;
	externalPlanCoversTarget: boolean | null;
	externalPlanCoversDepartureMinimum: boolean | null;
	remainingFeasibleEnergyKWh: number | null;
	remainingCheapEnergyKWh: number | null;
	cheapWindowEnergyCapacityKWh: number | null;
	economicWindowLossRisk: boolean | null;
	takeoverRecommended: boolean;
	takeoverRequired: boolean;
	takeoverSeverity: EvTakeoverSeverity;
	takeoverReason: EvTakeoverReason | null;
	recommendedEvState: EvModuleState;
	chargePower: EvChargePowerResolution;
	explain: Record<string, unknown>;
}
