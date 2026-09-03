"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAiOptimizationNow = exports.resetAiOptimizationInFlightForTest = exports.isAiOptimizationInFlight = void 0;
const config_1 = require("./config");
const context_1 = require("./context");
const ensure_states_1 = require("./ensure_states");
const limiter_1 = require("./limiter");
const pricing_1 = require("./pricing");
const strategy_preferences_1 = require("./strategy_preferences");
const user_enabled_1 = require("./user_enabled");
const writeback_1 = require("./writeback");
async function writeStatus(host, status) {
    await host.setStateAsync(ensure_states_1.AI_STATES.status, { val: status, ack: true });
}
async function writeSkipOutcome(host, status, reasonDe) {
    await writeStatus(host, status);
    await host.setStateAsync(ensure_states_1.AI_STATES.lastReasonDe, { val: reasonDe.slice(0, 480), ack: true });
    return { ran: false, status, reasonDe };
}
async function persistThinkingStates(host, thinkingDe, decisionsJson, thinkingMode) {
    await host.setStateAsync(ensure_states_1.AI_STATES.lastThinkingDe, { val: thinkingDe.slice(0, 1200), ack: true });
    await host.setStateAsync(ensure_states_1.AI_STATES.lastDecisionsJson, { val: decisionsJson, ack: true });
    await host.setStateAsync(ensure_states_1.AI_STATES.lastThinkingMode, { val: thinkingMode, ack: true });
}
let aiOptimizationInFlight = false;
function isAiOptimizationInFlight() {
    return aiOptimizationInFlight;
}
exports.isAiOptimizationInFlight = isAiOptimizationInFlight;
/** Nur Tests: In-Flight-Sperre zurücksetzen. */
function resetAiOptimizationInFlightForTest() {
    aiOptimizationInFlight = false;
}
exports.resetAiOptimizationInFlightForTest = resetAiOptimizationInFlightForTest;
/**
 * Orchestriert genau einen KI-Optimierungsversuch (Roadmap Block 6 / denkende KI).
 * Fail-closed: ohne messbaren Plan-B-Vorteil kein Write-back, Auto-Trigger gesperrt
 * — aber nur wenn Slot-Präferenzen vorhanden sind. Reines Denken bleibt sichtbar (ready).
 * Write-back geht nur über Daily-Plan-Allocation — nie direkt auf Geräte.
 */
async function runAiOptimizationNow(host, plan, triggerReason, provider) {
    if (aiOptimizationInFlight) {
        return {
            ran: false,
            status: "error",
            reasonDe: "KI-Optimierung läuft bereits.",
        };
    }
    aiOptimizationInFlight = true;
    try {
        return await runAiOptimizationNowUnlocked(host, plan, triggerReason, provider);
    }
    finally {
        aiOptimizationInFlight = false;
    }
}
exports.runAiOptimizationNow = runAiOptimizationNow;
async function runAiOptimizationNowUnlocked(host, plan, triggerReason, provider) {
    const cfg = (0, config_1.aiConfigFromAdapter)(host.config);
    const requestEpoch = (0, user_enabled_1.currentAiEnableEpoch)();
    if (!(await (0, user_enabled_1.readAiUserEnabled)(host))) {
        return writeSkipOutcome(host, "off", "KI deaktiviert (ai.user_enabled).");
    }
    if (!cfg.apiKey) {
        return writeSkipOutcome(host, "no_token", "Kein API-Token hinterlegt.");
    }
    const allowedAddonIds = (0, context_1.resolveAllowedAddonIds)(host.config);
    if (allowedAddonIds.length === 0) {
        return writeSkipOutcome(host, "no_addons_allowed", "Kein Add-on hat KI-Optimierung erlaubt.");
    }
    const tz = typeof host.config?.timezone === "string" &&
        host.config.timezone.trim()
        ? host.config.timezone.trim()
        : "Europe/Berlin";
    const limitState = await (0, limiter_1.readAndRolloverDailyCalls)(host, cfg.maxCallsPerDay, new Date(), cfg.monthlyCostLimitEur, tz);
    if (limitState.limitReached) {
        await writeStatus(host, "limit_reached");
        const reason = limitState.monthlyLimitReached
            ? `Monatslimit erreicht (${limitState.costMonthEur.toFixed(3)}/${limitState.monthlyLimitEur} EUR).`
            : `Tageslimit erreicht (${limitState.callsToday}/${limitState.limit}).`;
        return writeSkipOutcome(host, "limit_reached", reason);
    }
    // Manueller Lauf darf Auto-Suspend aufheben und erneut prüfen.
    if (triggerReason === "manual") {
        await (0, writeback_1.clearAiAutoSuspend)(host);
    }
    const context = await (0, context_1.buildAiOptimizationContext)(host, plan, triggerReason);
    const timeoutMs = cfg.thinkingMode ? config_1.AI_THINKING_TIMEOUT_MS : config_1.AI_DEFAULT_TIMEOUT_MS;
    let result;
    try {
        result = await provider.optimize(context, {
            apiKey: cfg.apiKey,
            model: cfg.model,
            timeoutMs,
            thinkingMode: cfg.thinkingMode,
        });
    }
    catch (e) {
        result = {
            ok: false,
            proposals: [],
            slotPreferences: [],
            thinkingDe: "",
            decisions: [],
            reasonDe: "Unerwarteter Fehler beim KI-Aufruf.",
            usage: { promptTokens: null, completionTokens: null },
            error: String(e instanceof Error ? e.message : e),
        };
    }
    // Publish-Guard: Toggle während Request → Ergebnis verwerfen (auch nach erneutem ON).
    if (!(await (0, user_enabled_1.isAiPublishAllowed)(host, requestEpoch))) {
        const costEurDiscard = (0, pricing_1.estimateCostEur)(cfg.model, result.usage.promptTokens, result.usage.completionTokens);
        await (0, limiter_1.recordDailyCall)(host, cfg.maxCallsPerDay, costEurDiscard, new Date(), cfg.monthlyCostLimitEur, tz, "planner_optimization");
        host.log?.info?.(`KI-Ergebnis verworfen (${triggerReason}): user_enabled/epoch ungültig (requestEpoch=${requestEpoch}, now=${(0, user_enabled_1.currentAiEnableEpoch)()}).`);
        return {
            ran: false,
            status: "off",
            reasonDe: "KI während Request deaktiviert — Ergebnis verworfen.",
        };
    }
    const costEur = (0, pricing_1.estimateCostEur)(cfg.model, result.usage.promptTokens, result.usage.completionTokens);
    await (0, limiter_1.recordDailyCall)(host, cfg.maxCallsPerDay, costEur, new Date(), cfg.monthlyCostLimitEur, tz, "planner_optimization");
    const nowIso = new Date().toISOString();
    await host.setStateAsync(ensure_states_1.AI_STATES.lastRunAt, { val: nowIso, ack: true });
    await host.setStateAsync(ensure_states_1.AI_STATES.lastReasonDe, { val: result.reasonDe.slice(0, 480), ack: true });
    const decisions = cfg.thinkingMode
        ? (0, strategy_preferences_1.normalizeAddonDecisions)(result.decisions, context.situation)
        : [];
    const thinkingDe = cfg.thinkingMode ? result.thinkingDe : "";
    await persistThinkingStates(host, thinkingDe, JSON.stringify(decisions), cfg.thinkingMode);
    if (!result.ok) {
        await host.setStateAsync(ensure_states_1.AI_STATES.lastRunResult, { val: "error", ack: true });
        await host.setStateAsync(ensure_states_1.AI_STATES.lastError, { val: String(result.error ?? "").slice(0, 480), ack: true });
        await host.setStateAsync(ensure_states_1.AI_STATES.lastSlotPreferencesJson, { val: "[]", ack: true });
        await writeStatus(host, "error");
        host.log?.warn?.(`KI-Optimierung fehlgeschlagen (${triggerReason}): ${result.error ?? result.reasonDe}`);
        return { ran: true, status: "error", reasonDe: result.reasonDe };
    }
    const mergedPrefs = cfg.thinkingMode
        ? (0, strategy_preferences_1.decisionsToSlotPreferences)(plan, decisions, result.slotPreferences)
        : result.slotPreferences;
    await host.setStateAsync(ensure_states_1.AI_STATES.lastRunResult, { val: "ok", ack: true });
    await host.setStateAsync(ensure_states_1.AI_STATES.lastError, { val: "", ack: true });
    await host.setStateAsync(ensure_states_1.AI_STATES.lastSlotPreferencesJson, {
        val: JSON.stringify(mergedPrefs),
        ack: true,
    });
    if (!(await (0, user_enabled_1.isAiPublishAllowed)(host, requestEpoch))) {
        host.log?.info?.(`KI-Publish abgebrochen vor Compare (${triggerReason}): epoch/user_enabled ungültig.`);
        return {
            ran: false,
            status: "off",
            reasonDe: "KI während Request deaktiviert — Ergebnis verworfen.",
        };
    }
    const wallboxPvOnly = (0, strategy_preferences_1.wallboxPvOnlyFromDecisions)(decisions);
    const gate = await (0, writeback_1.finalizeAiRunWithWritebackGate)(host, plan, mergedPrefs, {
        wallboxPvOnly,
        skipAutoSuspend: cfg.thinkingMode,
        immersionDeferTomorrow: (0, strategy_preferences_1.immersionDeferTomorrowFromDecisions)(decisions),
    });
    if (gate.suspended) {
        await writeStatus(host, "suspended");
        const reason = gate.compare.delta.decisionReasonDe;
        await host.setStateAsync(ensure_states_1.AI_STATES.lastReasonDe, { val: reason.slice(0, 480), ack: true });
        host.log?.warn?.(`KI ohne Plan-B-Vorteil — Auto aus: ${reason}`);
        return { ran: true, status: "suspended", reasonDe: reason };
    }
    await writeStatus(host, "ready");
    const noWbReason = gate.compare.delta.decisionReasonDe;
    const thinkingSummary = !gate.writebackApplied && thinkingDe
        ? `${thinkingDe.slice(0, 320)}${mergedPrefs.length > 0 ? ` | ${noWbReason}` : ""}`.slice(0, 480)
        : result.reasonDe;
    const reasonDe = gate.writebackApplied
        ? `${result.reasonDe} Write-back auf Allocation angewendet.`
        : gate.planBPreferred
            ? `${result.reasonDe} Plan B advisory (Unified bleibt autoritativ).`.slice(0, 480)
            : thinkingSummary;
    await host.setStateAsync(ensure_states_1.AI_STATES.lastReasonDe, { val: reasonDe.slice(0, 480), ack: true });
    const wbNote = gate.writebackApplied
        ? "Write-back aktiv."
        : gate.planBPreferred
            ? "Plan B advisory."
            : "kein Write-back.";
    host.log?.debug?.(`KI-Optimierung (${triggerReason}): ${mergedPrefs.length} Slot-Präferenz(en), ${decisions.length} Decision(s), ${wbNote} — ${reasonDe}`);
    return {
        ran: true,
        status: "ready",
        reasonDe,
    };
}
