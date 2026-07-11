import { deriveEnergy, resolveCapacity } from "../../../addons/battery/core/capacity";
import { CONTRIBUTION_IDS } from "../../contribution_ids";
import type { PlanContribution } from "../../types";
import { operatorQuality } from "../../quality";
import { addonContributorRef } from "../../contributor";
import type { PlannerModePolicy } from "../../../planner/mode_policy";
import type { GridSupplyForecast } from "../../types";
import { baseContribution } from "../types";
import { evaluateParticipation, round3 } from "./types";

export interface BatteryContributionBuildInput {
	now: Date;
	addonEnabled: boolean;
	governanceEnabled: boolean;
	globalModeOff: boolean;
	modePolicy: PlannerModePolicy;
	gridForecast: GridSupplyForecast | null;
	profileId: string;
	socPct: number | null;
	capacityManualKwh: number | null;
	capacityMappedKwh: number | null;
	capacitySource: string | null;
	minSocPct: number | null;
	maxSocPct: number | null;
	maxChargeW: number | null;
	chargeCapable: boolean;
	dischargeCapable: boolean;
	fault: boolean;
	lockout: boolean;
	telemetryValid: boolean;
	telemetryStale: boolean;
	mappingsReady: boolean;
	topOffRequested: boolean;
	ownershipActive: boolean;
	winterGridActive: boolean;
}

function chargeTargetSocPct(input: BatteryContributionBuildInput): number {
	if (input.topOffRequested) return 100;
	return input.modePolicy.chargeTargetSocPct;
}

function requiredChargeEnergyKwh(input: BatteryContributionBuildInput): number | null {
	const cap = resolveCapacity({
		source: input.capacitySource === "mapped" ? "mapped" : "manual",
		manualKwh: input.capacityManualKwh,
		mappedKwh: input.capacityMappedKwh,
	});
	if (!cap.valid || cap.effectiveKwh === null || input.socPct === null) return null;
	const target = chargeTargetSocPct(input);
	if (input.socPct >= target) return 0;
	const need = ((target - input.socPct) / 100) * cap.effectiveKwh;
	return round3(Math.max(0, need));
}

function gridChargeEligible(input: BatteryContributionBuildInput): boolean {
	if (!input.gridForecast?.gridImportAllowed) return false;
	if (input.globalModeOff || !input.modePolicy.allowOptimization) return false;
	if (input.modePolicy.mode === "eco" && !input.winterGridActive) return false;
	return input.chargeCapable;
}

export function buildBatteryChargeContribution(input: BatteryContributionBuildInput): PlanContribution {
	const generatedAt = input.now.toISOString();
	const participation = evaluateParticipation({
		addonEnabled: input.addonEnabled,
		governanceEnabled: input.governanceEnabled,
		configured: input.profileId !== "generic_readonly" || input.mappingsReady,
		mappingsReady: input.mappingsReady,
		fault: input.fault,
		lockout: input.lockout,
		globalModeOff: input.globalModeOff,
		telemetryValid: input.telemetryValid,
		telemetryStale: input.telemetryStale,
	});
	const requiredKwh = participation.allowed ? requiredChargeEnergyKwh(input) : null;
	const maxW = input.maxChargeW;
	const gridEligible = gridChargeEligible(input);
	const enabled = participation.allowed && input.chargeCapable && requiredKwh !== null;

	let status = participation.status;
	let reasonDe = participation.reasonDe;
	if (participation.allowed) {
		if (!input.chargeCapable) {
			status = "unsupported";
			reasonDe = "Profil unterstützt keine Ladeleistungssteuerung.";
		} else if (requiredKwh === null) {
			status = "degraded";
			reasonDe = "Ladebedarf nicht berechenbar (SOC oder Kapazität fehlt).";
		} else if (requiredKwh === 0) {
			status = "valid";
			reasonDe = "Batterie am Ladeziel — kein weiterer Ladebedarf.";
		} else {
			status = participation.status === "degraded" ? "degraded" : "valid";
			reasonDe = `Ladebedarf ${requiredKwh} kWh bis ${chargeTargetSocPct(input)} % SOC.`;
		}
	}

	return baseContribution(
		CONTRIBUTION_IDS.BATTERY_CHARGE,
		addonContributorRef("battery"),
		"consume",
		["storage", "demand_flex", "dispatch"],
		{
			generatedAt,
			validUntil: null,
			revision: 1,
			enabled: enabled && status !== "unsupported",
			flexible: true,
			gridEligible,
			quality: operatorQuality(status, reasonDe),
			reasonDe,
			details: {
				socPct: input.socPct,
				targetSocPct: chargeTargetSocPct(input),
				requiredEnergyKwh: requiredKwh,
				maxChargePowerW: maxW,
				topOffRequested: input.topOffRequested,
				profileId: input.profileId,
				globalMode: input.modePolicy.mode,
				pvChargeAllowed: input.modePolicy.allowPvCharge,
				gridImportAllowed: input.gridForecast?.gridImportAllowed ?? null,
				ownershipActive: input.ownershipActive,
				winterGridActive: input.winterGridActive,
			},
			slots: maxW !== null && participation.allowed
				? [
						{
							slot: { startIso: generatedAt, endIso: generatedAt },
							minPowerW: null,
							preferredPowerW: null,
							maxPowerW: maxW,
							requiredEnergyKwh: requiredKwh,
							availableEnergyKwh: null,
							priceCtPerKwh: null,
							available: input.chargeCapable,
							mandatory: false,
							quality: operatorQuality(status, "Technische Ladeverfügbarkeit."),
						},
					]
				: [],
		},
	);
}

export function buildBatteryDischargeContribution(input: BatteryContributionBuildInput): PlanContribution {
	const generatedAt = input.now.toISOString();
	const unsupported = input.profileId === "sonnen_em" || !input.dischargeCapable;
	const reasonDe = unsupported
		? "Profil sonnen_em unterstützt keinen getrennten Entlade-Sollwert — nur passives Eigenverbrauch."
		: "Entladesteuerung nicht verfügbar.";

	return baseContribution(
		CONTRIBUTION_IDS.BATTERY_DISCHARGE,
		addonContributorRef("battery"),
		"provide",
		["storage", "supply", "dispatch"],
		{
			generatedAt,
			validUntil: null,
			revision: 1,
			enabled: false,
			flexible: false,
			gridEligible: false,
			quality: operatorQuality("unsupported", reasonDe),
			reasonDe,
			details: {
				profileId: input.profileId,
				passiveSelfConsumptionOnly: input.profileId === "sonnen_em",
				dischargeCapableFlag: input.dischargeCapable,
				runtimeControlAvailable: false,
			},
			slots: [],
		},
	);
}

export function buildBatteryReserveContribution(input: BatteryContributionBuildInput): PlanContribution {
	const generatedAt = input.now.toISOString();
	const cap = resolveCapacity({
		source: input.capacitySource === "mapped" ? "mapped" : "manual",
		manualKwh: input.capacityManualKwh,
		mappedKwh: input.capacityMappedKwh,
	});
	const energy = deriveEnergy(input.socPct, cap.effectiveKwh, input.minSocPct);
	const participation = evaluateParticipation({
		addonEnabled: input.addonEnabled,
		governanceEnabled: true,
		configured: true,
		mappingsReady: input.mappingsReady,
		fault: input.fault,
		lockout: input.lockout,
		globalModeOff: false,
	});

	const enabled = participation.allowed || input.minSocPct !== null;
	let status: "valid" | "degraded" | "missing" = enabled ? "valid" : "missing";
	if (input.socPct === null || cap.effectiveKwh === null) status = "degraded";

	return baseContribution(
		CONTRIBUTION_IDS.BATTERY_RESERVE,
		addonContributorRef("battery"),
		"constraint",
		["storage", "constraint"],
		{
			generatedAt,
			validUntil: null,
			revision: 1,
			enabled,
			flexible: false,
			gridEligible: false,
			quality: operatorQuality(status, "Batteriereserve und SOC-Grenzen."),
			reasonDe: `Min-SOC ${input.minSocPct ?? "—"} %, Max-SOC ${input.maxSocPct ?? "—"} %.`,
			details: {
				minSocPct: input.minSocPct,
				maxSocPct: input.maxSocPct,
				energyStoredKwh: energy.energyStoredKwh,
				energyAboveReserveKwh: energy.energyAboveTechnicalMinKwh,
				energyFreeToFullKwh: energy.energyFreeToFullKwh,
				topOffTargetSocPct: input.topOffRequested ? 100 : null,
				fault: input.fault,
				lockout: input.lockout,
				ownershipActive: input.ownershipActive,
			},
			slots: [],
		},
	);
}

export function buildBatteryContributions(input: BatteryContributionBuildInput): PlanContribution[] {
	return [
		buildBatteryChargeContribution(input),
		buildBatteryDischargeContribution(input),
		buildBatteryReserveContribution(input),
	];
}
