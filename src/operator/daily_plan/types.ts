import type {
	OperatorContributorRef,
	OperatorDataQuality,
	OperatorTimeSlot,
	PlanContribution,
} from "../types";
import type { BatteryConsumerAccess, BatteryConsumerId } from "../../policy/battery_consumers";

export type DailyPlanStatus = "ready" | "degraded" | "missing_inputs" | "disabled" | "error";

export type AllocationEnergySource = "pv_surplus" | "grid" | "battery" | "mixed" | "none";

export type AllocationStatus =
	| "allocated"
	| "partially_allocated"
	| "unallocated"
	| "disabled"
	| "blocked"
	| "unsupported"
	| "missing_data";

export interface DailyAllocationEntry {
	contributionId: string;
	contributor: OperatorContributorRef;

	slot: OperatorTimeSlot;

	status: AllocationStatus;
	energySource: AllocationEnergySource;

	requestedPowerW: number | null;
	allocatedPowerW: number | null;

	requestedEnergyKwh: number | null;
	allocatedEnergyKwh: number | null;

	gridPowerW: number;
	pvPowerW: number;
	/** House-battery share; optional in older fixtures → treat as 0. */
	batteryPowerW?: number;

	mandatory: boolean;
	priorityRank: number | null;
	deadlineIso: string | null;

	estimatedCostCt: number | null;

	reasonDe: string;
}

export interface DailyPlanSlot {
	slot: OperatorTimeSlot;

	pvForecastPowerW: number | null;
	fixedHouseLoadPowerW: number | null;
	fixedBalancePowerW: number | null;

	gridPriceCtPerKwh: number | null;
	gridImportAllowed: boolean;

	configuredGridImportLimitW: number | null;
	remainingGridImportPowerW: number | null;

	availablePvSurplusPowerW: number | null;

	allocatedFlexiblePowerW: number;
	allocatedPvPowerW: number;
	allocatedGridPowerW: number;
	allocatedBatteryPowerW: number;

	remainingPvSurplusPowerW: number | null;
	remainingGridImportPowerWAfterAlloc: number | null;
	remainingBatteryDischargePowerW: number | null;

	allocations: DailyAllocationEntry[];

	quality: OperatorDataQuality;
	reasonDe: string;
}

export interface DailyPlanTotals {
	pvForecastEnergyKwh: number | null;
	fixedHouseLoadEnergyKwh: number | null;
	fixedRenewableBalanceKwh: number | null;

	flexibleRequestedEnergyKwh: number | null;
	flexibleAllocatedEnergyKwh: number;
	flexibleUnallocatedEnergyKwh: number | null;

	pvAllocatedEnergyKwh: number;
	gridAllocatedEnergyKwh: number;

	batteryChargeEnergyKwh: number;
	wallboxEnergyKwh: number;
	immersionHeaterEnergyKwh: number;
	airConditioningEnergyKwh: number;

	estimatedGridCostCt: number | null;

	mandatoryRequestedEnergyKwh: number | null;
	mandatoryAllocatedEnergyKwh: number;
	mandatoryUnallocatedEnergyKwh: number | null;
}

export interface DailyPlanExcludedContribution {
	contributionId: string;
	reasonDe: string;
}

export interface DailyPlanUnallocated {
	contributionId: string;
	requestedEnergyKwh: number | null;
	allocatedEnergyKwh: number;
	unallocatedEnergyKwh: number | null;
	reasonDe: string;
}

export interface DailyPlan {
	generatedAt: string;
	validUntil: string | null;
	revision: number;

	date: string;
	timezone: string;
	slotMinutes: 15;

	globalMode: string;
	status: DailyPlanStatus;

	policySnapshot: Record<string, unknown>;
	constraintSnapshot: Record<string, unknown>;

	activeContributionIds: string[];
	excludedContributions: DailyPlanExcludedContribution[];

	slots: DailyPlanSlot[];
	allocations: DailyAllocationEntry[];
	unallocated: DailyPlanUnallocated[];
	totals: DailyPlanTotals;

	quality: OperatorDataQuality;
	reasonDe: string;
}

export interface AllocationCandidate {
	contribution: PlanContribution;
	contributionId: string;
	addonId: string;
	mandatory: boolean;
	forced: boolean;
	hasDeadline: boolean;
	deadlineIso: string | null;
	gridEligible: boolean;
	pvFirst: boolean;
	/** May draw house-battery energy when Operator gate allows. */
	batteryEligible: boolean;
	maxPowerW: number | null;
	/**
	 * Kleinste fahrbare Leistung (z. B. Heizstab-Stufe 1). Allocation darunter wird verworfen —
	 * keine Mikro-Slots, die die Runtime ohnehin nicht schalten kann.
	 */
	minPowerW: number | null;
	requiredEnergyKwh: number | null;
	priorityRank: number | null;
	policyOrder: number;
	priorityBand: number | null;
	allocatable: boolean;
	allocationStatus: AllocationStatus;
	reasonDe: string;
}

export type DailyPlanBuildInput = {
	now: Date;
	timezone: string;
	globalMode: string;
	forecastPlan: {
		slots: Array<{
			slot: OperatorTimeSlot;
			pvPowerW: number | null;
			houseLoadPowerW: number | null;
			fixedBalancePowerW: number | null;
			gridPriceCtPerKwh: number | null;
			gridImportAllowed: boolean;
			gridMaxImportPowerW: number | null;
		}>;
		days: Array<{
			date: string;
			pvEnergyKwh: number | null;
			houseLoadEnergyKwh: number | null;
			renewableBalanceKwh: number | null;
		}>;
		status: string;
	};
	contributions: PlanContribution[];
	policySnapshot: Record<string, unknown> | null;
	energyPriority: string[];
	mutualExclusions: Array<{ id: string; addonA: string; addonB: string; reason?: string }>;
	gridImportAllowedPolicy: boolean | null;
	effectiveMaxGridImportW: number | null;
	configuredHouseFuseLimitW: number | null;
	modePolicy: {
		mode: string;
		allowOptimization: boolean;
	};
	batteryConsumerAccess?: Partial<Record<BatteryConsumerId, BatteryConsumerAccess>>;
	batteryDischargeBudgetW?: number | null;
};
