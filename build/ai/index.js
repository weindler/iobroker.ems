"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAiOptimizationManual = exports.handleAiStateChange = exports.isAiRelatedState = exports.clearStaleAiOptimizeNowRequest = exports.maybeTriggerAiOptimizationOnDailyPlanChange = exports.syncAiDailyCounters = exports.ensureAiStateTree = exports.resetAiPipelineHookForTest = exports.resetAiEnableEpochForTest = exports.isAiPublishAllowed = exports.bumpAiEnableEpoch = exports.currentAiEnableEpoch = exports.applyAiUserEnabledToggle = exports.readAiUserEnabled = exports.migrateAiUserEnabledOnce = exports.aiTriggerDigestPayload = exports.resolveAllowedAddonIds = exports.AI_DEFAULT_MIN_INTERVAL_MINUTES = exports.AI_DEFAULT_MAX_CALLS_PER_DAY = exports.AI_DEFAULT_MODEL = exports.AI_ALLOWED_MODELS = exports.aiConfigFromAdapter = exports.AI_STATES = exports.ensureAiStates = void 0;
const states_1 = require("../operator/daily_plan/states");
const state_util_1 = require("../ems_light/state_util");
const config_1 = require("./config");
const ensure_states_1 = require("./ensure_states");
const limiter_1 = require("./limiter");
const openai_provider_1 = require("./openai_provider");
const run_1 = require("./run");
const trigger_digest_1 = require("./trigger_digest");
const user_enabled_1 = require("./user_enabled");
const writeback_1 = require("./writeback");
const ensure_states_2 = require("./override/ensure_states");
const ensure_states_3 = require("./daily_analyst/ensure_states");
var ensure_states_4 = require("./ensure_states");
Object.defineProperty(exports, "ensureAiStates", { enumerable: true, get: function () { return ensure_states_4.ensureAiStates; } });
var ensure_states_5 = require("./ensure_states");
Object.defineProperty(exports, "AI_STATES", { enumerable: true, get: function () { return ensure_states_5.AI_STATES; } });
var config_2 = require("./config");
Object.defineProperty(exports, "aiConfigFromAdapter", { enumerable: true, get: function () { return config_2.aiConfigFromAdapter; } });
Object.defineProperty(exports, "AI_ALLOWED_MODELS", { enumerable: true, get: function () { return config_2.AI_ALLOWED_MODELS; } });
Object.defineProperty(exports, "AI_DEFAULT_MODEL", { enumerable: true, get: function () { return config_2.AI_DEFAULT_MODEL; } });
Object.defineProperty(exports, "AI_DEFAULT_MAX_CALLS_PER_DAY", { enumerable: true, get: function () { return config_2.AI_DEFAULT_MAX_CALLS_PER_DAY; } });
Object.defineProperty(exports, "AI_DEFAULT_MIN_INTERVAL_MINUTES", { enumerable: true, get: function () { return config_2.AI_DEFAULT_MIN_INTERVAL_MINUTES; } });
var context_1 = require("./context");
Object.defineProperty(exports, "resolveAllowedAddonIds", { enumerable: true, get: function () { return context_1.resolveAllowedAddonIds; } });
var trigger_digest_2 = require("./trigger_digest");
Object.defineProperty(exports, "aiTriggerDigestPayload", { enumerable: true, get: function () { return trigger_digest_2.aiTriggerDigestPayload; } });
var user_enabled_2 = require("./user_enabled");
Object.defineProperty(exports, "migrateAiUserEnabledOnce", { enumerable: true, get: function () { return user_enabled_2.migrateAiUserEnabledOnce; } });
Object.defineProperty(exports, "readAiUserEnabled", { enumerable: true, get: function () { return user_enabled_2.readAiUserEnabled; } });
Object.defineProperty(exports, "applyAiUserEnabledToggle", { enumerable: true, get: function () { return user_enabled_2.applyAiUserEnabledToggle; } });
Object.defineProperty(exports, "currentAiEnableEpoch", { enumerable: true, get: function () { return user_enabled_2.currentAiEnableEpoch; } });
Object.defineProperty(exports, "bumpAiEnableEpoch", { enumerable: true, get: function () { return user_enabled_2.bumpAiEnableEpoch; } });
Object.defineProperty(exports, "isAiPublishAllowed", { enumerable: true, get: function () { return user_enabled_2.isAiPublishAllowed; } });
Object.defineProperty(exports, "resetAiEnableEpochForTest", { enumerable: true, get: function () { return user_enabled_2.resetAiEnableEpochForTest; } });
let lastTriggerDigestPayload = "";
function resetAiPipelineHookForTest() {
    lastTriggerDigestPayload = "";
    (0, user_enabled_1.resetAiEnableEpochForTest)();
}
exports.resetAiPipelineHookForTest = resetAiPipelineHookForTest;
async function ensureAiStateTree(host) {
    await (0, ensure_states_1.ensureAiStates)(host);
    await (0, ensure_states_2.ensureAiValidatorStates)(host);
    await (0, ensure_states_3.ensureAiDailyAnalystStates)(host);
    if (typeof host.getStateAsync === "function" &&
        typeof host.setStateAsync === "function" &&
        "config" in host) {
        const aiHost = host;
        await (0, user_enabled_1.migrateAiUserEnabledOnce)(aiHost);
        await clearStaleAiOptimizeNowRequest(aiHost);
        await (0, ensure_states_3.syncAiDailyAnalystRuntimeFromConfig)(host);
        await (0, ensure_states_3.clearStaleDailyAnalystRunNowRequest)(aiHost);
    }
}
exports.ensureAiStateTree = ensureAiStateTree;
function houseTimezoneFromConfig(config) {
    const tz = typeof config?.timezone === "string" ? config.timezone.trim() : "";
    return tz || "Europe/Berlin";
}
/**
 * Tageszähler/Kosten + gestrige KI-Anzeige beim ersten Tick nach Mitternacht zurücksetzen —
 * unabhängig davon, ob heute schon ein KI-Abruf stattfindet (sonst bliebe calls_today in der VIS stehen).
 */
async function syncAiDailyCounters(host, now = new Date()) {
    const cfg = (0, config_1.aiConfigFromAdapter)(host.config);
    return (0, limiter_1.readAndRolloverDailyCalls)(host, cfg.maxCallsPerDay, now, cfg.monthlyCostLimitEur, houseTimezoneFromConfig(host.config));
}
exports.syncAiDailyCounters = syncAiDailyCounters;
/**
 * Wird nach jedem Daily-Plan-Tick aufgerufen. Löst NICHT bei jeder Operator-Revision einen
 * KI-Versuch aus (die wechselt praktisch jeden Tick — Horizont-Roll, Allocation-Fortschritt,
 * Zehntelgrad-Zittern), sondern nur bei einer grob relevanten Änderung im Sinne von
 * `aiTriggerDigestPayload` (Add-on-Bedarf startet/endet, Zieltemperatur-Stufe wechselt,
 * PV-Tagesprognose springt deutlich, Tageswechsel, Global-Mode-Wechsel) — nicht bei
 * Allocation-Fortschritt Slot für Slot (v0.1.194) und nicht bei wiederholtem Bedarf pro Slot
 * in den Totals (v0.1.195) — Kostenkontrolle, Masterplan §13.
 *
 * Seit v0.1.196: zusätzlich ein konfigurierbarer Mindestabstand zwischen automatischen Aufrufen
 * (Default 60 Min, Admin-Feld "ai_min_interval_minutes", 0 = deaktiviert). Der Digest allein hat
 * sich live als zu fein erwiesen (z. B. Heizstab-Zieltemperatur, die in kleinen Schritten über
 * mehrere Bucket-Grenzen wandert) — der Mindestabstand deckelt automatische Aufrufe hart auf
 * max. 24/Tag bei stündlichem Abstand, unabhängig davon, wie oft sich der Digest ändert. Der
 * Zeitpunkt des letzten automatischen Triggers wird persistiert (`AI_STATES.lastAutoTriggerAtMs`),
 * damit ein Adapter-Neustart das Limit nicht aushebelt. Der manuelle "Jetzt optimieren"-Button
 * ignoriert Digest und Mindestabstand vollständig (unverändert).
 *
 * Seit v0.1.258: Enable-Gate ist `ai.user_enabled` (Runtime), nicht mehr native.ai_enabled.
 */
async function maybeTriggerAiOptimizationOnDailyPlanChange(host, plan, now = new Date()) {
    const cfg = (0, config_1.aiConfigFromAdapter)(host.config);
    // Immer zuerst Tages-Rollover — auch wenn KI aus / Digest unverändert / Suspend.
    try {
        await syncAiDailyCounters(host, now);
    }
    catch {
        // best-effort — KI-Trigger nicht blockieren
    }
    const digestPayload = (0, trigger_digest_1.aiTriggerDigestPayload)(plan);
    if (!(await (0, user_enabled_1.readAiUserEnabled)(host))) {
        lastTriggerDigestPayload = digestPayload;
        return null;
    }
    if (await (0, writeback_1.isAiAutoSuspended)(host)) {
        return null;
    }
    if (digestPayload === lastTriggerDigestPayload) {
        return null;
    }
    if (cfg.minIntervalMinutes > 0) {
        const lastTriggerMs = (0, state_util_1.asNum)((await host.getStateAsync(ensure_states_1.AI_STATES.lastAutoTriggerAtMs))?.val) ?? 0;
        const elapsedMs = now.getTime() - lastTriggerMs;
        if (lastTriggerMs > 0 && elapsedMs < cfg.minIntervalMinutes * 60_000) {
            // Digest bleibt bewusst ungesetzt, damit der nächste Tick nach Ablauf des
            // Mindestabstands mit dem dann aktuellen Plan sofort feuert.
            return null;
        }
    }
    lastTriggerDigestPayload = digestPayload;
    await host.setStateAsync(ensure_states_1.AI_STATES.lastAutoTriggerAtMs, { val: now.getTime(), ack: true });
    const provider = (0, openai_provider_1.createOpenAiProvider)();
    return (0, run_1.runAiOptimizationNow)(host, plan, "daily_plan_digest_change", provider);
}
exports.maybeTriggerAiOptimizationOnDailyPlanChange = maybeTriggerAiOptimizationOnDailyPlanChange;
const AI_OPTIMIZE_NOW_REQUEST_ID_SUFFIX = "ai.optimize_now_request";
const AI_USER_ENABLED_ID_SUFFIX = "ai.user_enabled";
/** Hängenden Button (true, oft ack:false) nach Restart/KI-aus leeren — kein stiller Lauf. */
async function clearStaleAiOptimizeNowRequest(host) {
    const st = await host.getStateAsync(ensure_states_1.AI_STATES.optimizeNowRequest);
    if (st?.val !== true) {
        return false;
    }
    await host.setStateAsync(ensure_states_1.AI_STATES.optimizeNowRequest, { val: false, ack: true });
    return true;
}
exports.clearStaleAiOptimizeNowRequest = clearStaleAiOptimizeNowRequest;
/** Erlaubt Runtime-Toggle und "Jetzt optimieren" direkt über den Objektbaum. */
function isAiRelatedState(relativeId) {
    return relativeId === AI_OPTIMIZE_NOW_REQUEST_ID_SUFFIX || relativeId === AI_USER_ENABLED_ID_SUFFIX;
}
exports.isAiRelatedState = isAiRelatedState;
async function handleAiStateChange(host, relativeId, val, ack) {
    if (relativeId === AI_USER_ENABLED_ID_SUFFIX) {
        if (ack)
            return false;
        try {
            await (0, user_enabled_1.applyAiUserEnabledToggle)(host, val === true);
        }
        catch (e) {
            host.log?.error?.(`ai user_enabled: ${e instanceof Error ? e.message : String(e)}`);
        }
        return true;
    }
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
