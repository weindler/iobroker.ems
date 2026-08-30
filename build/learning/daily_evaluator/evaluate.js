"use strict";
/**
 * BLOCK A — Orchestrator: ein Tag (day_telemetry) → EvaluationRecord + Findings.
 * Reine Funktion, keine I/O — Persistenz/Batch liegen in persist.ts/batch.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateDay = void 0;
const constants_1 = require("./constants");
const eligibility_1 = require("./eligibility");
const battery_findings_1 = require("./battery_findings");
const thermal_findings_1 = require("./thermal_findings");
const climate_findings_1 = require("./climate_findings");
const ev_findings_1 = require("./ev_findings");
const scores_1 = require("./scores");
const types_1 = require("./types");
function notApplicablePlaceholder(day, elig) {
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
function evaluateDay(input) {
    const { day, nextDay, sourceUpdatedAtIso, sourceTelemetrySchemaVersion } = input;
    const evaluatedAtIso = input.evaluatedAtIso ?? new Date().toISOString();
    const eligibility = (0, eligibility_1.evaluateAllDomainEligibility)(day);
    const findings = [];
    for (const elig of eligibility) {
        if (elig.status === "not_applicable") {
            findings.push(notApplicablePlaceholder(day, elig));
            continue;
        }
        switch (elig.domain) {
            case types_1.EVALUATOR_DOMAIN.BATTERY:
                findings.push(...(0, battery_findings_1.evaluateBatteryFindings)(day, nextDay));
                break;
            case types_1.EVALUATOR_DOMAIN.THERMAL:
                findings.push(...(0, thermal_findings_1.evaluateThermalFindings)(day));
                break;
            case types_1.EVALUATOR_DOMAIN.CLIMATE:
                findings.push(...(0, climate_findings_1.evaluateClimateFindings)(day));
                break;
            case types_1.EVALUATOR_DOMAIN.EV:
                findings.push(...(0, ev_findings_1.evaluateEvFindings)(day));
                break;
        }
    }
    const scores = (0, scores_1.computeDomainScores)(day, findings);
    const { globalScore, weights } = (0, scores_1.computeGlobalScore)(scores);
    const findingsByDomain = {
        battery: 0,
        thermal: 0,
        climate: 0,
        ev: 0,
    };
    for (const f of findings)
        findingsByDomain[f.domain] = (findingsByDomain[f.domain] ?? 0) + 1;
    const record = {
        evaluatorSchemaVersion: constants_1.DAILY_EVALUATOR_SCHEMA_VERSION,
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
        findingsByDomain: findingsByDomain,
        scores,
        globalScore,
        globalScoreWeights: weights,
    };
    return { record, findings };
}
exports.evaluateDay = evaluateDay;
