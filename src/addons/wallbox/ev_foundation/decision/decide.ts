/**
 * Phase 3: external-authority vs EMS-takeover decision (diagnostic only).
 * Never writes EVCC / Tibber / Sonnen / Ford / go-e. Never calls button triggers.
 */

import type { EvModelV1, EvModuleState, EvTakeoverReason, EvTakeoverSeverity } from "../types";
import { externalControlExpected, resolveExternalAuthorityState } from "./authority";
import { chargingMinutesForEnergy, computeEnergyNeed, resolveChargePower } from "./energy";
import {
	computeDeadlineRisk,
	computeLatestRequiredStartIso,
	parseDeadlineMs,
	resolveDecisionDeadlineIso,
} from "./latest_start";
import { computePlanCoverage } from "./plan_coverage";
import { evaluatePriceWindows } from "./price_windows";
import type { EvPriceWindow, EvTakeoverDecision, EvTakeoverOutcome } from "./types";

export interface EvTakeoverDecisionInput {
	model: EvModelV1;
	nowMs: number;
	priceWindows?: readonly EvPriceWindow[];
	/** Explicit external/config deadline ISO already resolved by the read layer. */
	externalDeadlineIso?: string | null;
}

function realRequirementEnergyKwh(energyToDepartureMinimumKWh: number | null): number | null {
	return energyToDepartureMinimumKWh;
}

function recommendedEvStateFor(
	outcome: EvTakeoverOutcome,
	authority: EvModelV1["externalAuthorityState"],
	prepared: EvModuleState,
	severity: EvTakeoverSeverity,
): EvModuleState {
	if (severity === "required" || severity === "recommended") return "ems_takeover";
	if (
		outcome === "external" &&
		(authority === "active" ||
			authority === "planned" ||
			authority === "active_without_plan" ||
			authority === "inactive")
	) {
		return "external";
	}
	return prepared;
}

export function applyEvTakeoverDiagnosis(model: EvModelV1, decision: EvTakeoverDecision): EvModelV1 {
	return {
		...model,
		emsTakeoverActive: false,
		preparedEvState: model.preparedEvState,
		recommendedEvState: decision.recommendedEvState,
		externalAuthorityState: decision.externalAuthorityState,
		takeoverSeverity: decision.takeoverSeverity,
		takeoverRecommended: decision.takeoverRecommended,
		takeoverRequired: decision.takeoverRequired,
		takeoverReason: decision.takeoverReason,
	};
}

export function evaluateEvTakeoverDecision(input: EvTakeoverDecisionInput): EvTakeoverDecision {
	const { model, nowMs } = input;
	const authority = resolveExternalAuthorityState(model);
	const chargePower = resolveChargePower(model);
	const energy = computeEnergyNeed(model, chargePower.chargePowerKw);
	const deadlineIso = resolveDecisionDeadlineIso({
		departureAt: model.departureAt,
		vehicleAvailableUntil: model.vehicleAvailableUntil,
		externalDeadlineIso: input.externalDeadlineIso ?? null,
	});
	const deadlineMs = parseDeadlineMs(deadlineIso);
	const requirementKWh = realRequirementEnergyKwh(energy.energyToDepartureMinimumKWh);
	const requirementMinutes = chargingMinutesForEnergy(requirementKWh, chargePower.chargePowerKw);

	const latestRequiredStart =
		model.minimumDepartureSocPct == null
			? null
			: computeLatestRequiredStartIso({
					deadlineMs,
					requiredChargingMinutes: requirementMinutes,
					safetyMarginMin: model.safetyMarginMin,
					energyToRequirementKWh: requirementKWh,
					vehicleSocPct: model.vehicleSocPct,
					batteryCapacityKWh: model.batteryCapacityKWh,
					chargePowerKw: chargePower.chargePowerKw,
				});

	const deadlineRisk = computeDeadlineRisk({
		deadlineMs,
		latestRequiredStart,
		nowMs,
		requiredChargingMinutes: requirementMinutes,
		energyToRequirementKWh: requirementKWh,
	});

	const plan = computePlanCoverage({
		model,
		nowMs,
		deadlineMs,
		fallbackMaxAcKw: chargePower.chargePowerKw,
		energyToTargetKWh: energy.energyToTargetKWh,
		energyToDepartureMinimumKWh: energy.energyToDepartureMinimumKWh,
	});

	const latestMs = parseDeadlineMs(latestRequiredStart);
	const prices = evaluatePriceWindows({
		nowMs,
		deadlineMs,
		chargePowerKw: chargePower.chargePowerKw,
		energyNeededKWh: requirementKWh,
		latestRequiredStartMs: latestMs,
		windows: input.priceWindows ?? [],
		deadlineRisk,
	});

	const reliablePlanCoversRequirement =
		model.externalSmartPlanAvailable === true &&
		plan.remainingEnergyEstimated !== true &&
		plan.externalPlanCoversDepartureMinimum === true;

	const missingHardInputs =
		model.minimumDepartureSocPct != null &&
		deadlineMs != null &&
		(model.vehicleSocPct == null ||
			model.batteryCapacityKWh == null ||
			chargePower.chargePowerKw == null ||
			model.chargingEfficiency == null);

	let outcome: EvTakeoverOutcome;
	let severity: EvTakeoverSeverity = "none";
	let reason: EvTakeoverReason | null = null;

	if (model.vehicleConnected === false) {
		outcome = "not_applicable";
	} else if (!externalControlExpected(model)) {
		outcome = "no_external_control";
	} else if (authority === "unavailable") {
		reason = "external_unavailable";
		if (deadlineRisk === true) {
			outcome = "ems_takeover_required";
			severity = "required";
			reason = "deadline_risk";
		} else {
			outcome = "external";
			severity = "observe";
		}
	} else if (missingHardInputs) {
		outcome = "insufficient_data";
		severity = "observe";
	} else if (deadlineRisk === true) {
		outcome = "ems_takeover_required";
		severity = "required";
		reason = "deadline_risk";
	} else if (
		model.externalSmartPlanAvailable &&
		plan.externalPlanCoversDepartureMinimum === false &&
		requirementKWh != null &&
		requirementKWh > 0 &&
		deadlineMs != null
	) {
		outcome = "ems_takeover_required";
		severity = "required";
		reason = "insufficient_external_plan";
	} else if (reliablePlanCoversRequirement) {
		outcome = "external";
		severity = "none";
		reason = null;
	} else if (prices.economicWindowLossRisk === true) {
		outcome = "ems_takeover_recommended";
		severity = "recommended";
		reason = "economic_window_loss";
	} else if (
		externalControlExpected(model) &&
		!model.externalSmartPlanAvailable &&
		deadlineMs != null &&
		deadlineRisk === false &&
		requirementKWh != null
	) {
		outcome = "external";
		severity = "observe";
		reason = null;
	} else {
		outcome = "external";
		severity = "none";
		reason = null;
	}

	const takeoverRequired = severity === "required";
	const takeoverRecommended = severity === "recommended";
	const recommendedEvState = recommendedEvStateFor(outcome, authority, model.preparedEvState, severity);

	const explain: Record<string, unknown> = {
		vehicleSocPct: model.vehicleSocPct,
		targetSocPct: model.targetSocPct,
		minimumDepartureSocPct: model.minimumDepartureSocPct,
		externalSmartChargingMinSocPct: model.externalSmartChargingMinSocPct,
		departureAt: model.departureAt,
		deadlineIso,
		energyToTargetKWh: energy.energyToTargetKWh,
		energyToDepartureMinimumKWh: energy.energyToDepartureMinimumKWh,
		chargePowerKw: chargePower.chargePowerKw,
		chargePowerSource: chargePower.source,
		requiredChargingMinutes: energy.requiredChargingMinutes,
		requirementChargingMinutes: requirementMinutes,
		safetyMarginMin: model.safetyMarginMin,
		latestRequiredStart,
		externalAuthorityState: authority,
		gridRewardsActive: model.gridRewardsActive,
		smartChargingActive: model.smartChargingActive,
		externalSmartPlanAvailable: model.externalSmartPlanAvailable,
		externalPlanRemainingEnergyKWh: plan.externalPlanRemainingEnergyKWh,
		externalPlanRemainingMinutes: plan.externalPlanRemainingMinutes,
		externalPlanCoversTarget: plan.externalPlanCoversTarget,
		externalPlanCoversDepartureMinimum: plan.externalPlanCoversDepartureMinimum,
		remainingFeasibleEnergyKWh: prices.remainingFeasibleEnergyKWh,
		remainingCheapEnergyKWh: prices.remainingCheapEnergyKWh,
		cheapWindowEnergyCapacityKWh: prices.cheapWindowEnergyCapacityKWh,
		deadlineRisk,
		economicWindowLossRisk: prices.economicWindowLossRisk,
		takeoverReason: reason,
		takeoverSeverity: severity,
		outcome,
		dataQuality: model.dataQuality,
		vehicleSocQuality: model.vehicleSocQuality,
		externalSourceQuality: model.externalSourceQuality,
		externalSourceHealthy: model.externalSourceHealthy,
		reliablePlanCoversRequirement,
		vehicleConnected: model.vehicleConnected,
		charging: model.charging,
		preparedEvState: model.preparedEvState,
		recommendedEvState,
		emsTakeoverActive: false,
		phase: "decision_diagnostic_only",
	};

	return {
		outcome,
		externalAuthorityState: authority,
		energyToTargetKWh: energy.energyToTargetKWh,
		energyToDepartureMinimumKWh: energy.energyToDepartureMinimumKWh,
		requiredChargingMinutes: energy.requiredChargingMinutes,
		latestRequiredStart,
		deadlineIso,
		deadlineRisk,
		externalPlanExpectedSocGainPct: plan.externalPlanExpectedSocGainPct,
		externalPlanExpectedFinalSocPct: plan.externalPlanExpectedFinalSocPct,
		externalPlanCoversTarget: plan.externalPlanCoversTarget,
		externalPlanCoversDepartureMinimum: plan.externalPlanCoversDepartureMinimum,
		remainingFeasibleEnergyKWh: prices.remainingFeasibleEnergyKWh,
		remainingCheapEnergyKWh: prices.remainingCheapEnergyKWh,
		cheapWindowEnergyCapacityKWh: prices.cheapWindowEnergyCapacityKWh,
		economicWindowLossRisk: prices.economicWindowLossRisk,
		takeoverRecommended,
		takeoverRequired,
		takeoverSeverity: severity,
		takeoverReason: reason,
		recommendedEvState,
		chargePower,
		explain,
	};
}
