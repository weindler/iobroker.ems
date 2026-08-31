/**
 * PHASE 6 — KI Validator & Controlled Optimization.
 *
 * Architektur (verbindlich, siehe .cursor/rules/ems-light-development.mdc):
 *   KI → strukturierte Empfehlung → deterministischer Validator →
 *   zeitlich begrenzter validierter Planner-Override → normaler EMS-Planner → Safety → Gerät.
 *
 * KI schreibt niemals direkt auf Geräte, ändert niemals dauerhaft die Nutzer-Konfiguration.
 * Nach Ablauf der TTL fällt automatisch auf die normale Konfiguration zurück (kein Rollback-Code
 * nötig — ein abgelaufener Override wird von `resolveActiveOverrideValue` einfach nicht mehr
 * zurückgegeben; der Aufrufer verwendet dann automatisch wieder `originalValue`/baseConfig).
 */

export type AiOverrideStatus = "active" | "expired" | "rejected";

/** Unvalidierter Empfehlungs-Rohvorschlag einer KI-Quelle (Analyst, Optimizer, o. ä.). */
export type AiOverrideProposal = {
	/** Eindeutiger Parameter-/Policy-Bezeichner, z. B. "battery.opportunity_discount_pct". */
	parameter: string;
	originalValue: number;
	proposedValue: number;
	reasoningDe: string;
	/** Kurze Belege/Kennzahlen, auf die sich die Empfehlung stützt — nie leer bei echten Vorschlägen. */
	evidence: string[];
	confidencePct: number;
	sampleCount: number;
	/** Alter der zugrunde liegenden Lerndaten in Tagen (Freshness). */
	dataAgeDays: number;
	source: string;
	createdAtIso: string;
};

/** Vom Aufrufer vorgegebene Validierungsgrenzen für einen Parameter — nie von der KI selbst gesetzt. */
export type AiOverrideBounds = {
	minValue: number;
	maxValue: number;
	/** Maximale Änderung ggü. originalValue pro Override-Schritt (Betrag). */
	maxChangePerStepAbs: number;
	minConfidencePct: number;
	minSampleCount: number;
	/** Maximales Datenalter in Tagen, danach Ablehnung ("widersprüchliche/veraltete Evidenz"). */
	maxDataAgeDays: number;
	ttlMs: number;
};

export type ValidatedAiOverride = {
	id: string;
	parameter: string;
	originalValue: number;
	proposedValue: number;
	/** Validierter (ggf. auf Bounds geklemmter) Wert — nur bei status="active" wirksam. */
	validatedValue: number | null;
	reasoningDe: string;
	evidence: string[];
	confidencePct: number;
	source: string;
	status: AiOverrideStatus;
	rejectReasonDe: string | null;
	createdAtIso: string;
	expiresAtIso: string;
	/** Lokaler Kalendertag, für den dieser Override wirksam war/ist (Economics-Point-in-time-Zuordnung). */
	dateKey: string;
};

export const AI_OVERRIDE_SAFETY_DENYLIST_PATTERNS: RegExp[] = [
	/soc_hard_min/i,
	/hw_max_charge/i,
	/hw_max_discharge/i,
	/hw_min_soc/i,
	/hw_max_soc/i,
	/^safety\./i,
	/safety_limit/i,
	/hygiene/i,
	/^forced\./i,
	/forced_mode/i,
	/user_override/i,
	/external_override/i,
	/hard_off/i,
	/hard_stop/i,
	/temperature_hardlimit/i,
	/temp_hardlimit/i,
	/battery_hold/i,
	/^hold\./i,
];

export function isSafetyImmutableParameter(parameter: string): boolean {
	return AI_OVERRIDE_SAFETY_DENYLIST_PATTERNS.some((re) => re.test(parameter));
}
