"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiConfigFromAdapter = exports.AI_THINKING_TIMEOUT_MS = exports.AI_DEFAULT_TIMEOUT_MS = exports.AI_SOFT_WARNING_FRACTION = exports.AI_DEFAULT_MONTHLY_COST_LIMIT_EUR = exports.AI_DEFAULT_MIN_INTERVAL_MINUTES = exports.AI_DEFAULT_MAX_CALLS_PER_DAY = exports.AI_DEFAULT_MODEL = exports.AI_ALLOWED_MODELS = void 0;
const state_util_1 = require("../ems_light/state_util");
/** Whitelist statt Freitext — verhindert Tippfehler/nicht existente Modelle im Admin. */
exports.AI_ALLOWED_MODELS = ["gpt-4.1-mini", "gpt-4o-mini", "gpt-4.1", "gpt-5-mini"];
exports.AI_DEFAULT_MODEL = "gpt-4.1-mini";
exports.AI_DEFAULT_MAX_CALLS_PER_DAY = 20;
/** Mindestabstand zwischen automatischen KI-Aufrufen (Minuten) — 0 = kein Mindestabstand (nur Digest zählt). */
exports.AI_DEFAULT_MIN_INTERVAL_MINUTES = 60;
/** 0 = kein Monatslimit (nur Tagesaufrufe). */
exports.AI_DEFAULT_MONTHLY_COST_LIMIT_EUR = 0;
exports.AI_SOFT_WARNING_FRACTION = 0.8;
/** Legacy-Pfad (slot_preferences only). */
exports.AI_DEFAULT_TIMEOUT_MS = 20_000;
/** Denkende KI — längerer Timeout für Situation+Horizont. */
exports.AI_THINKING_TIMEOUT_MS = 45_000;
function isAllowedModel(v) {
    return typeof v === "string" && exports.AI_ALLOWED_MODELS.includes(v);
}
function aiConfigFromAdapter(config) {
    const c = config && typeof config === "object" ? config : {};
    const enabled = (0, state_util_1.asBool)(c.ai_enabled) ?? false;
    const model = isAllowedModel(c.ai_model) ? c.ai_model : exports.AI_DEFAULT_MODEL;
    const apiKeyRaw = c.ai_openai_api_key;
    const apiKey = typeof apiKeyRaw === "string" ? apiKeyRaw.trim() : "";
    const maxCallsRaw = (0, state_util_1.asNum)(c.ai_max_calls_per_day);
    const maxCallsPerDay = maxCallsRaw !== null && maxCallsRaw > 0 ? Math.round(maxCallsRaw) : exports.AI_DEFAULT_MAX_CALLS_PER_DAY;
    const minIntervalRaw = (0, state_util_1.asNum)(c.ai_min_interval_minutes);
    // 0 ist ein gültiger, bewusster Wert (Mindestabstand deaktiviert) — nur negativ/ungültig fällt auf Default zurück.
    const minIntervalMinutes = minIntervalRaw !== null && minIntervalRaw >= 0
        ? Math.round(minIntervalRaw)
        : exports.AI_DEFAULT_MIN_INTERVAL_MINUTES;
    const monthlyRaw = (0, state_util_1.asNum)(c.ai_monthly_cost_limit_eur);
    const monthlyCostLimitEur = monthlyRaw !== null && monthlyRaw >= 0 ? monthlyRaw : exports.AI_DEFAULT_MONTHLY_COST_LIMIT_EUR;
    const thinkingMode = (0, state_util_1.asBool)(c.ai_thinking_mode) ?? true;
    return {
        enabled,
        provider: "openai",
        model,
        apiKey,
        maxCallsPerDay,
        minIntervalMinutes,
        monthlyCostLimitEur,
        thinkingMode,
    };
}
exports.aiConfigFromAdapter = aiConfigFromAdapter;
