"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureAiStates = exports.AI_STATES = exports.AI_BASE = void 0;
const state_util_1 = require("../ems_light/state_util");
exports.AI_BASE = "ai";
exports.AI_STATES = {
    status: `${exports.AI_BASE}.status`,
    callsToday: `${exports.AI_BASE}.calls_today`,
    callsTodayDate: `${exports.AI_BASE}.calls_today_date`,
    callsLimit: `${exports.AI_BASE}.calls_limit`,
    limitWarning: `${exports.AI_BASE}.limit_warning`,
    costEstimateTodayEur: `${exports.AI_BASE}.cost_estimate_today_eur`,
    costEstimateMonthEur: `${exports.AI_BASE}.cost_estimate_month_eur`,
    costMonthKey: `${exports.AI_BASE}.cost_month_key`,
    monthlyCostLimitEur: `${exports.AI_BASE}.monthly_cost_limit_eur`,
    lastRunAt: `${exports.AI_BASE}.last_run_at`,
    lastAutoTriggerAtMs: `${exports.AI_BASE}.last_auto_trigger_at_ms`,
    lastRunResult: `${exports.AI_BASE}.last_run_result`,
    lastReasonDe: `${exports.AI_BASE}.last_reason_de`,
    lastError: `${exports.AI_BASE}.last_error`,
    lastSlotPreferencesJson: `${exports.AI_BASE}.last_slot_preferences_json`,
    lastThinkingDe: `${exports.AI_BASE}.last_thinking_de`,
    lastDecisionsJson: `${exports.AI_BASE}.last_decisions_json`,
    lastThinkingMode: `${exports.AI_BASE}.last_thinking_mode`,
    autoSuspended: `${exports.AI_BASE}.auto_suspended`,
    autoSuspendReasonDe: `${exports.AI_BASE}.auto_suspend_reason_de`,
    optimizeNowRequest: `${exports.AI_BASE}.optimize_now_request`,
    /** Runtime-Bedienzustand „KI benutzen“ — einzige Wahrheit nach Migration (v0.1.258). */
    userEnabled: `${exports.AI_BASE}.user_enabled`,
    /** Einmalige Migration von native.ai_enabled abgeschlossen. */
    userEnabledMigratedV1: `${exports.AI_BASE}.user_enabled_migrated_v1`,
    /** Letzte API-Herkunft (planner_optimization | daily_analyst) — Gesamtsummen bleiben global. */
    lastCallCategory: `${exports.AI_BASE}.last_call_category`,
};
async function ensureAiStates(host) {
    await (0, state_util_1.ensureChannel)(host, exports.AI_BASE, "EMS KI-Optimierung (optional)");
    const defs = [
        {
            id: exports.AI_STATES.status,
            common: {
                name: "KI-Status",
                type: "string",
                role: "text",
                read: true,
                write: false,
                def: "off",
                states: {
                    off: "Aus",
                    ready: "Bereit",
                    limit_reached: "Limit erreicht",
                    error: "Fehler",
                    no_token: "Kein Token",
                    no_addons_allowed: "Kein Add-on freigegeben",
                    suspended: "Auto aus (kein Plan-B-Vorteil)",
                },
            },
        },
        {
            id: exports.AI_STATES.callsToday,
            common: { name: "KI-Aufrufe heute", type: "number", role: "value", read: true, write: false, def: 0 },
        },
        {
            id: exports.AI_STATES.callsTodayDate,
            common: {
                name: "KI-Zähler gilt für Tag (intern)",
                type: "string",
                role: "text",
                read: true,
                write: false,
                def: "",
            },
        },
        {
            id: exports.AI_STATES.callsLimit,
            common: { name: "KI-Tageslimit", type: "number", role: "value", read: true, write: false, def: 0 },
        },
        {
            id: exports.AI_STATES.limitWarning,
            common: {
                name: "KI-Tageslimit fast erreicht (≥80%)",
                type: "boolean",
                role: "indicator.warning",
                read: true,
                write: false,
                def: false,
            },
        },
        {
            id: exports.AI_STATES.costEstimateTodayEur,
            common: {
                name: "KI-Kostenschätzung heute (EUR, ungefähr)",
                type: "number",
                role: "value",
                read: true,
                write: false,
                def: 0,
                unit: "EUR",
            },
        },
        {
            id: exports.AI_STATES.costEstimateMonthEur,
            common: {
                name: "KI-Kostenschätzung Monat (EUR, ungefähr)",
                type: "number",
                role: "value",
                read: true,
                write: false,
                def: 0,
                unit: "EUR",
            },
        },
        {
            id: exports.AI_STATES.costMonthKey,
            common: {
                name: "KI-Monatsschlüssel (YYYY-MM, intern)",
                type: "string",
                role: "text",
                read: true,
                write: false,
                def: "",
            },
        },
        {
            id: exports.AI_STATES.monthlyCostLimitEur,
            common: {
                name: "KI-Monatslimit EUR (0=aus)",
                type: "number",
                role: "value",
                read: true,
                write: false,
                def: 0,
                unit: "EUR",
            },
        },
        {
            id: exports.AI_STATES.lastRunAt,
            common: { name: "Letzter KI-Lauf", type: "string", role: "date", read: true, write: false, def: "" },
        },
        {
            id: exports.AI_STATES.lastAutoTriggerAtMs,
            common: {
                name: "Letzter automatischer KI-Trigger (Unix-ms, intern — Mindestabstand)",
                type: "number",
                role: "value",
                read: true,
                write: false,
                def: 0,
            },
        },
        {
            id: exports.AI_STATES.lastRunResult,
            common: { name: "Letztes KI-Ergebnis", type: "string", role: "text", read: true, write: false, def: "" },
        },
        {
            id: exports.AI_STATES.lastReasonDe,
            common: { name: "Letzte KI-Begründung", type: "string", role: "text", read: true, write: false, def: "" },
        },
        {
            id: exports.AI_STATES.lastError,
            common: { name: "Letzter KI-Fehler", type: "string", role: "text", read: true, write: false, def: "" },
        },
        {
            id: exports.AI_STATES.lastSlotPreferencesJson,
            common: {
                name: "Letzte KI-Zeitpunkt-Präferenzen (JSON, intern — Basis für Plan-Vergleich/Write-back)",
                type: "string",
                role: "json",
                read: true,
                write: false,
                def: "[]",
            },
        },
        {
            id: exports.AI_STATES.lastThinkingDe,
            common: {
                name: "Letzte KI-Denkspur (DE)",
                type: "string",
                role: "text",
                read: true,
                write: false,
                def: "",
            },
        },
        {
            id: exports.AI_STATES.lastDecisionsJson,
            common: {
                name: "Letzte KI-Entscheidungen (JSON)",
                type: "string",
                role: "json",
                read: true,
                write: false,
                def: "[]",
            },
        },
        {
            id: exports.AI_STATES.lastThinkingMode,
            common: {
                name: "Letzter KI-Lauf im Denkmodus",
                type: "boolean",
                role: "indicator",
                read: true,
                write: false,
                def: false,
            },
        },
        {
            id: exports.AI_STATES.autoSuspended,
            common: {
                name: "KI-Auto gesperrt (Plan B ohne Vorteil)",
                type: "boolean",
                role: "indicator",
                read: true,
                write: false,
                def: false,
            },
        },
        {
            id: exports.AI_STATES.autoSuspendReasonDe,
            common: {
                name: "KI-Auto-Sperre Begründung",
                type: "string",
                role: "text",
                read: true,
                write: false,
                def: "",
            },
        },
        {
            id: exports.AI_STATES.optimizeNowRequest,
            common: {
                name: "Jetzt optimieren anfordern",
                type: "boolean",
                role: "button",
                read: true,
                write: true,
                def: false,
            },
        },
        {
            id: exports.AI_STATES.userEnabled,
            common: {
                name: "KI benutzen (Runtime, ohne Adapter-Neustart)",
                type: "boolean",
                role: "switch",
                read: true,
                write: true,
                def: false,
            },
        },
        {
            id: exports.AI_STATES.userEnabledMigratedV1,
            common: {
                name: "KI user_enabled Migration v1 abgeschlossen (intern)",
                type: "boolean",
                role: "indicator",
                read: true,
                write: false,
                def: false,
            },
        },
        {
            id: exports.AI_STATES.lastCallCategory,
            common: {
                name: "Letzte KI-API-Herkunft (intern)",
                type: "string",
                role: "text",
                read: true,
                write: false,
                def: "",
            },
        },
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensureAiStates = ensureAiStates;
