import type { EmsAddonId } from "../addons/registry";

export type PlanRole =
	| "supply"
	| "demand_fixed"
	| "demand_flex"
	| "constraint"
	| "storage"
	| "dispatch"
	| "infrastructure";

export type OperatorDataStatus = "valid" | "degraded" | "missing" | "disabled" | "invalid";

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
	addonId: EmsAddonId;
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

export type GridSupplySource = "dynamic_tariff" | "fixed_tariff" | "none";

export type GridPriceLabel = "cheap" | "normal" | "expensive" | null;

export interface GridSupplySlot {
	startIso: string;
	endIso: string;
	priceCtPerKwh: number | null;
	importAllowed: boolean;
	maxImportPowerW: number | null;
	priceLabel: GridPriceLabel;
	quality: OperatorDataQuality;
}

export interface GridSupplyForecast {
	generatedAt: string;
	validUntil: string | null;
	source: GridSupplySource;
	currentPriceCtPerKwh: number | null;
	gridImportAllowed: boolean;
	configuredMaxGridImportW: number | null;
	configuredHouseFuseLimitW: number | null;
	effectiveMaxGridImportW: number | null;
	slots: GridSupplySlot[];
	quality: OperatorDataQuality;
	reasonDe: string;
}
