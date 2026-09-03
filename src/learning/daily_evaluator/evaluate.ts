/**
 * BLOCK A — Orchestrator: ein Tag (day_telemetry) → EvaluationRecord + Findings.
 * Reine Funktion, keine I/O — Persistenz/Batch liegen in persist.ts/batch.ts.
 */

import type { DayTelemetryDayRecord } from "../day_telemetry/types";
import { DAILY_EVALUATOR_SCHEMA_VERSION } from "./constants";
import { evaluateAllDomainEligibility } from "./eligibility";
import { evaluateBatteryFindings } from "./battery_findings";
import { evaluateThermalFindings } from "./thermal_findings";
import { evaluateClimateFindings, evaluateClimatePredictiveDayFindings } from "./climate_findings";
import { evaluateEvFindings } from "./ev_findings";
import { computeDomainScores, computeGlobalScore } from "./scores";
import { EVALUATOR_DOMAIN, type DomainEligibility, type EvaluationRecord, type EvaluatorFinding } from "./types";

function notApplicablePlaceholder(day: DayTelemetryDayRecord, elig: DomainEligibility): EvaluatorFinding {
	return {
		id: `${elig.domain}-not_applicable-${day.dateKey}`,
		dateKey: day.dateKey,
		tsStartIso: new Date(day.startMs).toISOString(),
		tsEndIso: new Date(day.endMs).toISOString(),
		domain: elig.domain,
		assetRef: null,
		eventType: "domain_not_applicable",
		quality: { decisionQuality: "unknown", outcomeQuality: "unknown" },
		confidence: null,
		snapshotIdRef: null,
		measurements: {},
		energyImpactKwh: null,
		costImpactCt: null,
		reasonCodes: [elig.reasonCode],
		explanationDe: elig.reasonDe,
		insufficientData: false,
		notApplicable: true,
		userOverride: false,
	};
}

export function evaluateDay(input: {
	day: DayTelemetryDayRecord;
	/** Folgetag (falls Telemetrie bereits vorliegt) — nur für Cross-Midnight-Checks (Battery-Reserve). */
	nextDay: DayTelemetryDayRecord | null;
	sourceUpdatedAtIso: string;
	sourceTelemetrySchemaVersion: number;
	evaluatedAtIso?: string;
}): { record: EvaluationRecord; findings: EvaluatorFinding[] } {
	const { day, nextDay, sourceUpdatedAtIso, sourceTelemetrySchemaVersion } = input;
	const evaluatedAtIso = input.evaluatedAtIso ?? new Date().toISOString();
	const eligibility = evaluateAllDomainEligibility(day);

	const findings: EvaluatorFinding[] = [];
	for (const elig of eligibility) {
		if (elig.status === "not_applicable") {
			findings.push(notApplicablePlaceholder(day, elig));
			continue;
		}
		switch (elig.domain) {
			case EVALUATOR_DOMAIN.BATTERY:
				findings.push(...evaluateBatteryFindings(day, nextDay));
				break;
			case EVALUATOR_DOMAIN.THERMAL:
				findings.push(...evaluateThermalFindings(day));
				break;
			case EVALUATOR_DOMAIN.CLIMATE:
				findings.push(...evaluateClimateFindings(day));
				findings.push(...evaluateClimatePredictiveDayFindings(day));
				break;
			case EVALUATOR_DOMAIN.EV:
				findings.push(...evaluateEvFindings(day));
				break;
		}
	}

	const scores = computeDomainScores(day, findings);
	const { globalScore, weights } = computeGlobalScore(scores);

	const findingsByDomain: Record<string, number> = {
		battery: 0,
		thermal: 0,
		climate: 0,
		ev: 0,
	};
	for (const f of findings) findingsByDomain[f.domain] = (findingsByDomain[f.domain] ?? 0) + 1;

	const record: EvaluationRecord = {
		evaluatorSchemaVersion: DAILY_EVALUATOR_SCHEMA_VERSION,
		sourceTelemetrySchemaVersion,
		sourceUpdatedAtIso,
		dateKey: day.dateKey,
		timezone: day.timezone,
		evaluatedAtIso,
		dayComplete: day.complete,
		dayEvaluable: day.evaluable,
		dayCoveragePct: day.coveragePct,
		eligibility,
		findingsCount: findings.length,
		findingsByDomain: findingsByDomain as EvaluationRecord["findingsByDomain"],
		scores,
		globalScore,
		globalScoreWeights: weights,
	};

	return { record, findings };
}
