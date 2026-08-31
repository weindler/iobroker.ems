/**
 * PHASE 4 — eigener, schlanker OpenAI-Aufruf für den Daily Analyst. Bewusst getrennt vom
 * Optimizer-Provider (`../openai_provider.ts`) — anderes Antwortschema (Findings statt
 * Slot-Preferences/Decisions), reine Analyse ohne jede Ausführungswirkung.
 */

import type { AiAnalystContext } from "./context";
import { validateAiAnalystResponse } from "./validate_response";
import type { AiAnalystFinding } from "./types";

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

const SYSTEM_PROMPT = [
	"Du bist der optionale Daily Analyst eines Hausenergiemanagers (EMS-Light).",
	"Du bekommst eine kompakte, bereits aggregierte Tageszusammenfassung (Scores, Findings,",
	"Wirtschaftlichkeit, Shadow-Vergleich) für genau einen abgeschlossenen Kalendertag.",
	"Du bist AUSSCHLIESSLICH Analyst: du steuerst niemals Geräte, änderst niemals Konfiguration",
	"oder Policies, und erfindest niemals Euro-Ersparnisse — wirtschaftliche Werte kommen",
	"ausschließlich aus dem übergebenen economics/shadow-Block, nie aus deiner eigenen Schätzung.",
	"Antworte AUSSCHLIESSLICH als JSON:",
	'{"findings":[{"finding_type":"...","domain":"pv_forecast|battery|thermal|climate|ev|grid|price_timing|general",',
	'"severity":"info|notice|warning","confidence_pct":0..100,"evidence":["..."],',
	'"observed_behavior_de":"...","suggested_improvement_de":"...","affected_parameter":null,',
	'"proposed_numeric_value":null,',
	'"expected_direction":"cost_down|comfort_up|reserve_safety_up|unclear","uncertainty_de":"..."}]}.',
	"proposed_numeric_value nur setzen, wenn affected_parameter genau battery.opportunity_margin_ct",
	"ist und ein belastbarer Zahlenvorschlag (ct/kWh, 0..10) aus den Daten folgt — sonst null.",
	"Niemals Safety-/Hardlimit-Parameter vorschlagen.",
	"Maximal 10 Findings, nur die relevantesten. Keine doppelten Findings zum selben Ereignis",
	"(gleicher Lauf, gleiches Zeitfenster, gleiches Optimierungsproblem). Leeres findings-Array",
	"ist ok, wenn der Tag unauffällig war. observed_behavior_de/suggested_improvement_de/uncertainty_de sind kurze",
	"deutsche Sätze, die sich ausschließlich auf die übergebenen Daten stützen.",
].join(" ");

export type AiAnalystProviderResult = {
	ok: boolean;
	findings: AiAnalystFinding[];
	reasonDe: string;
	usage: { promptTokens: number | null; completionTokens: number | null };
	error?: string;
};

export interface AiAnalystProvider {
	analyze(
		context: AiAnalystContext,
		opts: { apiKey: string; model: string; timeoutMs: number },
	): Promise<AiAnalystProviderResult>;
}

function emptyResult(partial: Omit<AiAnalystProviderResult, "findings">): AiAnalystProviderResult {
	return { ...partial, findings: [] };
}

export function createOpenAiAnalystProvider(fetchImpl: typeof fetch = fetch): AiAnalystProvider {
	return {
		async analyze(context, opts) {
			if (!opts.apiKey) {
				return emptyResult({
					ok: false,
					reasonDe: "Kein API-Token konfiguriert.",
					usage: { promptTokens: null, completionTokens: null },
					error: "no_token",
				});
			}
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
			try {
				const res = await fetchImpl(OPENAI_CHAT_COMPLETIONS_URL, {
					method: "POST",
					headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
					body: JSON.stringify({
						model: opts.model,
						messages: [
							{ role: "system", content: SYSTEM_PROMPT },
							{ role: "user", content: JSON.stringify(context) },
						],
						response_format: { type: "json_object" },
						temperature: 0.2,
					}),
					signal: controller.signal,
				});
				if (!res.ok) {
					const bodyText = await res.text().catch(() => "");
					return emptyResult({
						ok: false,
						reasonDe: `OpenAI-Fehler (${res.status}).`,
						usage: { promptTokens: null, completionTokens: null },
						error: `http_${res.status}: ${bodyText.slice(0, 200)}`,
					});
				}
				const json = (await res.json()) as {
					choices?: Array<{ message?: { content?: string } }>;
					usage?: { prompt_tokens?: number; completion_tokens?: number };
				};
				const content = json.choices?.[0]?.message?.content;
				const usage = {
					promptTokens: typeof json.usage?.prompt_tokens === "number" ? json.usage.prompt_tokens : null,
					completionTokens:
						typeof json.usage?.completion_tokens === "number" ? json.usage.completion_tokens : null,
				};
				if (!content) {
					return emptyResult({ ok: false, reasonDe: "Leere Antwort vom Modell.", usage, error: "empty_content" });
				}
				let parsed: unknown;
				try {
					parsed = JSON.parse(content);
				} catch {
					return emptyResult({ ok: false, reasonDe: "Antwort war kein gültiges JSON.", usage, error: "invalid_json" });
				}
				const validated = validateAiAnalystResponse(parsed, context.dateKey);
				if (!validated.ok) {
					return emptyResult({
						ok: false,
						reasonDe: "Antwortstruktur ungültig — verworfen.",
						usage,
						error: `invalid_structure: ${validated.issues.join(", ")}`,
					});
				}
				return {
					ok: true,
					findings: validated.findings,
					reasonDe:
						validated.findings.length > 0
							? `${validated.findings.length} Finding(s) für ${context.dateKey}.`
							: `Keine auffälligen Findings für ${context.dateKey}.`,
					usage,
				};
			} catch (e) {
				const aborted = e instanceof Error && e.name === "AbortError";
				return emptyResult({
					ok: false,
					reasonDe: aborted ? "Zeitüberschreitung beim KI-Aufruf." : "Fehler beim KI-Aufruf.",
					usage: { promptTokens: null, completionTokens: null },
					error: aborted ? "timeout" : String(e instanceof Error ? e.message : e),
				});
			} finally {
				clearTimeout(timer);
			}
		},
	};
}
