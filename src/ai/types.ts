/**
 * KI-Optimierungsschicht — Verträge.
 *
 * Rahmen (siehe docs/EMS_LIGHT_MASTERPLAN.md Abschnitt 4/8/13):
 * - Die KI optimiert ausschließlich innerhalb bestehender Policy-/Safety-/Add-on-Grenzen.
 * - Sie schreibt niemals direkt auf Geräte-States, ändert niemals Policies und
 *   plant niemals ein Add-on ohne dessen individuelle "KI-Optimierung erlaubt"-Freigabe.
 * - Bei Fehler/Timeout/ungültiger Antwort bleibt der deterministische Plan unverändert
 *   in Kraft (fail-closed).
 */

export type AiProviderId = "openai";

/** Kompakter, bereits sanitisierter Tagesplan-Auszug — kein Rohzugriff auf Geräte-States. */
export interface AiDailyPlanDigest {
	date: string;
	globalMode: string;
	status: string;
	activeContributionIds: string[];
	excludedContributionIds: string[];
	totals: {
		pvForecastEnergyKwh: number | null;
		flexibleAllocatedEnergyKwh: number;
		flexibleUnallocatedEnergyKwh: number | null;
		estimatedGridCostCt: number | null;
	};
	unallocated: Array<{ contributionId: string; unallocatedEnergyKwh: number | null; reasonDe: string }>;
}

export interface AiOptimizationRequestContext {
	generatedAt: string;
	timezone: string;
	globalMode: string;
	/** Add-ons mit Governance "aktiv" UND "KI-Optimierung erlaubt" — nur diese darf die KI je erwähnen. */
	allowedAddonIds: string[];
	dailyPlan: AiDailyPlanDigest;
	policyHighlights: Record<string, unknown>;
	triggerReason: string;
}

/** Vorschlag der KI für ein einzelnes freigegebenes Add-on — Empfehlung, keine Ausführung. */
export interface AiOptimizationProposal {
	addonId: string;
	note: string;
}

export interface AiOptimizationResult {
	ok: boolean;
	proposals: AiOptimizationProposal[];
	reasonDe: string;
	usage: { promptTokens: number | null; completionTokens: number | null };
	error?: string;
}

export interface AiProviderCallOptions {
	apiKey: string;
	model: string;
	timeoutMs: number;
}

export interface AiProvider {
	id: AiProviderId;
	optimize(
		request: AiOptimizationRequestContext,
		opts: AiProviderCallOptions,
	): Promise<AiOptimizationResult>;
}

export type AiStatus = "off" | "ready" | "limit_reached" | "error" | "no_token" | "no_addons_allowed";
