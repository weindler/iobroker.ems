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
	/** Puffer / Heizstabfühler — Soft + Safety. */
	bufferTempC: number | null;
	/** Boiler Brauchwasser — Hard-Bedarf. */
	boilerTempC?: number | null;
	/** true wenn Boiler-Mapping fehlt/stale. */
	boilerSensorDegraded?: boolean;
	thermalMode: "off" | "auto" | "force";
	fault: boolean;
	lockout: boolean;
	relayMapped: boolean;
	pvTodayKwh: number | null;
	pvTomorrowKwh: number | null;
	pvBiasStatus: string | null;
	forecastModeEnabled: boolean;
	aiOptimizationAllowed: boolean;
	/** Puffer-Learning — nicht mehr planungswirksam (Stab-Cap ist live planningMax). */
	thermalLearning?: ThermalLearningSignal | null;
	/** Boiler-Learning (`learning.thermal_boiler.*`) — Hard-Deadline nur wenn valid/usable. */
	boilerLearning?: ThermalLearningSignal | null;
	/** Hygiene-Pflicht fällig (Boiler). */
	hygieneDue?: boolean;
	hygieneMandatoryKwh?: number | null;
	hygieneReasonDe?: string | null;
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
	if (!input.boilerLearning) return null;
	return {
		status: input.boilerLearning.status,
		coolingRateCPerHAvg: input.boilerLearning.coolingRateCPerHAvg,
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

/** Boiler-Learning für Daily-Plan-Status; Puffer-Learner nicht mehr als degrade-Quelle. */
function thermalLearningDetails(input: ImmersionContributionBuildInput): Record<string, unknown> {
	const boiler = input.boilerLearning ?? null;
	const cycle = hasCycleCoolingModel(boiler);
	return {
		thermalLearningStatus: cycle ? (boiler?.status ?? "missing") : "missing",
		thermalLearningHealth: boiler?.health ?? null,
		thermalLearningSamples: boiler?.samples ?? null,
		coolingRateCPerHAvg: boiler?.coolingRateCPerHAvg ?? null,
		coolingConstantPerH: boiler?.coolingConstantPerH ?? null,
		coolingAsymptoteC: boiler?.coolingAsymptoteC ?? null,
		estimatedRemainingHours: boiler?.estimatedRemainingHours ?? null,
		bufferEstimatedEmptyAt: null,
		thermalLearningModel: cycle ? "cycle" : hasNewtonEmptyAtModel(boiler) ? "newton" : "none",
		bufferLearningModel: "unused",
		thermalLearningDegradedCauseDe: cycle ? thermalLearningDegradedCauseDe(boiler) : null,
		learnedDayTypeRuntimeHoursMedian: boiler?.currentDayTypeRuntimeHoursMedian ?? null,
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

/**
 * Boiler-Minimum ist Pflichtbedarf (Lastenheft §5.4) — nicht erst "deutlich darunter".
 * Kleine Sensor-Toleranz, damit exakt-am-Minimum nicht als "kein Pflichtbedarf" gilt.
 */
const BOILER_MIN_TOLERANCE_C = 0.05;

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

	const boilerTemp = input.boilerTempC ?? null;
	const boilerMin = input.config.boilerMinTempC;
	const hygieneDue = input.hygieneDue === true;
	const mandatoryReason =
		input.thermalMode === "force"
			? "Betreiberbefehl force — Pflichtbedarf."
			: hygieneDue
				? input.hygieneReasonDe ?? "Hygiene-Pflicht (Boiler)."
				: boilerTemp !== null && boilerTemp <= boilerMin + BOILER_MIN_TOLERANCE_C
					? boilerTemp < boilerMin
						? `Boiler ${round3(boilerTemp)} °C unter Mindesttemperatur ${boilerMin} °C.`
						: `Boiler ${round3(boilerTemp)} °C auf Mindesttemperatur ${boilerMin} °C — Pflichtbedarf.`
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
		/** Soft/Safety braucht Puffer; Hard braucht Boiler — Participation erlaubt wenn eines da. */
		telemetryValid: input.bufferTempC !== null || boilerTemp !== null,
	});

	const mandatory = mandatoryReason !== null;
	const maxW = maxStagePowerW(input.config);
	const minW = minStagePowerW(input.config);
	const enabled = mandatory && participation.allowed && !input.globalModeOff;
	const mandatoryTargetC =
		input.thermalMode === "force"
			? input.config.planningMaxTempC
			: hygieneDue
				? input.config.hygieneTargetTempC
				: boilerMin;
	const energyFromTemp = boilerTemp !== null ? boilerTemp : null;
	const requiredEnergyKwh =
		mandatory && energyFromTemp !== null && maxW !== null
			? estimateImmersionRequiredEnergyKwh(energyFromTemp, mandatoryTargetC, maxW, learningMargin(input))
			: hygieneDue
				? (input.hygieneMandatoryKwh ?? null)
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
				boilerTempC: boilerTemp,
				boilerMinTempC: boilerMin,
				mandatoryMinTempC: boilerMin,
				planningMaxTempC: input.config.planningMaxTempC,
				hygieneTargetTempC: input.config.hygieneTargetTempC,
				hygieneDue,
				hygieneMandatoryKwh: input.hygieneMandatoryKwh ?? null,
				hygieneReasonDe: input.hygieneReasonDe ?? null,
				boilerSensorDegraded: input.boilerSensorDegraded === true,
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
	 * Nachtbrücke nur aus Boiler-Zyklen (nicht Puffer-Newton).
	 * Puffer-Temperatur bleibt der 63-°C-Safety-Cap, kein Kühlmodell.
	 */
	const nightBridge =
		input.boilerTempC != null &&
		thermalEmptyAtUsableForPlanning(input.boilerLearning) &&
		hasCycleCoolingModel(input.boilerLearning)
			? resolveImmersionNightBridge({
					now: input.now,
					bufferTempC: input.boilerTempC,
					planningMinTempC: input.config.boilerMinTempC,
					planningMaxTempC: input.config.planningMaxTempC,
					forecastTargetTempC: target.targetTempC,
					coolingRateCPerHAvg: input.boilerLearning!.coolingRateCPerHAvg!,
					estimatedEmptyAtIso: input.boilerLearning!.estimatedEmptyAt!,
					timezone: input.timezone,
				})
			: null;

	const afterBridgeTempC = nightBridge?.active
		? nightBridge.effectiveTargetTempC
		: target.targetTempC;

	/*
	 * PV-Vorladung: Puffer live nur als Stab-Cap (planningMax, typ. 63 °C).
	 * Reichweite/emptyAt kommt vom Boiler, nicht vom Puffer-Learner.
	 */
	const boilerCycleUsable =
		thermalEmptyAtUsableForPlanning(input.boilerLearning) &&
		hasCycleCoolingModel(input.boilerLearning);
	const canConsiderPrecharge =
		input.bufferTempC !== null &&
		(boilerCycleUsable || (input.todayPvSurplusKwh != null && input.todayPvSurplusKwh >= 3));
	const pvPrecharge = canConsiderPrecharge
		? resolveThermalPvPrecharge({
				now: input.now,
				bufferTempC: input.bufferTempC!,
				planningMinTempC: input.config.planningMinTempC,
				planningMaxTempC: input.config.planningMaxTempC,
				baseTargetTempC: afterBridgeTempC,
				coolingRateCPerHAvg: boilerCycleUsable
					? input.boilerLearning!.coolingRateCPerHAvg
					: null,
				estimatedEmptyAtIso: boilerCycleUsable ? input.boilerLearning!.estimatedEmptyAt : null,
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
	 * Soft-Beitrag: keine Hard-Deadline aus dem Flex-Beitrag.
	 * Nachtbrücke darf das Soft-Ziel anheben, setzt aber keine Hard-Deadline.
	 * Boiler-emptyAt nur bei Cycle-Learning in Details → Unified Hard-Consumer.
	 */
	const boilerLearning = input.boilerLearning ?? null;
	/*
	 * Hard-Bridge braucht ein nutzbares Boiler-emptyAt auch dann, wenn der Cycle-Status
	 * noch nicht "valid" ist. Sonst wird ein klarer Min-Fall (z. B. "unter 50 °C um 18:24")
	 * im Planner ignoriert. Night-Bridge bleibt weiterhin strikt cycle-basiert.
	 */
	const boilerEmptyUsable =
		(thermalEmptyAtUsableForPlanning(boilerLearning) ||
			(Boolean(boilerLearning?.estimatedEmptyAt) &&
				(hasNewtonEmptyAtModel(boilerLearning) ||
					((boilerLearning?.estimatedRemainingHours ?? 0) > 0)))) &&
		Boolean(boilerLearning?.estimatedEmptyAt);
	const boilerEstimatedEmptyAt = boilerEmptyUsable ? boilerLearning!.estimatedEmptyAt : null;
	const boilerEmptyAtSource = boilerEmptyUsable ? emptyAtSourceOf(boilerLearning) : null;

	if (boilerEstimatedEmptyAt) {
		reasonDe = `${reasonDe} Boiler-Reichweite ${boilerEstimatedEmptyAt} (${boilerEmptyAtSource ?? "unknown"}).`;
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
			/** Soft: keine Hard-Deadline aus Buffer. */
			deadlineIso: null,
			quality,
			reasonDe,
			details: {
				...thermalLearningDetails(input),
				bufferTempC: input.bufferTempC,
				boilerTempC: input.boilerTempC ?? null,
				boilerMinTempC: input.config.boilerMinTempC,
				boilerSensorDegraded: input.boilerSensorDegraded === true,
				targetTempC: effectiveTargetTempC,
				forecastTargetTempC: target.targetTempC,
				planningMinTempC: input.config.planningMinTempC,
				planningMaxTempC: input.config.planningMaxTempC,
				mandatoryMinTempC: input.config.boilerMinTempC,
				hygieneTargetTempC: input.config.hygieneTargetTempC,
				hygieneDue: input.hygieneDue === true,
				hygieneMandatoryKwh: input.hygieneMandatoryKwh ?? null,
				hygieneReasonDe: input.hygieneReasonDe ?? null,
				/** Puffer-emptyAt wird nicht mehr geplant — Stab-Cap bleibt planningMaxTempC. */
				bufferEstimatedEmptyAt: null,
				softThermalSource: "buffer_cap",
				/** Boiler-emptyAt für Hard-Deadline (nur wenn usable). */
				boilerEstimatedEmptyAt,
				estimatedEmptyAt: boilerEstimatedEmptyAt,
				emptyAtSource: boilerEmptyAtSource,
				emptyAtPlanningUsable: boilerEmptyUsable,
				boilerCoolingRateCPerHAvg: boilerLearning?.coolingRateCPerHAvg ?? null,
				boilerCoolingConstantPerH: boilerLearning?.coolingConstantPerH ?? null,
				boilerCoolingAsymptoteC: boilerLearning?.coolingAsymptoteC ?? null,
				boilerLearningModel: hasCycleCoolingModel(boilerLearning)
					? "cycle"
					: hasNewtonEmptyAtModel(boilerLearning)
						? "newton"
						: "none",
				boilerLearningSamples: boilerLearning?.samples ?? null,
				hardThermalSource: "boiler",
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
