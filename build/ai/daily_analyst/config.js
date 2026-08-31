"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiAnalystConfigFromAdapter = exports.AI_ANALYST_DEFAULT_MAX_FINDINGS_RETAINED_DAYS = exports.AI_ANALYST_TIMEOUT_MS = exports.AI_ANALYST_DEFAULT_MODEL = exports.AI_ANALYST_ALLOWED_MODES = void 0;
const state_util_1 = require("../../ems_light/state_util");
const config_1 = require("../config");
exports.AI_ANALYST_ALLOWED_MODES = ["disabled", "manual", "daily_auto"];
exports.AI_ANALYST_DEFAULT_MODEL = "gpt-4.1-mini";
exports.AI_ANALYST_TIMEOUT_MS = 30_000;
exports.AI_ANALYST_DEFAULT_MAX_FINDINGS_RETAINED_DAYS = 120;
function isAllowedModel(v) {
    return typeof v === "string" && config_1.AI_ALLOWED_MODELS.includes(v);
}
function isAllowedMode(v) {
    return typeof v === "string" && exports.AI_ANALYST_ALLOWED_MODES.includes(v);
}
/**
 * Der Daily Analyst nutzt bewusst denselben API-Token wie der Optimizer (ein OpenAI-Zugang pro
 * Adapter-Instanz) — separater Admin-Schalter `ai_analyst_mode` bestimmt aber unabhängig, ob/wie
 * er läuft. EMS-Betrieb bleibt unberührt, egal ob dieses Modul disabled/unavailable ist.
 */
function aiAnalystConfigFromAdapter(config) {
    const c = config && typeof config === "object" ? config : {};
    const mode = isAllowedMode(c.ai_analyst_mode) ? c.ai_analyst_mode : "disabled";
    const model = isAllowedModel(c.ai_analyst_model) ? c.ai_analyst_model : exports.AI_ANALYST_DEFAULT_MODEL;
    const apiKeyRaw = c.ai_openai_api_key;
    const apiKey = typeof apiKeyRaw === "string" ? apiKeyRaw.trim() : "";
    const retainedRaw = (0, state_util_1.asNum)(c.ai_analyst_retained_days);
    const retainedDays = retainedRaw !== null && retainedRaw > 0 ? Math.round(retainedRaw) : exports.AI_ANALYST_DEFAULT_MAX_FINDINGS_RETAINED_DAYS;
    const overrideEnabled = c.ai_override_enabled === true;
    return { mode, model, apiKey, retainedDays, overrideEnabled };
}
exports.aiAnalystConfigFromAdapter = aiAnalystConfigFromAdapter;
