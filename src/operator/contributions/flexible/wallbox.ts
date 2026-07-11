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
	deadlineIso: string | null;
	activePhases: number | null;
	maxCurrentA: number | null;
	evccConfigured: boolean;
}

function requiredEnergyKwh(input: WallboxContributionBuildInput): number | null {
	if (input.remainingEnergyKwh !== null && Number.isFinite(input.remainingEnergyKwh)) {
		return round3(Math.max(0, input.remainingEnergyKwh));
	}
	const targetSoc =
		input.planActive && input.planSocPct !== null
			? input.planSocPct
			: input.planSocPct;
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
	});

	const requiredKwh = requiredEnergyKwh(input);
	const maxW = wallboxMaxChargePowerW(input.activePhases, input.maxCurrentA);
	let status = participation.status;
	let reasonDe = participation.reasonDe;

	if (participation.allowed) {
		if (requiredKwh === null && input.vehicleSocPct === null && input.sessionEnergyKwh === null) {
			status = "degraded";
			reasonDe = "Fahrzeug verbunden, aber Ladebedarf nicht belastbar bestimmbar.";
		} else if (requiredKwh === null && (input.planActive || input.planSocPct !== null)) {
			status = "degraded";
			reasonDe = "Plan aktiv, aber Restenergie ohne Fahrzeugkapazität nicht berechenbar.";
		} else {
			status = participation.status === "degraded" ? "degraded" : "valid";
			reasonDe =
				requiredKwh !== null
					? `EV-Ladesitzung — Bedarf ${round3(requiredKwh)} kWh.`
					: "EV-Ladesitzung aktiv — Bedarf eingeschränkt dokumentiert.";
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
				requiredEnergyKwh: requiredKwh,
				maxChargePowerW: maxW,
				activePhases: input.activePhases,
				maxCurrentA: input.maxCurrentA,
				runtimeControlAvailable: false,
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
