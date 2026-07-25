import type {
	AiOptimizationProposal,
	AiOptimizationRequestContext,
	AiOptimizationResult,
	AiProvider,
	AiProviderCallOptions,
} from "./types";

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

const SYSTEM_PROMPT = [
	"Du bist die optionale Optimierungsschicht eines Hausenergiemanagers (EMS-Light).",
	"Du bekommst einen bereits berechneten, deterministischen Tagesplan-Auszug sowie die aktuell",
	"gültigen Policy-/Sicherheitsgrenzen und die Liste der Add-ons, die eine KI-Optimierung erlauben.",
	"Du darfst NUR zu Add-ons aus dieser Liste einen kurzen Hinweis geben.",
	"Du darfst NIEMALS: Geräte steuern, Policies ändern, Sicherheitsgrenzen überschreiten,",
	"ein nicht in der Liste enthaltenes Add-on erwähnen oder Zahlenwerte außerhalb der gegebenen Grenzen vorschlagen.",
	'Antworte ausschließlich als JSON-Objekt exakt in dieser Form: {"proposals":[{"addon_id":"...","note":"..."}],"reason_de":"..."}.',
	"proposals darf leer sein, wenn der bestehende Plan schon sinnvoll ist. note und reason_de sind kurze deutsche Sätze.",
].join(" ");

interface RawOpenAiResponse {
	proposals?: Array<{ addon_id?: unknown; note?: unknown }>;
	reason_de?: unknown;
}

function parseProposals(raw: RawOpenAiResponse, allowedAddonIds: string[]): AiOptimizationProposal[] {
	if (!Array.isArray(raw.proposals)) return [];
	const allowed = new Set(allowedAddonIds);
	const out: AiOptimizationProposal[] = [];
	for (const p of raw.proposals) {
		if (!p || typeof p !== "object") continue;
		const addonId = typeof p.addon_id === "string" ? p.addon_id : "";
		const note = typeof p.note === "string" ? p.note : "";
		if (!addonId || !allowed.has(addonId) || !note) continue;
		out.push({ addonId, note: note.slice(0, 400) });
	}
	return out;
}

export function createOpenAiProvider(fetchImpl: typeof fetch = fetch): AiProvider {
	return {
		id: "openai",
		async optimize(
			request: AiOptimizationRequestContext,
			opts: AiProviderCallOptions,
		): Promise<AiOptimizationResult> {
			if (!opts.apiKey) {
				return {
					ok: false,
					proposals: [],
					reasonDe: "Kein API-Token konfiguriert.",
					usage: { promptTokens: null, completionTokens: null },
					error: "no_token",
				};
			}

			const userContent = JSON.stringify({
				generated_at: request.generatedAt,
				timezone: request.timezone,
				global_mode: request.globalMode,
				allowed_addon_ids: request.allowedAddonIds,
				daily_plan: request.dailyPlan,
				policy_highlights: request.policyHighlights,
				trigger_reason: request.triggerReason,
			});

			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
			try {
				const res = await fetchImpl(OPENAI_CHAT_COMPLETIONS_URL, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${opts.apiKey}`,
					},
					body: JSON.stringify({
						model: opts.model,
						messages: [
							{ role: "system", content: SYSTEM_PROMPT },
							{ role: "user", content: userContent },
						],
						response_format: { type: "json_object" },
						temperature: 0.2,
					}),
					signal: controller.signal,
				});

				if (!res.ok) {
					const bodyText = await res.text().catch(() => "");
					return {
						ok: false,
						proposals: [],
						reasonDe: `OpenAI-Fehler (${res.status}).`,
						usage: { promptTokens: null, completionTokens: null },
						error: `http_${res.status}: ${bodyText.slice(0, 200)}`,
					};
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
					return {
						ok: false,
						proposals: [],
						reasonDe: "Leere Antwort vom Modell.",
						usage,
						error: "empty_content",
					};
				}

				let parsed: RawOpenAiResponse;
				try {
					parsed = JSON.parse(content) as RawOpenAiResponse;
				} catch {
					return {
						ok: false,
						proposals: [],
						reasonDe: "Antwort war kein gültiges JSON.",
						usage,
						error: "invalid_json",
					};
				}

				const proposals = parseProposals(parsed, request.allowedAddonIds);
				const reasonDe =
					typeof parsed.reason_de === "string" && parsed.reason_de.trim()
						? parsed.reason_de.trim().slice(0, 400)
						: proposals.length > 0
							? `${proposals.length} Vorschlag/Vorschläge erhalten.`
							: "Kein Optimierungsbedarf gemeldet.";

				return { ok: true, proposals, reasonDe, usage };
			} catch (e) {
				const aborted = e instanceof Error && e.name === "AbortError";
				return {
					ok: false,
					proposals: [],
					reasonDe: aborted ? "Zeitüberschreitung beim KI-Aufruf." : "Fehler beim KI-Aufruf.",
					usage: { promptTokens: null, completionTokens: null },
					error: aborted ? "timeout" : String(e instanceof Error ? e.message : e),
				};
			} finally {
				clearTimeout(timer);
			}
		},
	};
}
