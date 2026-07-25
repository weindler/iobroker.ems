"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAiOptimizationManual = exports.handleAiStateChange = exports.isAiRelatedState = exports.maybeTriggerAiOptimizationOnDailyPlanChange = exports.ensureAiStateTree = exports.resetAiPipelineHookForTest = exports.aiTriggerDigestPayload = exports.resolveAllowedAddonIds = exports.AI_DEFAULT_MAX_CALLS_PER_DAY = exports.AI_DEFAULT_MODEL = exports.AI_ALLOWED_MODELS = exports.aiConfigFromAdapter = exports.AI_STATES = exports.ensureAiStates = void 0;
const states_1 = require("../operator/daily_plan/states");
const config_1 = require("./config");
const ensure_states_1 = require("./ensure_states");
const openai_provider_1 = require("./openai_provider");
const run_1 = require("./run");
const trigger_digest_1 = require("./trigger_digest");
var ensure_states_2 = require("./ensure_states");
Object.defineProperty(exports, "ensureAiStates", { enumerable: true, get: function () { return ensure_states_2.ensureAiStates; } });
var ensure_states_3 = require("./ensure_states");
Object.defineProperty(exports, "AI_STATES", { enumerable: true, get: function () { return ensure_states_3.AI_STATES; } });
var config_2 = require("./config");
Object.defineProperty(exports, "aiConfigFromAdapter", { enumerable: true, get: function () { return config_2.aiConfigFromAdapter; } });
Object.defineProperty(exports, "AI_ALLOWED_MODELS", { enumerable: true, get: function () { return config_2.AI_ALLOWED_MODELS; } });
Object.defineProperty(exports, "AI_DEFAULT_MODEL", { enumerable: true, get: function () { return config_2.AI_DEFAULT_MODEL; } });
Object.defineProperty(exports, "AI_DEFAULT_MAX_CALLS_PER_DAY", { enumerable: true, get: function () { return config_2.AI_DEFAULT_MAX_CALLS_PER_DAY; } });
var context_1 = require("./context");
Object.defineProperty(exports, "resolveAllowedAddonIds", { enumerable: true, get: function () { return context_1.resolveAllowedAddonIds; } });
var trigger_digest_2 = require("./trigger_digest");
Object.defineProperty(exports, "aiTriggerDigestPayload", { enumerable: true, get: function () { return trigger_digest_2.aiTriggerDigestPayload; } });
let lastTriggerDigestPayload = "";
function resetAiPipelineHookForTest() {
    lastTriggerDigestPayload = "";
}
exports.resetAiPipelineHookForTest = resetAiPipelineHookForTest;
async function ensureAiStateTree(host) {
    await (0, ensure_states_1.ensureAiStates)(host);
}
exports.ensureAiStateTree = ensureAiStateTree;
/**
 * Wird nach jedem Daily-Plan-Tick aufgerufen. Löst NICHT bei jeder Operator-Revision einen
 * KI-Versuch aus (die wechselt praktisch jeden Tick — Horizont-Roll, Allocation-Fortschritt,
 * Zehntelgrad-Zittern), sondern nur bei einer grob relevanten Änderung im Sinne von
 * `aiTriggerDigestPayload` (Add-on-Bedarf startet/endet, Zieltemperatur-Stufe wechselt,
 * PV-Tagesprognose springt deutlich, Tageswechsel, Global-Mode-Wechsel) — Kostenkontrolle,
 * Masterplan §13.
 */
async function maybeTriggerAiOptimizationOnDailyPlanChange(host, plan) {
    const cfg = (0, config_1.aiConfigFromAdapter)(host.config);
    const digestPayload = (0, trigger_digest_1.aiTriggerDigestPayload)(plan);
    if (!cfg.enabled) {
        lastTriggerDigestPayload = digestPayload;
        return null;
    }
    if (digestPayload === lastTriggerDigestPayload) {
        return null;
    }
    lastTriggerDigestPayload = digestPayload;
    const provider = (0, openai_provider_1.createOpenAiProvider)();
    return (0, run_1.runAiOptimizationNow)(host, plan, "daily_plan_digest_change", provider);
}
exports.maybeTriggerAiOptimizationOnDailyPlanChange = maybeTriggerAiOptimizationOnDailyPlanChange;
const AI_OPTIMIZE_NOW_REQUEST_ID_SUFFIX = "ai.optimize_now_request";
/** Erlaubt das Auslösen von "Jetzt optimieren" auch direkt über den Objektbaum (analog Backup export_request). */
function isAiRelatedState(relativeId) {
    return relativeId === AI_OPTIMIZE_NOW_REQUEST_ID_SUFFIX;
}
exports.isAiRelatedState = isAiRelatedState;
async function handleAiStateChange(host, relativeId, val, ack) {
    if (relativeId !== AI_OPTIMIZE_NOW_REQUEST_ID_SUFFIX || ack || val !== true) {
        return false;
    }
    await host.setStateAsync(AI_OPTIMIZE_NOW_REQUEST_ID_SUFFIX, { val: false, ack: true });
    try {
        await runAiOptimizationManual(host);
    }
    catch (e) {
        host.log?.error?.(`ai optimize_now_request: ${e instanceof Error ? e.message : String(e)}`);
    }
    return true;
}
exports.handleAiStateChange = handleAiStateChange;
/** Für den manuellen "Jetzt optimieren"-Button — liest den aktuellen Daily Plan direkt aus dem State. */
async function runAiOptimizationManual(host) {
    const raw = await host.getStateAsync(states_1.DAILY_PLAN_STATE_IDS.planJson);
    let plan = null;
    try {
        plan = typeof raw?.val === "string" ? JSON.parse(raw.val) : null;
    }
    catch {
        plan = null;
    }
    if (!plan) {
        return { ran: false, status: "error", reasonDe: "Kein aktueller Daily Plan vorhanden." };
    }
    const provider = (0, openai_provider_1.createOpenAiProvider)();
    return (0, run_1.runAiOptimizationNow)(host, plan, "manual", provider);
}
exports.runAiOptimizationManual = runAiOptimizationManual;
