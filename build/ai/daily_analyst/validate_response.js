"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateAiAnalystResponse = void 0;
const types_1 = require("./types");
const MAX_FINDINGS = 10;
function str(v) {
    return typeof v === "string" ? v.trim() : "";
}
/**
 * Strikt: unvollständige/fehlerhafte einzelne Findings werden verworfen (nicht geraten/aufgefüllt) —
 * eine fehlerhafte Antwortstruktur führt zu `ok:false` (gesamte Antwort verworfen, kein Teilvertrauen).
 */
function validateAiAnalystResponse(raw, dateKey) {
    if (!raw || typeof raw !== "object") {
        return { ok: false, issues: ["response_not_object"] };
    }
    const findingsRaw = raw.findings;
    if (!Array.isArray(findingsRaw)) {
        return { ok: false, issues: ["findings_not_array"] };
    }
    const findings = [];
    const issues = [];
    for (const f of findingsRaw.slice(0, MAX_FINDINGS)) {
        if (!f || typeof f !== "object") {
            issues.push("finding_not_object");
            continue;
        }
        const o = f;
        const findingType = str(o.finding_type);
        const domain = str(o.domain);
        const severity = str(o.severity);
        const confidenceRaw = typeof o.confidence_pct === "number" ? o.confidence_pct : Number(o.confidence_pct);
        const evidence = Array.isArray(o.evidence) ? o.evidence.filter((e) => typeof e === "string") : [];
        const observedBehaviorDe = str(o.observed_behavior_de);
        const suggestedImprovementDe = str(o.suggested_improvement_de);
        const affectedParameter = typeof o.affected_parameter === "string" ? o.affected_parameter : null;
        const proposedRaw = o.proposed_numeric_value;
        const proposedNumericValue = proposedRaw === null || proposedRaw === undefined
            ? null
            : typeof proposedRaw === "number" && Number.isFinite(proposedRaw)
                ? proposedRaw
                : Number.isFinite(Number(proposedRaw))
                    ? Number(proposedRaw)
                    : null;
        const expectedDirection = str(o.expected_direction);
        const uncertaintyDe = str(o.uncertainty_de);
        if (!findingType) {
            issues.push("missing_finding_type");
            continue;
        }
        if (!types_1.AI_ANALYST_ALLOWED_DOMAINS.includes(domain)) {
            issues.push(`invalid_domain:${domain}`);
            continue;
        }
        if (!types_1.AI_ANALYST_ALLOWED_SEVERITIES.includes(severity)) {
            issues.push(`invalid_severity:${severity}`);
            continue;
        }
        if (!Number.isFinite(confidenceRaw) || confidenceRaw < 0 || confidenceRaw > 100) {
            issues.push("invalid_confidence_pct");
            continue;
        }
        if (evidence.length === 0) {
            issues.push("missing_evidence");
            continue;
        }
        if (!observedBehaviorDe || !suggestedImprovementDe) {
            issues.push("missing_prose");
            continue;
        }
        if (!types_1.AI_ANALYST_ALLOWED_DIRECTIONS.includes(expectedDirection)) {
            issues.push(`invalid_direction:${expectedDirection}`);
            continue;
        }
        findings.push({
            findingType: findingType.slice(0, 80),
            domain: domain,
            severity: severity,
            confidencePct: Math.round(confidenceRaw),
            evidence: evidence.slice(0, 10).map((e) => e.slice(0, 200)),
            observedBehaviorDe: observedBehaviorDe.slice(0, 400),
            suggestedImprovementDe: suggestedImprovementDe.slice(0, 400),
            affectedParameter: affectedParameter ? affectedParameter.slice(0, 120) : null,
            proposedNumericValue,
            expectedDirection: expectedDirection,
            uncertaintyDe: uncertaintyDe.slice(0, 240) || "Keine Unsicherheitsangabe.",
            dateKey,
        });
    }
    return { ok: true, findings };
}
exports.validateAiAnalystResponse = validateAiAnalystResponse;
