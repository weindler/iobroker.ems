import type { ImmersionDeviceConfig } from "../../../addons/immersion_heater/runtime/types";
import { resolveThermalForecastTarget } from "../../../planner/rules/thermal_forecast";
import type { PlannerModePolicy } from "../../../planner/mode_policy";
import { CONTRIBUTION_IDS } from "../../contribution_ids";
import type { OperatorDataStatus, PlanContribution } from "../../types";
import { operatorQuality } from "../../quality";
import { addonContributorRef } from "../../contributor";
import { baseContribution } from "../types";
import { evaluateParticipation, round3 } from "./types";

export interface ImmersionContributionBuildInput {
	now: Date;
	addonEnabled: boolean;
	governanceEnabled: boolean;
	globalModeOff: boolean;
	modePolicy: PlannerModePolicy;
	config: ImmersionDeviceConfig;
	bufferTempC: number | null;
	thermalMode: "off" | "auto" | "force";
	fault: boolean;
	lockout: boolean;
	relayMapped: boolean;
	pvTodayKwh: number | null;
	pvTomorrowKwh: number | null;
	pvBiasStatus: string | null;
	forecastModeEnabled: boolean;
	aiOptimizationAllowed: boolean;
}

function enabledStages(config: ImmersionDeviceConfig) {
	return config.stages.filter((s) => s.enabled && s.nominalPowerW > 0 && s.setStateId);
}

function maxStagePowerW(config: ImmersionDeviceConfig): number | null {
	const stages = enabledStages(config);
	if (stages.length === 0) return null;
	return Math.max(...stages.map((s) => s.nominalPowerW));
}

export function buildImmersionMandatoryContribution(input: ImmersionContributionBuildInput): PlanContribution {
	const generatedAt = input.now.toISOString();
	const target = resolveThermalForecastTarget({
		config: input.config,
		bufferTempC: input.bufferTempC,
		pvTodayKwh: input.pvTodayKwh,
		pvTomorrowKwh: input.pvTomorrowKwh,
		pvBiasStatus: input.pvBiasStatus,
		forecastModeEnabled: input.forecastModeEnabled,
		aiOptimizationAllowed: input.aiOptimizationAllowed,
	});

	const mandatoryReason =
		input.thermalMode === "force"
			? "Betreiberbefehl force — Pflichtbedarf."
			: input.bufferTempC !== null && input.bufferTempC < input.config.planningMinTempC
				? `Puffer ${round3(input.bufferTempC)} °C unter Pflicht-Untergrenze ${input.config.planningMinTempC} °C.`
				: null;

	const participation = evaluateParticipation({
		addonEnabled: input.addonEnabled,
		governanceEnabled: input.governanceEnabled,
		configured: enabledStages(input.config).length > 0,
		mappingsReady: input.relayMapped,
		fault: input.fault,
		lockout: input.lockout,
		globalModeOff: input.globalModeOff,
		telemetryValid: input.bufferTempC !== null,
	});

	const mandatory = mandatoryReason !== null;
	const maxW = maxStagePowerW(input.config);
	const enabled = mandatory && participation.allowed && !input.globalModeOff;

	return baseContribution(
		CONTRIBUTION_IDS.IMMERSION_MANDATORY,
		addonContributorRef("immersion_heater"),
		"consume",
		["demand_flex", "dispatch"],
		{
			generatedAt,
			validUntil: null,
			revision: 1,
			enabled,
			flexible: false,
			gridEligible: false,
			quality: operatorQuality(
				!mandatory ? "disabled" : enabled ? "valid" : participation.status,
				mandatory ? (mandatoryReason ?? "") : "Kein Pflichtbedarf.",
			),
			reasonDe: mandatory ? (mandatoryReason ?? "") : "Kein Pflichtbedarf für Heizstab.",
			details: {
				bufferTempC: input.bufferTempC,
				mandatoryMinTempC: input.config.planningMinTempC,
				targetTempC: target.targetTempC,
				maxPowerW: maxW,
				thermalMode: input.thermalMode,
				mandatory: true,
			},
			slots: [],
		},
	);
}

export function buildImmersionFlexibleContribution(input: ImmersionContributionBuildInput): PlanContribution {
	const generatedAt = input.now.toISOString();
	const target = resolveThermalForecastTarget({
		config: input.config,
		bufferTempC: input.bufferTempC,
		pvTodayKwh: input.pvTodayKwh,
		pvTomorrowKwh: input.pvTomorrowKwh,
		pvBiasStatus: input.pvBiasStatus,
		forecastModeEnabled: input.forecastModeEnabled,
		aiOptimizationAllowed: input.aiOptimizationAllowed,
	});

	const participation = evaluateParticipation({
		addonEnabled: input.addonEnabled,
		governanceEnabled: input.governanceEnabled,
		configured: enabledStages(input.config).length > 0,
		mappingsReady: input.relayMapped,
		fault: input.fault,
		lockout: input.lockout,
		globalModeOff: input.globalModeOff,
	});

	const atTarget =
		input.bufferTempC !== null &&
		(input.bufferTempC >= input.config.planningMaxTempC || input.bufferTempC >= target.targetTempC);
	const autoReady =
		participation.allowed &&
		input.thermalMode === "auto" &&
		input.modePolicy.allowThermalAuto &&
		!atTarget;

	const maxW = maxStagePowerW(input.config);
	let status: OperatorDataStatus = autoReady ? "valid" : "disabled";
	let reasonDe = "Kein flexibler Heizstab-Bedarf.";

	if (participation.allowed && input.thermalMode !== "auto") {
		status = "disabled";
		reasonDe = `Heizstab-Modus „${input.thermalMode}“ — flexibler Beitrag nur bei auto.`;
	} else if (atTarget) {
		status = "disabled";
		reasonDe = "Zieltemperatur erreicht — kein flexibler Bedarf.";
	} else if (autoReady) {
		reasonDe = `Flexibler Warmwasserbedarf bis ${target.targetTempC} °C (PV-first).`;
	} else if (!participation.allowed) {
		status = participation.status;
		reasonDe = participation.reasonDe;
	}

	return baseContribution(
		CONTRIBUTION_IDS.IMMERSION_FLEXIBLE,
		addonContributorRef("immersion_heater"),
		"consume",
		["demand_flex", "dispatch"],
		{
			generatedAt,
			validUntil: null,
			revision: 1,
			enabled: autoReady,
			flexible: true,
			gridEligible: false,
			quality: operatorQuality(status, reasonDe),
			reasonDe,
			details: {
				bufferTempC: input.bufferTempC,
				targetTempC: target.targetTempC,
				maxPowerW: maxW,
				pvFirst: true,
				forecastActive: target.forecastActive,
				minimumRuntimeSec: input.config.minimumRuntimeSec,
			},
			slots: [],
		},
	);
}

export function buildImmersionHeaterContributions(input: ImmersionContributionBuildInput): PlanContribution[] {
	return [buildImmersionMandatoryContribution(input), buildImmersionFlexibleContribution(input)];
}
