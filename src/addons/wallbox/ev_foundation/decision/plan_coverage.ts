/**
 * External smart-plan coverage from normalized slots only.
 */

import type { EvModelV1 } from "../types";
import { computeExternalPlanRemainingEnergy } from "../external/remaining_energy";
import type { EvPlanCoverage } from "./types";

const ENERGY_EPS_KWH = 0.05;
const SOC_EPS_PCT = 0.5;

function covers(remainingKWh: number | null, needKWh: number | null): boolean | null {
	if (needKWh == null || remainingKWh == null) return null;
	if (needKWh <= ENERGY_EPS_KWH) return true;
	return remainingKWh + ENERGY_EPS_KWH >= needKWh;
}

export function computePlanCoverage(input: {
	model: EvModelV1;
	nowMs: number;
	deadlineMs: number | null;
	fallbackMaxAcKw: number | null;
	energyToTargetKWh: number | null;
	energyToDepartureMinimumKWh: number | null;
}): EvPlanCoverage {
	const { model } = input;
	const slots = model.externalSmartPlanSlots;
	let remainingEnergyKWh = model.externalPlanRemainingEnergyKWh;
	let remainingMinutes = model.externalPlanRemainingMinutes;
	let estimated = false;

	if (!model.externalSmartPlanAvailable) {
		return {
			externalPlanRemainingEnergyKWh: remainingEnergyKWh,
			externalPlanRemainingMinutes: remainingMinutes,
			externalPlanExpectedSocGainPct: null,
			externalPlanExpectedFinalSocPct: null,
			externalPlanCoversTarget: null,
			externalPlanCoversDepartureMinimum: null,
			remainingEnergyEstimated: false,
		};
	}

	if (slots != null) {
		const computed = computeExternalPlanRemainingEnergy({
			slots,
			nowMs: input.nowMs,
			deadlineMs: input.deadlineMs,
			fallbackMaxAcKw: input.fallbackMaxAcKw,
		});
		remainingEnergyKWh = computed.remainingEnergyKWh;
		remainingMinutes = computed.remainingMinutes;
		estimated = computed.estimated;
	}

	let expectedSocGainPct: number | null = null;
	let expectedFinalSocPct: number | null = null;
	const cap = model.batteryCapacityKWh;
	const eff = model.chargingEfficiency;
	const soc = model.vehicleSocPct;
	if (remainingEnergyKWh != null && cap != null && cap > 0 && eff != null && eff > 0 && soc != null) {
		const batteryKWh = remainingEnergyKWh * eff;
		expectedSocGainPct = Math.round((batteryKWh / cap) * 1000) / 10;
		expectedFinalSocPct = Math.round(Math.min(100, Math.max(0, soc + expectedSocGainPct)) * 10) / 10;
	}

	let coversDeparture = covers(remainingEnergyKWh, input.energyToDepartureMinimumKWh);
	if (
		coversDeparture == null &&
		expectedFinalSocPct != null &&
		model.minimumDepartureSocPct != null
	) {
		coversDeparture = expectedFinalSocPct + SOC_EPS_PCT >= model.minimumDepartureSocPct;
	}
	let coversTarget = covers(remainingEnergyKWh, input.energyToTargetKWh);
	if (coversTarget == null && expectedFinalSocPct != null && model.targetSocPct != null) {
		coversTarget = expectedFinalSocPct + SOC_EPS_PCT >= model.targetSocPct;
	}

	return {
		externalPlanRemainingEnergyKWh: remainingEnergyKWh,
		externalPlanRemainingMinutes: remainingMinutes,
		externalPlanExpectedSocGainPct: expectedSocGainPct,
		externalPlanExpectedFinalSocPct: expectedFinalSocPct,
		externalPlanCoversTarget: coversTarget,
		externalPlanCoversDepartureMinimum: coversDeparture,
		remainingEnergyEstimated: estimated,
	};
}
