import { CONTRIBUTION_IDS } from "../../contribution_ids";
import type { PlanContribution } from "../../types";
import { operatorQuality } from "../../quality";
import { addonContributorRef } from "../../contributor";
import type { PlannerModePolicy } from "../../../planner/mode_policy";
import type { GridSupplyForecast } from "../../types";
import { baseContribution } from "../types";
import { evaluateParticipation, round3, wallboxMaxChargePowerW } from "./types";

export interface WallboxContributionBuildInput {
	now: Date;
	addonEnabled: boolean;
	governanceEnabled: boolean;
	globalModeOff: boolean;
	addonExecutionOff: boolean;
	modePolicy: PlannerModePolicy;
	gridForecast: GridSupplyForecast | null;
	connected: boolean;
	charging: boolean;
	vehicleSocPct: number | null;
	planSocPct: number | null;
	planActive: boolean;
	sessionEnergyKwh: number | null;
	remainingEnergyKwh: number | null;
	vehicleCapacityKwh: number | null;
	/** Optional planning cap from `wb_vehicle_map.max_ac_charge_power_w`. */
	vehicleMaxAcChargePowerW?: number | null;
	/** Fallback-Ziel-SOC wenn kein aktiver Plan (z. B. Intent). */
	fallbackTargetSocPct?: number | null;
	/** EVCC effectiveLimitSoc. */
	effectiveLimitSocPct?: number | null;
	deadlineIso: string | null;
	activePhases: number | null;
	maxCurrentA: number | null;
	evccConfigured: boolean;
	minimumDepartureSocPct?: number | null;
	departureAt?: string | null;
	chargingEfficiency?: number | null;
	energyToTargetKwh?: number | null;
	energyToDepartureMinimumKwh?: number | null;
	externalSmartChargingMinSocPct?: number | null;
	externalAuthorityState?: string | null;
	takeoverSeverity?: string | null;
	externalSmartPlanJson?: string | null;
	externalPlanQuality?: string | null;
}

/** Ziel-SOC nur bei aktivem Plan mit positivem planSoc, sonst effectiveLimit/fallback. */
export function resolveWallboxTargetSocPct(input: {
	planActive: boolean;
	planSocPct: number | null;
	effectiveLimitSocPct?: number | null;
	fallbackTargetSocPct?: number | null;
}): number | null {
	if (input.planActive && input.planSocPct !== null && input.planSocPct > 0) {
		return input.planSocPct;
	}
	const effective = input.effectiveLimitSocPct;
	if (effective !== null && effective !== undefined && effective > 0) {
		return effective;
	}
	const fallback = input.fallbackTargetSocPct;
	if (fallback !== null && fallback !== undefined && fallback > 0) {
		return fallback;
	}
	return null;
}

function requiredEnergyKwh(input: WallboxContributionBuildInput): number | null {
	if (input.remainingEnergyKwh !== null && Number.isFinite(input.remainingEnergyKwh)) {
		return round3(Math.max(0, input.remainingEnergyKwh));
	}
	const targetSoc = resolveWallboxTargetSocPct(input);
	if (
		targetSoc !== null &&
		input.vehicleSocPct !== null &&
		input.vehicleCapacityKwh !== null &&
		input.vehicleCapacityKwh > 0
	) {
		const delta = targetSoc - input.vehicleSocPct;
		if (delta <= 0) return 0;
		return round3((delta / 100) * input.vehicleCapacityKwh);
	}
	return null;
}

function degradedReasonDe(input: WallboxContributionBuildInput, requiredKwh: number | null): string {
	const hasRemaining = input.remainingEnergyKwh !== null && Number.isFinite(input.remainingEnergyKwh);
	const hasCapacity =
		input.vehicleCapacityKwh !== null &&
		Number.isFinite(input.vehicleCapacityKwh) &&
		input.vehicleCapacityKwh > 0;
	const targetSoc = resolveWallboxTargetSocPct(input);

	if (!hasRemaining && !hasCapacity) {
		return "Fahrzeug verbunden, aber Restenergie und Fahrzeugkapazität fehlen — Ladebedarf nicht bestimmbar.";
	}
	if (!hasRemaining && hasCapacity && targetSoc === null) {
		return "Fahrzeug verbunden, aber kein gültiges Ladeziel (Plan inaktiv/0, kein effectiveLimit) — Bedarf nicht berechenbar.";
	}
	if (!hasRemaining && hasCapacity && input.vehicleSocPct === null) {
		return "Fahrzeugkapazität bekannt, aber Fahrzeug-SOC fehlt — Restenergie nicht berechenbar.";
	}
	if (requiredKwh === null && (input.planActive || input.planSocPct !== null)) {
		return "Plan/Ziel vorhanden, aber Restenergie ohne belastbare Telemetrie nicht berechenbar.";
	}
	return "Fahrzeug verbunden, aber Ladebedarf nicht belastbar bestimmbar.";
}

function gridEligible(input: WallboxContributionBuildInput): boolean {
	if (!input.gridForecast?.gridImportAllowed) return false;
	if (input.globalModeOff || !input.modePolicy.allowOptimization) return false;
	return true;
}

export function buildWallboxEvSessionContribution(input: WallboxContributionBuildInput): PlanContribution {
	const generatedAt = input.now.toISOString();

	if (!input.connected) {
		return baseContribution(
			CONTRIBUTION_IDS.WALLBOX_EV_SESSION,
			addonContributorRef("wallbox"),
			"consume",
			["demand_flex", "dispatch"],
			{
				generatedAt,
				validUntil: null,
				revision: 1,
				enabled: false,
				flexible: true,
				gridEligible: false,
				quality: operatorQuality("disabled", "Fahrzeug nicht verbunden."),
				reasonDe: "Fahrzeug nicht verbunden — keine EV-Lade-Contribution.",
				details: {
					connected: false,
					vehicleSocPct: input.vehicleSocPct,
					runtimeControlAvailable: false,
					minimumDepartureSocPct: input.minimumDepartureSocPct ?? null,
					departureAt: input.departureAt ?? null,
					chargingEfficiency: input.chargingEfficiency ?? null,
					energyToTargetKwh: input.energyToTargetKwh ?? null,
					energyToDepartureMinimumKwh: input.energyToDepartureMinimumKwh ?? null,
					externalSmartChargingMinSocPct: input.externalSmartChargingMinSocPct ?? null,
					externalAuthorityState: input.externalAuthorityState ?? null,
					takeoverSeverity: input.takeoverSeverity ?? null,
					externalSmartPlanJson: input.externalSmartPlanJson ?? null,
					externalPlanQuality: input.externalPlanQuality ?? null,
				},
				slots: [],
			},
		);
	}

	const participation = evaluateParticipation({
		addonEnabled: input.addonEnabled,
		governanceEnabled: input.governanceEnabled,
		configured: input.evccConfigured,
		mappingsReady: input.evccConfigured,
		fault: false,
		lockout: false,
		globalModeOff: input.globalModeOff,
		addonExecutionOff: input.addonExecutionOff,
	});

	const requiredKwh = requiredEnergyKwh(input);
	const fromPhases = wallboxMaxChargePowerW(input.activePhases, input.maxCurrentA);
	const vehicleCap =
		input.vehicleMaxAcChargePowerW !== null &&
		input.vehicleMaxAcChargePowerW !== undefined &&
		input.vehicleMaxAcChargePowerW > 0
			? input.vehicleMaxAcChargePowerW
			: null;
	const maxW =
		fromPhases !== null && vehicleCap !== null
			? Math.min(fromPhases, vehicleCap)
			: (fromPhases ?? vehicleCap);
	let status = participation.status;
	let reasonDe = participation.reasonDe;

	if (participation.allowed) {
		if (requiredKwh === null && input.vehicleSocPct === null && input.sessionEnergyKwh === null) {
			status = "degraded";
			reasonDe = degradedReasonDe(input, requiredKwh);
		} else if (requiredKwh === null) {
			status = "degraded";
			reasonDe = degradedReasonDe(input, requiredKwh);
		} else {
			status = participation.status === "degraded" ? "degraded" : "valid";
			reasonDe = `EV-Ladesitzung — Bedarf ${round3(requiredKwh)} kWh.`;
		}
	}

	const enabled = participation.allowed && input.connected;

	return baseContribution(
		CONTRIBUTION_IDS.WALLBOX_EV_SESSION,
		addonContributorRef("wallbox"),
		"consume",
		["demand_flex", "dispatch"],
		{
			generatedAt,
			validUntil: input.deadlineIso,
			revision: 1,
			enabled,
			flexible: true,
			gridEligible: gridEligible(input),
			deadlineIso: input.deadlineIso,
			quality: operatorQuality(status, reasonDe),
			reasonDe,
			details: {
				connected: input.connected,
				charging: input.charging,
				vehicleSocPct: input.vehicleSocPct,
				planSocPct: input.planSocPct,
				planActive: input.planActive,
				sessionEnergyKwh: input.sessionEnergyKwh,
				remainingEnergyKwh: input.remainingEnergyKwh,
				effectiveLimitSocPct: input.effectiveLimitSocPct ?? null,
				requiredEnergyKwh: requiredKwh,
				maxChargePowerW: maxW,
				activePhases: input.activePhases,
				maxCurrentA: input.maxCurrentA,
				runtimeControlAvailable: false,
				minimumDepartureSocPct: input.minimumDepartureSocPct ?? null,
				departureAt: input.departureAt ?? null,
				chargingEfficiency: input.chargingEfficiency ?? null,
				energyToTargetKwh: input.energyToTargetKwh ?? null,
				energyToDepartureMinimumKwh: input.energyToDepartureMinimumKwh ?? null,
				externalSmartChargingMinSocPct: input.externalSmartChargingMinSocPct ?? null,
				externalAuthorityState: input.externalAuthorityState ?? null,
				takeoverSeverity: input.takeoverSeverity ?? null,
				externalSmartPlanJson: input.externalSmartPlanJson ?? null,
				externalPlanQuality: input.externalPlanQuality ?? null,
			},
			slots:
				maxW !== null && enabled
					? [
							{
								slot: { startIso: generatedAt, endIso: input.deadlineIso ?? generatedAt },
								minPowerW: null,
								preferredPowerW: null,
								maxPowerW: maxW,
								requiredEnergyKwh: requiredKwh,
								availableEnergyKwh: null,
								priceCtPerKwh: null,
								available: true,
								mandatory: false,
								quality: operatorQuality(status, "Technische Ladeverfügbarkeit."),
							},
						]
					: [],
		},
	);
}
