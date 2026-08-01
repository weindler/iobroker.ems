"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOpenAiProvider = exports.parseDecisions = void 0;
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const SYSTEM_PROMPT_LEGACY = [
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
const SYSTEM_PROMPT_THINKING = [
    "You are the optional thinking layer of EMS-Light (Hausenergiemanager).",
    "You see the rolling 48h Daily Plan (15-min slots: price, PV, house load, allocations),",
    "a live+horizon situation brief, and learning scalars. Think like a human house energy manager:",
    "heat stick today vs tomorrow (buffer empty risk?), PV today vs tomorrow kWh,",
    "EV: cheap grid now vs wait for PV — action MUST match note and situation numbers.",
    "Rules for wallbox action consistency:",
    "- nextHours.avgAvailablePvSurplusPowerW high OR note about PV surplus → prefer_pv_today (not charge_cheap_grid_now);",
    "- charge_cheap_grid_now ONLY when surplus is low AND price is clearly cheap vs avg;",
    "- prefer_pv_tomorrow when tomorrow PV kWh is clearly better and no hard deadline today;",
    "- do not request wallbox power far above next-hours surplus without deadline pressure.",
    "immersion: use situation.immersion.thermalEstimatedRemainingHours + thermalEstimatedEmptyAt together",
    "(remaining is live countdown; empty_at is absolute ISO). heat_today if buffer risk / empty soon;",
    "else defer_tomorrow if PV tomorrow much better.",
    "battery: wait_pv when surplus coming; charge_now on cheap+low-surplus; hold only with EV boost/external.",
    "You may ONLY reason about allowed_addon_ids. You NEVER control devices or change policies.",
    "Prefer concrete decisions (EMS derives slot weights). keep_plan_a only when Plan A is already good.",
    "Return ONLY JSON:",
    '{"thinking_de":"...","decisions":[{"addon_id":"...","action":"...","note":"..."}],',
    '"slot_preferences":[{"addon_id":"...","slot_start_iso":"...","weight":0..3}],',
    '"proposals":[{"addon_id":"...","note":"..."}],"reason_de":"..."}.',
    "Allowed actions:",
    "wallbox: charge_cheap_grid_now | prefer_pv_tomorrow | prefer_pv_today | keep_plan_a;",
    "immersion_heater: heat_today | defer_tomorrow | keep_plan_a;",
    "battery: charge_now | wait_pv | hold | keep_plan_a;",
    "climate: advisory | keep_plan_a (notes only; FSM owns runtime).",
    "thinking_de and reason_de / note are short German prose. slot_start_iso only from daily_plan.slots.t.",
].join(" ");
const WALLBOX_ACTIONS = new Set([
    "charge_cheap_grid_now",
    "prefer_pv_tomorrow",
    "prefer_pv_today",
    "keep_plan_a",
]);
const IMMERSION_ACTIONS = new Set(["heat_today", "defer_tomorrow", "keep_plan_a"]);
const BATTERY_ACTIONS = new Set(["charge_now", "wait_pv", "hold", "keep_plan_a"]);
const CLIMATE_ACTIONS = new Set(["advisory", "keep_plan_a"]);
function allowedActionsForAddon(addonId) {
    if (addonId === "wallbox")
        return WALLBOX_ACTIONS;
    if (addonId === "immersion_heater")
        return IMMERSION_ACTIONS;
    if (addonId === "battery")
        return BATTERY_ACTIONS;
    if (addonId === "climate")
        return CLIMATE_ACTIONS;
    return null;
}
function emptyResult(partial) {
    return {
        ok: partial.ok,
        proposals: partial.proposals ?? [],
        slotPreferences: partial.slotPreferences ?? [],
        thinkingDe: partial.thinkingDe ?? "",
        decisions: partial.decisions ?? [],
        reasonDe: partial.reasonDe,
        usage: partial.usage,
        error: partial.error,
    };
}
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
const SLOT_PREFERENCE_MAX_ENTRIES = 400;
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
/** Exported for unit tests — validates actions against the per-addon allow-set. */
function parseDecisions(raw, allowedAddonIds) {
    if (!Array.isArray(raw.decisions))
        return [];
    const allowed = new Set(allowedAddonIds);
    const out = [];
    for (const d of raw.decisions) {
        if (!d || typeof d !== "object")
            continue;
        const addonId = typeof d.addon_id === "string" ? d.addon_id : "";
        const action = typeof d.action === "string" ? d.action : "";
        const note = typeof d.note === "string" ? d.note : "";
        if (!addonId || !allowed.has(addonId))
            continue;
        const allowedActions = allowedActionsForAddon(addonId);
        if (!allowedActions || !allowedActions.has(action))
            continue;
        out.push({
            addonId,
            action: action,
            note: note.slice(0, 400),
        });
    }
    return out;
}
exports.parseDecisions = parseDecisions;
function createOpenAiProvider(fetchImpl = fetch) {
    return {
        id: "openai",
        async optimize(request, opts) {
            if (!opts.apiKey) {
                return emptyResult({
                    ok: false,
                    reasonDe: "Kein API-Token konfiguriert.",
                    usage: { promptTokens: null, completionTokens: null },
                    error: "no_token",
                });
            }
            const thinkingMode = opts.thinkingMode !== false;
            const userContent = JSON.stringify({
                generated_at: request.generatedAt,
                timezone: request.timezone,
                global_mode: request.globalMode,
                allowed_addon_ids: request.allowedAddonIds,
                daily_plan: request.dailyPlan,
                learning: request.learning,
                situation: thinkingMode ? request.situation : undefined,
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
                            {
                                role: "system",
                                content: thinkingMode ? SYSTEM_PROMPT_THINKING : SYSTEM_PROMPT_LEGACY,
                            },
                            { role: "user", content: userContent },
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
                const json = (await res.json());
                const content = json.choices?.[0]?.message?.content;
                const usage = {
                    promptTokens: typeof json.usage?.prompt_tokens === "number" ? json.usage.prompt_tokens : null,
                    completionTokens: typeof json.usage?.completion_tokens === "number" ? json.usage.completion_tokens : null,
                };
                if (!content) {
                    return emptyResult({
                        ok: false,
                        reasonDe: "Leere Antwort vom Modell.",
                        usage,
                        error: "empty_content",
                    });
                }
                let parsed;
                try {
                    parsed = JSON.parse(content);
                }
                catch {
                    return emptyResult({
                        ok: false,
                        reasonDe: "Antwort war kein gültiges JSON.",
                        usage,
                        error: "invalid_json",
                    });
                }
                const validSlotIsoSet = new Set(request.dailyPlan.slots.map((s) => s.t));
                const proposals = parseProposals(parsed, request.allowedAddonIds);
                const slotPreferences = parseSlotPreferences(parsed, request.allowedAddonIds, validSlotIsoSet);
                const decisions = thinkingMode ? parseDecisions(parsed, request.allowedAddonIds) : [];
                const thinkingDe = thinkingMode && typeof parsed.thinking_de === "string" && parsed.thinking_de.trim()
                    ? parsed.thinking_de.trim().slice(0, 1200)
                    : "";
                const reasonDe = typeof parsed.reason_de === "string" && parsed.reason_de.trim()
                    ? parsed.reason_de.trim().slice(0, 400)
                    : thinkingDe
                        ? thinkingDe.slice(0, 400)
                        : proposals.length > 0 || decisions.length > 0
                            ? `${Math.max(proposals.length, decisions.length)} Hinweis(e) erhalten.`
                            : "Kein Optimierungsbedarf gemeldet.";
                return {
                    ok: true,
                    proposals,
                    slotPreferences,
                    thinkingDe,
                    decisions,
                    reasonDe,
                    usage,
                };
            }
            catch (e) {
                const aborted = e instanceof Error && e.name === "AbortError";
                return emptyResult({
                    ok: false,
                    reasonDe: aborted ? "Zeitüberschreitung beim KI-Aufruf." : "Fehler beim KI-Aufruf.",
                    usage: { promptTokens: null, completionTokens: null },
                    error: aborted ? "timeout" : String(e instanceof Error ? e.message : e),
                });
            }
            finally {
                clearTimeout(timer);
            }
        },
    };
}
exports.createOpenAiProvider = createOpenAiProvider;
