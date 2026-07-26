import type {
	AiOptimizationProposal,
	AiOptimizationRequestContext,
	AiOptimizationResult,
	AiProvider,
	AiProviderCallOptions,
	AiSlotPreference,
} from "./types";

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

const SYSTEM_PROMPT = [
	"Du bist die optionale Optimierungsschicht eines Hausenergiemanagers (EMS-Light).",
	"Du bekommst den vollständigen deterministischen Daily Plan (rollierender Horizont, 15-Min-Slots mit",
	"Preis, PV, Hauslast, Allokationen) plus einen Learning-Digest (PV-Bias, Thermal-/Battery-Runtime,",
	"Preis-Learning) und Policy-Grenzen sowie die Add-ons mit KI-Freigabe.",
	"Du darfst NUR zu Add-ons aus allowedAddonIds Hinweise und slot_preferences liefern —",
	"slot_start_iso ausschließlich aus daily_plan.slots.t.",
	"Du verschiebst NUR den Zeitpunkt, nie die Gesamtenergiemenge: weight 0..3 (1 = neutral).",
	"Du darfst NIEMALS Geräte steuern, Policies ändern oder nicht freigegebene Add-ons erwähnen.",
	'Antworte ausschließlich als JSON: {"proposals":[{"addon_id":"...","note":"..."}],',
	'"slot_preferences":[{"addon_id":"...","slot_start_iso":"...","weight":1.5}],"reason_de":"..."}.',
	"Leere proposals/slot_preferences sind ok, wenn Plan A schon sinnvoll ist.",
	"note und reason_de sind kurze deutsche Sätze.",
].join(" ");

interface RawOpenAiResponse {
	proposals?: Array<{ addon_id?: unknown; note?: unknown }>;
	slot_preferences?: Array<{ addon_id?: unknown; slot_start_iso?: unknown; weight?: unknown }>;
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

const SLOT_PREFERENCE_MAX_ENTRIES = 400;
const SLOT_WEIGHT_MIN = 0;
const SLOT_WEIGHT_MAX = 3;

function parseSlotPreferences(
	raw: RawOpenAiResponse,
	allowedAddonIds: string[],
	validSlotIsoSet: Set<string>,
): AiSlotPreference[] {
	if (!Array.isArray(raw.slot_preferences)) return [];
	const allowed = new Set(allowedAddonIds);
	const out: AiSlotPreference[] = [];
	for (const p of raw.slot_preferences) {
		if (out.length >= SLOT_PREFERENCE_MAX_ENTRIES) break;
		if (!p || typeof p !== "object") continue;
		const addonId = typeof p.addon_id === "string" ? p.addon_id : "";
		const slotStartIso = typeof p.slot_start_iso === "string" ? p.slot_start_iso : "";
		const weightRaw = typeof p.weight === "number" ? p.weight : Number(p.weight);
		if (!addonId || !allowed.has(addonId)) continue;
		if (!slotStartIso || !validSlotIsoSet.has(slotStartIso)) continue;
		if (!Number.isFinite(weightRaw)) continue;
		const weight = Math.max(SLOT_WEIGHT_MIN, Math.min(SLOT_WEIGHT_MAX, weightRaw));
		out.push({ addonId, slotStartIso, weight });
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
					slotPreferences: [],
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
						slotPreferences: [],
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
						slotPreferences: [],
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
						slotPreferences: [],
						reasonDe: "Antwort war kein gültiges JSON.",
						usage,
						error: "invalid_json",
					};
				}

				const validSlotIsoSet = new Set(request.dailyPlan.slots.map((s) => s.t));
				const proposals = parseProposals(parsed, request.allowedAddonIds);
				const slotPreferences = parseSlotPreferences(parsed, request.allowedAddonIds, validSlotIsoSet);
				const reasonDe =
					typeof parsed.reason_de === "string" && parsed.reason_de.trim()
						? parsed.reason_de.trim().slice(0, 400)
						: proposals.length > 0
							? `${proposals.length} Vorschlag/Vorschläge erhalten.`
							: "Kein Optimierungsbedarf gemeldet.";

				return { ok: true, proposals, slotPreferences, reasonDe, usage };
			} catch (e) {
				const aborted = e instanceof Error && e.name === "AbortError";
				return {
					ok: false,
					proposals: [],
					slotPreferences: [],
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
