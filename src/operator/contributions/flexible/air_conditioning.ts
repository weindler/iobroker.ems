import { AC_UNIT_COUNT } from "../../../addons/air_conditioning/constants";
import type { AcGlobalConfig, AcUnitConfig } from "../../../addons/air_conditioning/types";
import type { ConsumerPersistEntry } from "../../../learning/consumer_stats/types";
import { planCooling, type CoolingUnitPlanInput } from "../../../planner/rules/cooling";
import type { PlannerModePolicy } from "../../../planner/mode_policy";
import { acUnitContributionId } from "../../contribution_ids";
import type { PlanContribution } from "../../types";
import { operatorQuality } from "../../quality";
import { addonContributorRef } from "../../contributor";
import { baseContribution } from "../types";
import { evaluateParticipation, round3 } from "./types";

export interface AcUnitContributionBuildInput {
	unit: AcUnitConfig;
	roomTempC: number | null;
	consumerStats: ConsumerPersistEntry | undefined;
	mappingsReady: boolean;
	fault: boolean;
	lockout: boolean;
	cleaningBlocked: boolean;
}

export interface AirConditioningContributionBuildInput {
	now: Date;
	addonEnabled: boolean;
	governanceEnabled: boolean;
	globalModeOff: boolean;
	modePolicy: PlannerModePolicy;
	acConfig: AcGlobalConfig;
	outdoorTempC: number | null;
	units: AcUnitContributionBuildInput[];
}

function buildUnitContribution(
	input: AirConditioningContributionBuildInput,
	unitInput: AcUnitContributionBuildInput,
	forecast: ReturnType<typeof planCooling>["units"][number],
): PlanContribution {
	const generatedAt = input.now.toISOString();
	const unit = unitInput.unit;
	const contributionId = acUnitContributionId(unit.index);

	if (!unit.enabled) {
		return baseContribution(contributionId, addonContributorRef("air_conditioning"), "consume", ["demand_flex", "dispatch"], {
			generatedAt,
			validUntil: null,
			revision: 1,
			enabled: false,
			flexible: true,
			gridEligible: false,
			quality: operatorQuality("disabled", `Unit ${unit.index} deaktiviert.`),
			reasonDe: `Klima-Unit ${unit.name} deaktiviert.`,
			details: { unitIndex: unit.index, unitEnabled: false },
			slots: [],
		});
	}

	const participation = evaluateParticipation({
		addonEnabled: input.addonEnabled,
		governanceEnabled: input.governanceEnabled,
		configured: true,
		mappingsReady: unitInput.mappingsReady,
		fault: unitInput.fault,
		lockout: unitInput.lockout || unitInput.cleaningBlocked,
		globalModeOff: input.globalModeOff,
	});

	const hasDemand = forecast.likelyActive && forecast.expectedKwh > 0;
	let status = participation.status;
	let reasonDe = forecast.reasonDe;

	if (participation.allowed && unitInput.roomTempC === null) {
		status = "degraded";
		reasonDe = "Raumtemperatur fehlt — Kühlbedarf eingeschränkt.";
	} else if (participation.allowed && !hasDemand) {
		status = "disabled";
		reasonDe = forecast.reasonDe || "Kein Kühlbedarf.";
	} else if (participation.allowed) {
		status = participation.status === "degraded" ? "degraded" : "valid";
	}

	const enabled = participation.allowed && hasDemand;

	return baseContribution(contributionId, addonContributorRef("air_conditioning"), "consume", ["demand_flex", "dispatch"], {
		generatedAt,
		validUntil: null,
		revision: 1,
		enabled,
		flexible: true,
		gridEligible: input.modePolicy.mode !== "eco" && !input.globalModeOff,
		quality: operatorQuality(status, reasonDe),
		reasonDe,
		details: {
			unitIndex: unit.index,
			unitName: unit.name,
			roomTempC: unitInput.roomTempC,
			onTempC: unit.onTempC,
			offTempC: unit.offTempC,
			expectedKwhToday: round3(forecast.expectedKwh),
			expectedPeakW: forecast.powerW,
			powerSource: forecast.powerSource,
			likelyActive: forecast.likelyActive,
			outdoorTempC: input.outdoorTempC,
			governanceEnabled: input.governanceEnabled,
			runtimeGovernanceGap: true,
		},
		slots: [],
	});
}

export function buildAirConditioningContributions(input: AirConditioningContributionBuildInput): PlanContribution[] {
	const unitInputs: CoolingUnitPlanInput[] = input.units
		.filter((u) => u.unit.enabled)
		.map((u) => ({
			unit: u.unit,
			roomTempC: u.roomTempC,
			consumerStats: u.consumerStats,
		}));

	const cooling = planCooling({
		now: input.now,
		acConfig: input.acConfig,
		governanceEnabled: input.governanceEnabled,
		outdoorTempC: input.outdoorTempC,
		units: unitInputs,
	});

	const byIndex = new Map(cooling.units.map((u) => [u.unitIndex, u]));
	const contributions: PlanContribution[] = [];

	for (let i = 1; i <= AC_UNIT_COUNT; i++) {
		const unitInput = input.units.find((u) => u.unit.index === i);
		if (!unitInput) continue;
		const forecast = byIndex.get(i) ?? {
			unitIndex: i,
			name: unitInput.unit.name,
			powerW: unitInput.unit.estimatedPowerW,
			powerSource: "config" as const,
			likelyActive: false,
			expectedHours: 0,
			expectedKwh: 0,
			reasonDe: "Unit nicht im Kühlplan.",
		};
		contributions.push(buildUnitContribution(input, unitInput, forecast));
	}

	return contributions;
}
