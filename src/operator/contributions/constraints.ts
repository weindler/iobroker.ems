import type { GridSupplyForecast, PlanContribution } from "../types";
import { operatorQuality } from "../quality";
import { addonContributorRef, systemContributorRef } from "../contributor";
import { CONTRIBUTION_IDS } from "../contribution_ids";
import { baseContribution, houseMainFuseAddonId } from "./types";

export interface ConstraintContributionBuildInput {
	now: Date;
	globalMode: string | null;
	configuredHouseFuseLimitW: number | null;
	configuredMaxGridImportW: number | null;
	effectiveMaxGridImportW: number | null;
	gridImportAllowed: boolean;
	gridSupplyQuality: GridSupplyForecast["quality"];
}

export function buildHouseMainFuseConstraintContribution(
	input: ConstraintContributionBuildInput,
): PlanContribution {
	const generatedAt = input.now.toISOString();
	const hasLimits =
		input.configuredHouseFuseLimitW !== null || input.configuredMaxGridImportW !== null;

	let status: "valid" | "degraded" | "missing" = "missing";
	let reasonDe = "Keine konfigurierten Netz- oder Sicherungsgrenzen.";

	if (hasLimits) {
		status = "valid";
		reasonDe = "Konfigurierte Hausanschluss- und Netzimportgrenzen.";
	}

	return baseContribution(
		CONTRIBUTION_IDS.HOUSE_MAIN_FUSE,
		addonContributorRef(houseMainFuseAddonId()),
		"constraint",
		["constraint"],
		{
		generatedAt,
		validUntil: null,
		revision: 1,
		enabled: hasLimits,
		flexible: false,
		gridEligible: false,
		quality: operatorQuality(status, reasonDe),
		reasonDe,
		details: {
			configuredHouseFuseLimitW: input.configuredHouseFuseLimitW,
			configuredMaxGridImportW: input.configuredMaxGridImportW,
			noteDe: "Aktuelle Hauslast wird noch nicht vom Sicherungslimit abgezogen.",
		},
		slots: [],
	});
}

export function buildGlobalConstraintsContribution(
	input: ConstraintContributionBuildInput,
): PlanContribution {
	const generatedAt = input.now.toISOString();
	const hasEffective =
		input.effectiveMaxGridImportW !== null ||
		input.gridImportAllowed !== undefined ||
		input.globalMode !== null;

	let status: "valid" | "degraded" | "missing" = "missing";
	let reasonDe = "Keine effektiven globalen Netzlimits verfügbar.";

	if (hasEffective) {
		status = input.gridSupplyQuality.status === "valid" ? "valid" : "degraded";
		reasonDe = `Effektive Grenzen nach Global Mode (${input.globalMode ?? "unbekannt"}).`;
	}

	return baseContribution(
		CONTRIBUTION_IDS.GLOBAL_CONSTRAINTS,
		systemContributorRef("global_constraints"),
		"constraint",
		["constraint"],
		{
		generatedAt,
		validUntil: null,
		revision: 1,
		enabled: hasEffective,
		flexible: false,
		gridEligible: false,
		quality: operatorQuality(status, reasonDe, input.gridSupplyQuality.confidencePct),
		reasonDe,
		details: {
			globalMode: input.globalMode,
			effectiveMaxGridImportW: input.effectiveMaxGridImportW,
			gridImportAllowed: input.gridImportAllowed,
			gridSupplyStatus: input.gridSupplyQuality.status,
			noteDe: "Keine Phasenverteilung oder dynamische Verbraucher-Allocation.",
		},
		slots: [],
	});
}

export function buildGridSupplyContribution(
	grid: GridSupplyForecast,
): PlanContribution {
	const hasData =
		grid.slots.length > 0 ||
		grid.currentPriceCtPerKwh !== null ||
		grid.effectiveMaxGridImportW !== null;

	const slots = grid.slots.map((s) => ({
		slot: { startIso: s.startIso, endIso: s.endIso },
		minPowerW: null,
		preferredPowerW: null,
		maxPowerW: s.maxImportPowerW,
		requiredEnergyKwh: null,
		availableEnergyKwh: null,
		priceCtPerKwh: s.priceCtPerKwh,
		available: s.importAllowed,
		mandatory: false,
		quality: s.quality,
	}));

	return baseContribution(
		CONTRIBUTION_IDS.GRID_SUPPLY,
		systemContributorRef("grid_supply"),
		"context",
		["infrastructure"],
		{
		generatedAt: grid.generatedAt,
		validUntil: grid.validUntil,
		revision: 1,
		enabled: hasData,
		flexible: false,
		gridEligible: true,
		quality: grid.quality,
		reasonDe: grid.reasonDe,
		details: {
			source: grid.source,
			currentPriceCtPerKwh: grid.currentPriceCtPerKwh,
			gridImportAllowed: grid.gridImportAllowed,
			configuredMaxGridImportW: grid.configuredMaxGridImportW,
			configuredHouseFuseLimitW: grid.configuredHouseFuseLimitW,
			effectiveMaxGridImportW: grid.effectiveMaxGridImportW,
			slotCount: grid.slots.length,
		},
		slots,
	});
}
