"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOpenAiProvider = void 0;
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const SYSTEM_PROMPT = [
    "Du bist die optionale Optimierungsschicht eines Hausenergiemanagers (EMS-Light).",
    "Du bekommst einen bereits berechneten, deterministischen Tagesplan-Auszug (inkl. 15-Minuten-Slots mit",
    "Preis, PV-Überschuss und aktueller Heizstab-/Klimaanlagen-Leistung) sowie die aktuell gültigen",
    "Policy-/Sicherheitsgrenzen und die Liste der Add-ons, die eine KI-Optimierung erlauben.",
    "Du darfst NUR zu Add-ons aus dieser Liste einen kurzen Hinweis geben und NUR für diese Add-ons",
    "slot_preferences vorschlagen — bezogen ausschließlich auf slot_start_iso-Werte aus daily_plan.slots.",
    "Du verschiebst NUR den Zeitpunkt, nie die Gesamtenergiemenge: slot_preferences ist eine reine",
    "Gewichtung pro Slot (weight 0..3, 1 = neutral/keine Änderung, >1 = diesen Slot bevorzugen,",
    "<1 = diesen Slot meiden) — keine Watt- oder kWh-Werte.",
    "Du darfst NIEMALS: Geräte steuern, Policies ändern, Sicherheitsgrenzen überschreiten,",
    "ein nicht in der Liste enthaltenes Add-on erwähnen oder Zahlenwerte außerhalb der gegebenen Grenzen vorschlagen.",
    'Antworte ausschließlich als JSON-Objekt exakt in dieser Form: {"proposals":[{"addon_id":"...","note":"..."}],',
    '"slot_preferences":[{"addon_id":"...","slot_start_iso":"...","weight":1.5}],"reason_de":"..."}.',
    "proposals und slot_preferences dürfen leer sein, wenn der bestehende Plan schon sinnvoll ist.",
    "note und reason_de sind kurze deutsche Sätze.",
].join(" ");
function parseProposals(raw, allowedAddonIds) {
    if (!Array.isArray(raw.proposals))
        return [];
    const allowed = new Set(allowedAddonIds);
    const out = [];
    for (const p of raw.proposals) {
        if (!p || typeof p !== "object")
            continue;
        const addonId = typeof p.addon_id === "string" ? p.addon_id : "";
        const note = typeof p.note === "string" ? p.note : "";
        if (!addonId || !allowed.has(addonId) || !note)
            continue;
        out.push({ addonId, note: note.slice(0, 400) });
    }
    return out;
}
const SLOT_PREFERENCE_MAX_ENTRIES = 200;
const SLOT_WEIGHT_MIN = 0;
const SLOT_WEIGHT_MAX = 3;
function parseSlotPreferences(raw, allowedAddonIds, validSlotIsoSet) {
    if (!Array.isArray(raw.slot_preferences))
        return [];
    const allowed = new Set(allowedAddonIds);
    const out = [];
    for (const p of raw.slot_preferences) {
        if (out.length >= SLOT_PREFERENCE_MAX_ENTRIES)
            break;
        if (!p || typeof p !== "object")
            continue;
        const addonId = typeof p.addon_id === "string" ? p.addon_id : "";
        const slotStartIso = typeof p.slot_start_iso === "string" ? p.slot_start_iso : "";
        const weightRaw = typeof p.weight === "number" ? p.weight : Number(p.weight);
        if (!addonId || !allowed.has(addonId))
            continue;
        if (!slotStartIso || !validSlotIsoSet.has(slotStartIso))
            continue;
        if (!Number.isFinite(weightRaw))
            continue;
        const weight = Math.max(SLOT_WEIGHT_MIN, Math.min(SLOT_WEIGHT_MAX, weightRaw));
        out.push({ addonId, slotStartIso, weight });
    }
    return out;
}
function createOpenAiProvider(fetchImpl = fetch) {
    return {
        id: "openai",
        async optimize(request, opts) {
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
                const json = (await res.json());
                const content = json.choices?.[0]?.message?.content;
                const usage = {
                    promptTokens: typeof json.usage?.prompt_tokens === "number" ? json.usage.prompt_tokens : null,
                    completionTokens: typeof json.usage?.completion_tokens === "number" ? json.usage.completion_tokens : null,
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
                let parsed;
                try {
                    parsed = JSON.parse(content);
                }
                catch {
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
                const reasonDe = typeof parsed.reason_de === "string" && parsed.reason_de.trim()
                    ? parsed.reason_de.trim().slice(0, 400)
                    : proposals.length > 0
                        ? `${proposals.length} Vorschlag/Vorschläge erhalten.`
                        : "Kein Optimierungsbedarf gemeldet.";
                return { ok: true, proposals, slotPreferences, reasonDe, usage };
            }
            catch (e) {
                const aborted = e instanceof Error && e.name === "AbortError";
                return {
                    ok: false,
                    proposals: [],
                    slotPreferences: [],
                    reasonDe: aborted ? "Zeitüberschreitung beim KI-Aufruf." : "Fehler beim KI-Aufruf.",
                    usage: { promptTokens: null, completionTokens: null },
                    error: aborted ? "timeout" : String(e instanceof Error ? e.message : e),
                };
            }
            finally {
                clearTimeout(timer);
            }
        },
    };
}
exports.createOpenAiProvider = createOpenAiProvider;
