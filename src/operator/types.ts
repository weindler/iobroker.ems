import type { EmsAddonId } from "../addons/registry";

export type PlanRole =
	| "supply"
	| "demand_fixed"
	| "demand_flex"
	| "constraint"
	| "storage"
	| "dispatch"
	| "infrastructure"
	| "context";

export type OperatorContributorType = "addon" | "system";

export type OperatorSystemContributorId = "house_load" | "grid_supply" | "global_constraints";

export interface OperatorContributorRef {
	type: OperatorContributorType;
	id: EmsAddonId | OperatorSystemContributorId;
	addonId: EmsAddonId | null;
}

export type OperatorDataStatus =
	| "valid"
	| "degraded"
	| "missing"
	| "disabled"
	| "invalid"
	| "blocked"
	| "unsupported";

export type PlanContributionFlow = "consume" | "provide" | "constraint" | "context";

export interface OperatorDataQuality {
	status: OperatorDataStatus;
	confidencePct: number | null;
	reasonDe: string;
}

export interface OperatorTimeSlot {
	startIso: string;
	endIso: string;
}

export interface PlanSlotContribution {
	slot: OperatorTimeSlot;
	minPowerW: number | null;
	preferredPowerW: number | null;
	maxPowerW: number | null;
	requiredEnergyKwh: number | null;
	availableEnergyKwh: number | null;
	priceCtPerKwh: number | null;
	available: boolean;
	mandatory: boolean;
	quality: OperatorDataQuality;
}

export interface PlanContribution {
	contributionId: string;
	contributor: OperatorContributorRef;
	flow: PlanContributionFlow;
	roles: PlanRole[];
	generatedAt: string;
	validUntil: string | null;
	revision: number;
	enabled: boolean;
	flexible: boolean;
	gridEligible: boolean;
	priorityBand: number | null;
	deadlineIso: string | null;
	slots: PlanSlotContribution[];
	quality: OperatorDataQuality;
	reasonDe: string;
	details: Record<string, unknown>;
}

export interface OperatorAddonRegistration {
	addonId: EmsAddonId;
	roles: PlanRole[];
	canContributeToPlan: boolean;
	canDispatch: boolean;
	requiresGovernance: boolean;
}

export type GridSupplySource = import("../grid_supply/types").GridSupplySource;
export type GridPriceLabel = import("../grid_supply/types").GridPriceLabel;
export type GridSupplySlot = import("../grid_supply/types").GridSupplySlot;
export type GridSupplyForecast = import("../grid_supply/types").GridSupplyForecast;

export type ForecastPlanStatus =
	| "ready"
	| "degraded"
	| "missing_inputs"
	| "disabled"
	| "error";

export interface ForecastPlanDay {
	date: string;

	pvEnergyKwh: number | null;
	houseLoadEnergyKwh: number | null;

	renewableBalanceKwh: number | null;

	weatherMinTempC: number | null;
	weatherMaxTempC: number | null;

	quality: OperatorDataQuality;
	reasonDe: string;
}

export interface ForecastPlanSlot {
	slot: OperatorTimeSlot;

	pvPowerW: number | null;
	houseLoadPowerW: number | null;

	fixedBalancePowerW: number | null;

	gridPriceCtPerKwh: number | null;
	gridImportAllowed: boolean;
	gridMaxImportPowerW: number | null;

	outdoorTempC: number | null;

	quality: OperatorDataQuality;
	reasonDe: string;
}
