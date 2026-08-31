/**
 * PHASE 4 — KI Daily Analyst.
 *
 * Die KI ist hier ausschließlich Analyst, nie Regler: sie liest eine kompakte, strukturierte
 * Tageszusammenfassung (Daily-Evaluator-Findings/Scores, keine Rohtelemetrie) und liefert
 * strukturierte Findings zurück. Kein Schaltbefehl, kein Config-Write, kein Planner-Write.
 */

export type AiAnalystDomain =
	| "pv_forecast"
	| "battery"
	| "thermal"
	| "climate"
	| "ev"
	| "grid"
	| "price_timing"
	| "general";

export type AiAnalystSeverity = "info" | "notice" | "warning";

export type AiAnalystExpectedDirection = "cost_down" | "comfort_up" | "reserve_safety_up" | "unclear";

export type AiAnalystFinding = {
	findingType: string;
	domain: AiAnalystDomain;
	severity: AiAnalystSeverity;
	/** 0..100 — Selbsteinschätzung der KI, kein garantierter Wert. */
	confidencePct: number;
	evidence: string[];
	observedBehaviorDe: string;
	suggestedImprovementDe: string;
	/** Betroffener Planner-Parameter/Policy-Bezeichner, falls sinnvoll zuordenbar — sonst null. */
	affectedParameter: string | null;
	/**
	 * Optionaler numerischer Vorschlag für Phase-6-Validator. Fehlt er, entsteht kein Override
	 * (kein Raten). Nur Allowlist-Parameter werden überhaupt angenommen.
	 */
	proposedNumericValue: number | null;
	expectedDirection: AiAnalystExpectedDirection;
	uncertaintyDe: string;
	dateKey: string;
};

export type AiAnalystRunResult = {
	ran: boolean;
	status: "ok" | "disabled" | "no_token" | "no_data" | "error" | "invalid_response";
	dateKey: string | null;
	findings: AiAnalystFinding[];
	reasonDe: string;
	usage: { promptTokens: number | null; completionTokens: number | null };
	error?: string;
};

export const AI_ANALYST_ALLOWED_DOMAINS: AiAnalystDomain[] = [
	"pv_forecast",
	"battery",
	"thermal",
	"climate",
	"ev",
	"grid",
	"price_timing",
	"general",
];
export const AI_ANALYST_ALLOWED_SEVERITIES: AiAnalystSeverity[] = ["info", "notice", "warning"];
export const AI_ANALYST_ALLOWED_DIRECTIONS: AiAnalystExpectedDirection[] = [
	"cost_down",
	"comfort_up",
	"reserve_safety_up",
	"unclear",
];
