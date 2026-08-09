import type { ImmersionDeviceConfig } from "../../../addons/immersion_heater/runtime/types";
import { isImmersionReheatHysteresisActive } from "../../../addons/immersion_heater/runtime/reheat_hysteresis";
import { resolveThermalForecastTarget } from "../../planning/thermal_forecast";
import type { PlannerModePolicy } from "../../../planner/mode_policy";
import { CONTRIBUTION_IDS } from "../../contribution_ids";
import type { OperatorDataStatus, PlanContribution } from "../../types";
import { operatorQuality } from "../../quality";
import { addonContributorRef } from "../../contributor";
import { baseContribution } from "../types";
import { buildFlexibleDemandSlot, estimateImmersionRequiredEnergyKwh, type ImmersionLearningMargin } from "./flex_demand";
import { resolveImmersionNightBridge } from "./immersion_night_bridge";
import { resolveThermalPvPrecharge } from "./thermal_pv_precharge";
import type { ThermalLearningSignal } from "./thermal_learning";
import {
	hasCycleCoolingModel,
	hasNewtonEmptyAtModel,
	thermalEmptyAtUsableForPlanning,
	thermalLearningDegradedCauseDe,
} from "./thermal_empty_at";
import { evaluateParticipation, round3 } from "./types";

export { thermalEmptyAtUsableForPlanning } from "./thermal_empty_at";

export interface ImmersionContributionBuildInput {
	now: Date;
	addonEnabled: boolean;
	governanceEnabled: boolean;
	globalModeOff: boolean;
	addonExecutionOff: boolean;
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
	/** Thermal-Runtime-Learning (`learning.thermal_runtime.*`) — optional, `null`/fehlend → reine Physik-Schätzung. */
	thermalLearning?: ThermalLearningSignal | null;
	/**
	 * Runtime-Flag: Tagesziel wurde erreicht; Wiedereinschalt-Hysterese aktiv bis Buf < Ziel − Hysterese.
	 * Damit vergibt der Daily Plan keine Slots, die die Runtime ohnehin sperren würde.
	 */
	autoTargetReached?: boolean;
	/** Hauszeitzone für Nachtbrücke (Default Europe/Berlin). */
	timezone?: string;
	/** Befund 004: Kontext für thermische PV-Vorladung (optional). */
	todayPvSurplusKwh?: number | null;
	batterySocPct?: number | null;
	batteryEndSocTargetPct?: number | null;
	vehicleUrgentEnergyKwh?: number | null;
	exportTariffCtPerKwh?: number | null;
	importTariffCtPerKwh?: number | null;
	/** Späterer elektrischer Flexbedarf (Klima/Fahrzeug) als Hinweis für Vorladung. */
	futureElectricalFlexHintKwh?: number | null;
	nextPvHeatOpportunityIso?: string | null;
}

function learningMargin(input: ImmersionContributionBuildInput): ImmersionLearningMargin | null {
	if (!input.thermalLearning) return null;
	return {
		status: input.thermalLearning.status,
		coolingRateCPerHAvg: input.thermalLearning.coolingRateCPerHAvg,
	};
}

/**
 * Transparenz: empty_at aus belastbarem Learning vs. eingeschätztem/degradiertem Signal.
 * Nie „learned“ ohne status=valid.
 */
function emptyAtSourceOf(
	learning: ThermalLearningSignal | null | undefined,
): "learned" | "estimated" | null {
	if (!learning?.estimatedEmptyAt) return null;
	if (learning.status === "valid") return "learned";
	if (learning.status === "degraded") return "estimated";
	return null;
}

function thermalLearningDetails(input: ImmersionContributionBuildInput): Record<string, unknown> {
	const learning = input.thermalLearning ?? null;
	return {
		thermalLearningStatus: learning?.status ?? "missing",
		thermalLearningHealth: learning?.health ?? null,
		thermalLearningSamples: learning?.samples ?? null,
		coolingRateCPerHAvg: learning?.coolingRateCPerHAvg ?? null,
		coolingConstantPerH: learning?.coolingConstantPerH ?? null,
		estimatedRemainingHours: learning?.estimatedRemainingHours ?? null,
		estimatedEmptyAt: learning?.estimatedEmptyAt ?? null,
		emptyAtSource: emptyAtSourceOf(learning),
		emptyAtPlanningUsable: thermalEmptyAtUsableForPlanning(learning),
		thermalLearningModel: hasCycleCoolingModel(learning)
			? "cycle"
			: hasNewtonEmptyAtModel(learning)
				? "newton"
				: "none",
		thermalLearningDegradedCauseDe: thermalLearningDegradedCauseDe(learning),
		learnedDayTypeRuntimeHoursMedian: learning?.currentDayTypeRuntimeHoursMedian ?? null,
	};
}

function enabledStages(config: ImmersionDeviceConfig) {
	return config.stages.filter((s) => s.enabled && s.nominalPowerW > 0 && s.setStateId);
}

/** Nennleistungen für Planung — auch wenn setStateId noch fehlt (Participation sperrt dann separat). */
function poweredStages(config: ImmersionDeviceConfig) {
	return config.stages.filter((s) => s.enabled && s.nominalPowerW > 0);
}

function maxStagePowerW(config: ImmersionDeviceConfig): number | null {
	const stages = poweredStages(config);
	if (stages.length === 0) return null;
	return Math.max(...stages.map((s) => s.nominalPowerW));
}

function minStagePowerW(config: ImmersionDeviceConfig): number | null {
	const stages = poweredStages(config);
	if (stages.length === 0) return null;
	return Math.min(...stages.map((s) => s.nominalPowerW));
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
		addonExecutionOff: input.addonExecutionOff,
		telemetryValid: input.bufferTempC !== null,
	});

	const mandatory = mandatoryReason !== null;
	const maxW = maxStagePowerW(input.config);
	const minW = minStagePowerW(input.config);
	const enabled = mandatory && participation.allowed && !input.globalModeOff;
	const mandatoryTargetC =
		input.thermalMode === "force"
			? input.config.planningMaxTempC
			: input.config.planningMinTempC;
	const requiredEnergyKwh =
		mandatory && input.bufferTempC !== null && maxW !== null
			? estimateImmersionRequiredEnergyKwh(input.bufferTempC, mandatoryTargetC, maxW, learningMargin(input))
			: null;
	const quality = operatorQuality(
		!mandatory ? "disabled" : enabled ? "valid" : participation.status,
		mandatory ? (mandatoryReason ?? "") : "Kein Pflichtbedarf.",
	);

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
			quality,
			reasonDe: mandatory ? (mandatoryReason ?? "") : "Kein Pflichtbedarf für Heizstab.",
			details: {
				bufferTempC: input.bufferTempC,
				mandatoryMinTempC: input.config.planningMinTempC,
				targetTempC: target.targetTempC,
				targetReasonDe: target.targetReasonDe,
				requiredEnergyKwh,
				maxPowerW: maxW,
				minPowerW: minW,
				thermalMode: input.thermalMode,
				mandatory: true,
				batteryEligible: true,
				...thermalLearningDetails(input),
			},
			slots: buildFlexibleDemandSlot({
				generatedAt,
				requiredEnergyKwh,
				maxPowerW: maxW,
				minPowerW: minW,
				available: enabled,
				mandatory: true,
				quality,
				reasonDe: mandatoryReason ?? "Pflichtbedarf.",
			}),
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
		addonExecutionOff: input.addonExecutionOff,
	});

	const maxW = maxStagePowerW(input.config);
	const minW = minStagePowerW(input.config);

	/*
	 * Nachtbrücke: empty_at vor nächstem Morgen → Ziel anheben + Deadline.
	 * Auch degraded Learning (mit empty_at) — Qualität steht in emptyAtSource/thermalLearningStatus;
	 * Unified gewichtet Deadline danach (valid stärker als estimated).
	 */
	/*
	 * Nachtbrücke braucht lineare Cycle-Rate. Newton-empty_at allein setzt Deadline (unten),
	 * ohne Nachtbrücken-Zielanhebung — Semantik getrennt (A1).
	 */
	const nightBridge =
		input.bufferTempC !== null &&
		thermalEmptyAtUsableForPlanning(input.thermalLearning) &&
		hasCycleCoolingModel(input.thermalLearning)
			? resolveImmersionNightBridge({
					now: input.now,
					bufferTempC: input.bufferTempC,
					planningMinTempC: input.config.planningMinTempC,
					planningMaxTempC: input.config.planningMaxTempC,
					forecastTargetTempC: target.targetTempC,
					coolingRateCPerHAvg: input.thermalLearning!.coolingRateCPerHAvg!,
					estimatedEmptyAtIso: input.thermalLearning!.estimatedEmptyAt!,
					timezone: input.timezone,
				})
			: null;

	const afterBridgeTempC = nightBridge?.active
		? nightBridge.effectiveTargetTempC
		: target.targetTempC;

	/*
	 * Puffer als Flexspeicher: Vorladung auch ohne emptyAt, wenn PV-Überschuss
	 * und Batterie-Kontext vorliegen. emptyAt bleibt Reichweiten-Info.
	 */
	const canConsiderPrecharge =
		input.bufferTempC !== null &&
		(thermalEmptyAtUsableForPlanning(input.thermalLearning) ||
			(input.todayPvSurplusKwh != null && input.todayPvSurplusKwh >= 3));
	const pvPrecharge = canConsiderPrecharge
		? resolveThermalPvPrecharge({
				now: input.now,
				bufferTempC: input.bufferTempC!,
				planningMinTempC: input.config.planningMinTempC,
				planningMaxTempC: input.config.planningMaxTempC,
				baseTargetTempC: afterBridgeTempC,
				coolingRateCPerHAvg: input.thermalLearning?.coolingRateCPerHAvg ?? null,
				estimatedEmptyAtIso: input.thermalLearning?.estimatedEmptyAt ?? null,
				nextPvHeatOpportunityIso: input.nextPvHeatOpportunityIso ?? null,
				pvTodayKwh: input.pvTodayKwh,
				pvTomorrowKwh: input.pvTomorrowKwh,
				todayPvSurplusKwh: input.todayPvSurplusKwh ?? null,
				batterySocPct: input.batterySocPct ?? null,
				batteryEndSocTargetPct: input.batteryEndSocTargetPct ?? null,
				vehicleUrgentEnergyKwh: input.vehicleUrgentEnergyKwh ?? null,
				exportTariffCtPerKwh: input.exportTariffCtPerKwh ?? null,
				importTariffCtPerKwh: input.importTariffCtPerKwh ?? null,
				futureElectricalFlexHintKwh: input.futureElectricalFlexHintKwh ?? null,
				globalMode: input.modePolicy.mode,
			})
		: null;

	const effectiveTargetTempC =
		pvPrecharge?.active === true ? pvPrecharge.targetTempC : afterBridgeTempC;

	const hysteresisActive = isImmersionReheatHysteresisActive({
		bufferTempC: input.bufferTempC,
		targetTempC: target.targetTempC,
		hysteresisK: input.config.temperatureHysteresisK,
		autoTargetReached: input.autoTargetReached === true,
	});

	const atEffectiveTarget =
		input.bufferTempC !== null &&
		(input.bufferTempC >= input.config.planningMaxTempC || input.bufferTempC >= effectiveTargetTempC);

	/*
	 * Strategischer Planbedarf: Hysterese ist Runtime-Anti-Takt — sie darf Headroom/Deadline
	 * für den Unified Planner nicht auf 0 setzen. Runtime FSM bleibt für Writes zuständig.
	 */
	const planningReady =
		participation.allowed &&
		input.thermalMode === "auto" &&
		input.modePolicy.allowThermalAuto &&
		!atEffectiveTarget;

	const requiredEnergyKwh =
		planningReady && input.bufferTempC !== null && maxW !== null
			? estimateImmersionRequiredEnergyKwh(input.bufferTempC, effectiveTargetTempC, maxW, learningMargin(input))
			: null;
	let status: OperatorDataStatus = planningReady ? "valid" : "disabled";
	let reasonDe = "Kein flexibler Heizstab-Bedarf.";

	if (participation.allowed && input.thermalMode !== "auto") {
		status = "disabled";
		reasonDe = `Heizstab-Modus „${input.thermalMode}“ — flexibler Beitrag nur bei auto.`;
	} else if (atEffectiveTarget) {
		status = "disabled";
		reasonDe = "Zieltemperatur erreicht — kein flexibler Bedarf.";
	} else if (planningReady && requiredEnergyKwh !== null && requiredEnergyKwh <= 0) {
		status = "disabled";
		reasonDe = "Zieltemperatur erreicht — kein flexibler Bedarf.";
	} else if (planningReady && input.bufferTempC === null) {
		status = "degraded";
		reasonDe = "Puffertemperatur fehlt — flexibler Bedarf nicht belastbar.";
	} else if (planningReady) {
		reasonDe = `Flexibler Warmwasserbedarf bis ${effectiveTargetTempC} °C (${requiredEnergyKwh?.toFixed(1) ?? "?"} kWh, PV-first).`;
		if (nightBridge?.active) reasonDe = `${reasonDe} ${nightBridge.reasonDe}`;
		if (pvPrecharge?.active) reasonDe = `${reasonDe} ${pvPrecharge.reasonDe}`;
		if (hysteresisActive) {
			const reheatAt = round3(target.targetTempC - Math.max(0, input.config.temperatureHysteresisK));
			reasonDe = `${reasonDe} Runtime-Hysterese aktiv (Write erst unter ${reheatAt} °C) — Planung bleibt.`;
		}
		if (input.thermalLearning?.status === "degraded") {
			status = "degraded";
			const cause = thermalLearningDegradedCauseDe(input.thermalLearning);
			reasonDe = cause
				? `${reasonDe} degraded: ${cause}.`
				: `${reasonDe} Thermal Learning degraded — empty_at geschätzt.`;
		}
	} else if (!participation.allowed) {
		status = participation.status;
		reasonDe = participation.reasonDe;
	}

	const enabled =
		planningReady &&
		requiredEnergyKwh !== null &&
		requiredEnergyKwh > 0 &&
		input.bufferTempC !== null;
	const quality = operatorQuality(status, reasonDe);

	/*
	 * Deadline für Unified:
	 * 1) Nachtbrücke (empty_at vor Morgen)
	 * 2) sonst empty_at wenn Planung aktiv und Quelle usable (learned/estimated) —
	 *    nicht nur Near-Floor: Vorladen vor Leerzeit ist strategisch.
	 */
	const planningDeadlineIso =
		enabled && nightBridge?.active
			? nightBridge.deadlineIso
			: enabled && thermalEmptyAtUsableForPlanning(input.thermalLearning)
				? input.thermalLearning!.estimatedEmptyAt
				: null;

	if (enabled && planningDeadlineIso && !nightBridge?.active) {
		const src = emptyAtSourceOf(input.thermalLearning);
		reasonDe = `${reasonDe} Puffer voraussichtlich leer ${planningDeadlineIso} (${src ?? "unknown"}).`;
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
			enabled,
			flexible: true,
			gridEligible: false,
			deadlineIso: planningDeadlineIso,
			quality,
			reasonDe,
			details: {
				bufferTempC: input.bufferTempC,
				targetTempC: effectiveTargetTempC,
				forecastTargetTempC: target.targetTempC,
				targetReasonDe: [
					target.targetReasonDe,
					nightBridge?.active ? nightBridge.reasonDe : null,
					pvPrecharge?.active ? pvPrecharge.reasonDe : null,
				]
					.filter(Boolean)
					.join(" "),
				requiredEnergyKwh,
				maxPowerW: maxW,
				minPowerW: minW,
				pvFirst: true,
				forecastActive: target.forecastActive,
				minimumRuntimeSec: input.config.minimumRuntimeSec,
				batteryEligible: true,
				autoTargetReached: input.autoTargetReached === true,
				reheatHysteresisActive: hysteresisActive,
				reheatHysteresisRuntimeOnly: true,
				reheatHysteresisK: input.config.temperatureHysteresisK,
				nightBridgeActive: nightBridge?.active === true,
				nightBridgeUntilIso: nightBridge?.bridgeUntilIso ?? null,
				nightBridgeTargetTempC: nightBridge?.bridgeTargetTempC ?? null,
				nightBridgeShortfallHours: nightBridge?.shortfallHours ?? null,
				pvPrechargeActive: pvPrecharge?.active === true,
				pvPrechargeExtraK: pvPrecharge?.prechargeExtraK ?? null,
				...thermalLearningDetails(input),
			},
			slots: buildFlexibleDemandSlot({
				generatedAt,
				requiredEnergyKwh,
				maxPowerW: maxW,
				minPowerW: minW,
				available: enabled,
				quality,
				reasonDe,
			}),
		},
	);
}

export function buildImmersionHeaterContributions(input: ImmersionContributionBuildInput): PlanContribution[] {
	return [buildImmersionMandatoryContribution(input), buildImmersionFlexibleContribution(input)];
}
