import {
	AI_ANALYST_ALLOWED_DIRECTIONS,
	AI_ANALYST_ALLOWED_DOMAINS,
	AI_ANALYST_ALLOWED_SEVERITIES,
	type AiAnalystFinding,
} from "./types";

export type AiAnalystResponseValidation =
	| { ok: true; findings: AiAnalystFinding[] }
	| { ok: false; issues: string[] };

const MAX_FINDINGS = 10;

function str(v: unknown): string {
	return typeof v === "string" ? v.trim() : "";
}

/**
 * Strikt: unvollständige/fehlerhafte einzelne Findings werden verworfen (nicht geraten/aufgefüllt) —
 * eine fehlerhafte Antwortstruktur führt zu `ok:false` (gesamte Antwort verworfen, kein Teilvertrauen).
 */
export function validateAiAnalystResponse(raw: unknown, dateKey: string): AiAnalystResponseValidation {
	if (!raw || typeof raw !== "object") {
		return { ok: false, issues: ["response_not_object"] };
	}
	const findingsRaw = (raw as Record<string, unknown>).findings;
	if (!Array.isArray(findingsRaw)) {
		return { ok: false, issues: ["findings_not_array"] };
	}

	const findings: AiAnalystFinding[] = [];
	const issues: string[] = [];
	for (const f of findingsRaw.slice(0, MAX_FINDINGS)) {
		if (!f || typeof f !== "object") {
			issues.push("finding_not_object");
			continue;
		}
		const o = f as Record<string, unknown>;
		const findingType = str(o.finding_type);
		const domain = str(o.domain);
		const severity = str(o.severity);
		const confidenceRaw = typeof o.confidence_pct === "number" ? o.confidence_pct : Number(o.confidence_pct);
		const evidence = Array.isArray(o.evidence) ? o.evidence.filter((e) => typeof e === "string") : [];
		const observedBehaviorDe = str(o.observed_behavior_de);
		const suggestedImprovementDe = str(o.suggested_improvement_de);
		const affectedParameter = typeof o.affected_parameter === "string" ? o.affected_parameter : null;
		const proposedRaw = o.proposed_numeric_value;
		const proposedNumericValue =
			proposedRaw === null || proposedRaw === undefined
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
		if (!AI_ANALYST_ALLOWED_DOMAINS.includes(domain as (typeof AI_ANALYST_ALLOWED_DOMAINS)[number])) {
			issues.push(`invalid_domain:${domain}`);
			continue;
		}
		if (!AI_ANALYST_ALLOWED_SEVERITIES.includes(severity as (typeof AI_ANALYST_ALLOWED_SEVERITIES)[number])) {
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
		if (
			!AI_ANALYST_ALLOWED_DIRECTIONS.includes(
				expectedDirection as (typeof AI_ANALYST_ALLOWED_DIRECTIONS)[number],
			)
		) {
			issues.push(`invalid_direction:${expectedDirection}`);
			continue;
		}
		findings.push({
			findingType: findingType.slice(0, 80),
			domain: domain as AiAnalystFinding["domain"],
			severity: severity as AiAnalystFinding["severity"],
			confidencePct: Math.round(confidenceRaw),
			evidence: evidence.slice(0, 10).map((e) => e.slice(0, 200)),
			observedBehaviorDe: observedBehaviorDe.slice(0, 400),
			suggestedImprovementDe: suggestedImprovementDe.slice(0, 400),
			affectedParameter: affectedParameter ? affectedParameter.slice(0, 120) : null,
			proposedNumericValue,
			expectedDirection: expectedDirection as AiAnalystFinding["expectedDirection"],
			uncertaintyDe: uncertaintyDe.slice(0, 240) || "Keine Unsicherheitsangabe.",
			dateKey,
		});
	}

	return { ok: true, findings };
}
