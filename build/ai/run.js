"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAiOptimizationNow = void 0;
const config_1 = require("./config");
const context_1 = require("./context");
const ensure_states_1 = require("./ensure_states");
const limiter_1 = require("./limiter");
const pricing_1 = require("./pricing");
const strategy_preferences_1 = require("./strategy_preferences");
const writeback_1 = require("./writeback");
async function writeStatus(host, status) {
    await host.setStateAsync(ensure_states_1.AI_STATES.status, { val: status, ack: true });
}
async function persistThinkingStates(host, thinkingDe, decisionsJson, thinkingMode) {
    await host.setStateAsync(ensure_states_1.AI_STATES.lastThinkingDe, { val: thinkingDe.slice(0, 1200), ack: true });
    await host.setStateAsync(ensure_states_1.AI_STATES.lastDecisionsJson, { val: decisionsJson, ack: true });
    await host.setStateAsync(ensure_states_1.AI_STATES.lastThinkingMode, { val: thinkingMode, ack: true });
}
/**
 * Orchestriert genau einen KI-Optimierungsversuch (Roadmap Block 6 / denkende KI).
 * Fail-closed: ohne messbaren Plan-B-Vorteil kein Write-back, Auto-Trigger gesperrt
 * — aber nur wenn Slot-Präferenzen vorhanden sind. Reines Denken bleibt sichtbar (ready).
 * Write-back geht nur über Daily-Plan-Allocation — nie direkt auf Geräte.
 */
async function runAiOptimizationNow(host, plan, triggerReason, provider) {
    const cfg = (0, config_1.aiConfigFromAdapter)(host.config);
    if (!cfg.enabled) {
        await writeStatus(host, "off");
        return { ran: false, status: "off", reasonDe: "KI global deaktiviert." };
    }
    if (!cfg.apiKey) {
        await writeStatus(host, "no_token");
        return { ran: false, status: "no_token", reasonDe: "Kein API-Token hinterlegt." };
    }
    const allowedAddonIds = (0, context_1.resolveAllowedAddonIds)(host.config);
    if (allowedAddonIds.length === 0) {
        await writeStatus(host, "no_addons_allowed");
        return { ran: false, status: "no_addons_allowed", reasonDe: "Kein Add-on hat KI-Optimierung erlaubt." };
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
        return { ran: false, status: "limit_reached", reasonDe: reason };
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
    const costEur = (0, pricing_1.estimateCostEur)(cfg.model, result.usage.promptTokens, result.usage.completionTokens);
    await (0, limiter_1.recordDailyCall)(host, cfg.maxCallsPerDay, costEur, new Date(), cfg.monthlyCostLimitEur, tz);
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
    const wallboxPvOnly = (0, strategy_preferences_1.wallboxPvOnlyFromDecisions)(decisions);
    const gate = await (0, writeback_1.finalizeAiRunWithWritebackGate)(host, plan, mergedPrefs, {
        wallboxPvOnly,
        skipAutoSuspend: cfg.thinkingMode,
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
exports.runAiOptimizationNow = runAiOptimizationNow;
