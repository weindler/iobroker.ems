/**
 * BLOCK A — Diagnostisches Learning (rein additiv, eigener State).
 *
 * KRITISCH: Schreibt/liest NIE pv_bias, battery_runtime, thermal_runtime, house_load
 * oder andere aktive Learning-Module. Kein Ergebnis aus diesem Modul verändert reales
 * Planner-/Control-Verhalten — ausschließlich Diagnose/Anzeige.
 *
 * Domain-basiert: ein Tag mit day.evaluable=false kann trotzdem einzelne Domänen-Samples
 * liefern, wenn genau diese Domäne an dem Tag konklusiv war (Korrektur #6).
 * Idempotent über lastProcessedDateKey — ein bereits verarbeiteter (oder älterer) Tag wird
 * nicht doppelt eingerechnet.
 */

import { updateLearningMetric } from "./learning_math";
import type { DailyEvaluatorLearningState, EvaluationRecord, EvaluatorFinding } from "./types";

const TARGET_SAMPLES_DAILY_METRIC = 20;

function classificationToScore(q: string): number | null {
	switch (q) {
		case "mandatory":
		case "necessary":
		case "reasonable":
			return 100;
		case "early":
			return 80;
		case "avoidable":
			return 50;
		case "wasteful":
			return 0;
		default:
			return null;
	}
}

export function applyDayToLearningState(
	state: DailyEvaluatorLearningState,
	record: EvaluationRecord,
	findings: EvaluatorFinding[],
	nowIso: string = new Date().toISOString(),
): DailyEvaluatorLearningState {
	if (state.lastProcessedDateKey && record.dateKey <= state.lastProcessedDateKey) {
		return state;
	}

	let next = { ...state };

	for (const f of findings) {
		if (f.insufficientData || f.notApplicable) continue;

		if (f.domain === "battery" && f.eventType === "battery_reserve_check") {
			const held = f.reasonCodes.includes("reserve_held");
			next = {
				...next,
				batteryReserveAccuracyPct: updateLearningMetric(
					next.batteryReserveAccuracyPct,
					held ? 100 : 0,
					nowIso,
					TARGET_SAMPLES_DAILY_METRIC,
				),
			};
		}

		if (f.domain === "thermal" && f.reasonCodes.includes("daily_plan_price_timed")) {
			const score = classificationToScore(f.quality.outcomeQuality);
			if (score != null) {
				next = {
					...next,
					thermalPriceTimingScore: updateLearningMetric(
						next.thermalPriceTimingScore,
						score,
						nowIso,
						TARGET_SAMPLES_DAILY_METRIC,
					),
				};
			}
		}

		if (f.domain === "climate" && f.reasonCodes.includes("price_timed")) {
			const score = classificationToScore(f.quality.outcomeQuality);
			if (score != null) {
				next = {
					...next,
					climatePriceTimingScore: updateLearningMetric(
						next.climatePriceTimingScore,
						score,
						nowIso,
						TARGET_SAMPLES_DAILY_METRIC,
					),
				};
			}
		}

		if (f.domain === "ev" && f.eventType === "ev_readiness_check") {
			const met = f.reasonCodes.includes("ev_readiness_met");
			next = {
				...next,
				evReadinessMetRatePct: updateLearningMetric(
					next.evReadinessMetRatePct,
					met ? 100 : 0,
					nowIso,
					TARGET_SAMPLES_DAILY_METRIC,
				),
			};
		}
	}

	const pvScore = record.scores.find((s) => s.topic === "pv");
	if (pvScore?.value != null) {
		next = {
			...next,
			pvUtilizationPct: updateLearningMetric(next.pvUtilizationPct, pvScore.value, nowIso, TARGET_SAMPLES_DAILY_METRIC),
		};
	}

	const priceScore = record.scores.find((s) => s.topic === "price");
	if (priceScore?.value != null) {
		next = {
			...next,
			priceEfficiencyScore: updateLearningMetric(
				next.priceEfficiencyScore,
				priceScore.value,
				nowIso,
				TARGET_SAMPLES_DAILY_METRIC,
			),
		};
	}

	next = { ...next, lastProcessedDateKey: record.dateKey, updatedAtIso: nowIso };
	return next;
}
