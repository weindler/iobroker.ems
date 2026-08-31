"use strict";
/**
 * PHASE 4 — Orchestrierung des KI Daily Analyst.
 *
 * Läuft als expliziter Tagesprozess (einmal/Tag im `daily_auto`-Modus, nachdem der Daily
 * Evaluator einen Tag abgeschlossen hat) oder manuell per Button. NIE im schnellen EMS-Tick,
 * NIE minütlich. Ohne Token/Provider/Konfiguration bleibt das EMS unverändert funktionsfähig —
 * dieses Modul liefert dann nur `status:"disabled"`/`"no_token"`, wirft nie.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDailyAnalystManual = exports.handleDailyAnalystRunNowRequest = exports.runDailyAnalystFromAdminButton = exports.formatAiDailyAnalystAdminHint = exports.maybeRunDailyAnalystAutomatically = exports.runDailyAnalystForDate = exports.asDailyAnalystAdapterHost = void 0;
const time_1 = require("../../operator/time");
const constants_1 = require("../../learning/daily_evaluator/constants");
const persist_1 = require("../../learning/daily_evaluator/persist");
const persist_2 = require("../../economics/persist");
const constants_2 = require("../../learning/shadow_engine/constants");
const persist_3 = require("../../learning/shadow_engine/persist");
const data_dir_1 = require("../../learning/data_dir");
const context_1 = require("./context");
const config_1 = require("./config");
const provider_1 = require("./provider");
const ingest_1 = require("../override/ingest");
const tick_1 = require("../override/tick");
const persist_4 = require("./persist");
const ensure_states_1 = require("./ensure_states");
/**
 * ioBroker-Adapter hat kein `getAbsolutePath` — dieselbe Wrapper-Logik wie Learning-Ticks
 * (`withLearningDataPath`). Kein zweiter Datenpfad.
 */
function asDailyAnalystAdapterHost(adapter) {
    return (0, data_dir_1.withLearningDataPath)(adapter, adapter);
}
exports.asDailyAnalystAdapterHost = asDailyAnalystAdapterHost;
function hostHasDataPath(host) {
    return typeof host.getAbsolutePath === "function";
}
async function publish(host, id, val) {
    try {
        await host.setStateAsync(id, { val, ack: true });
    }
    catch {
        /* Status-States sind best-effort */
    }
}
function timezoneFromConfig(config) {
    const tz = typeof config?.timezone === "string"
        ? config.timezone.trim()
        : "";
    return tz || "Europe/Berlin";
}
/**
 * Führt den Analysten für genau einen bereits vom Daily Evaluator abgeschlossenen Tag aus.
 * Persistiert das Ergebnis (auch `disabled`/`no_token`/Fehler — damit ist der Tag "erledigt"
 * und wird nicht endlos wiederholt) und aktualisiert die Status-States.
 */
async function runDailyAnalystForDate(host, dateKey, provider = (0, provider_1.createOpenAiAnalystProvider)()) {
    const cfg = await (0, ensure_states_1.syncAiDailyAnalystRuntimeFromConfig)(host);
    const result = async () => {
        if (cfg.mode === "disabled") {
            return {
                ran: false,
                status: "disabled",
                dateKey,
                findings: [],
                reasonDe: "KI Daily Analyst im Admin deaktiviert (ai_analyst_mode=disabled).",
                usage: { promptTokens: null, completionTokens: null },
            };
        }
        if (!cfg.apiKey) {
            return {
                ran: false,
                status: "no_token",
                dateKey,
                findings: [],
                reasonDe: "Kein OpenAI-API-Token konfiguriert (ai_openai_api_key) — KI Daily Analyst bleibt unavailable.",
                usage: { promptTokens: null, completionTokens: null },
            };
        }
        const scoresDir = host.getAbsolutePath(constants_1.DAILY_EVALUATOR_SCORES_CATEGORY);
        const findingsDir = host.getAbsolutePath(constants_1.DAILY_EVALUATOR_FINDINGS_CATEGORY);
        const record = await (0, persist_1.readScoresDay)(scoresDir, dateKey);
        if (!record) {
            return {
                ran: false,
                status: "no_data",
                dateKey,
                findings: [],
                reasonDe: `Daily Evaluator hat ${dateKey} noch nicht bewertet — KI Daily Analyst wartet.`,
                usage: { promptTokens: null, completionTokens: null },
            };
        }
        const findings = (await (0, persist_1.readFindingsDay)(findingsDir, dateKey)) ?? [];
        const econPersist = await (0, persist_2.readEconomicsPersist)(host.getAbsolutePath(persist_2.ECONOMICS_PERSIST_CATEGORY));
        const economics = econPersist.days[dateKey] ?? null;
        const shadow = await (0, persist_3.readShadowDayRecord)(host.getAbsolutePath(constants_2.SHADOW_ENGINE_RESULTS_CATEGORY), dateKey);
        const context = (0, context_1.buildAiAnalystContext)({ dateKey, record, findings, economics, shadow });
        await publish(host, ensure_states_1.AI_ANALYST_STATES.status, "running");
        const providerResult = await provider.analyze(context, {
            apiKey: cfg.apiKey,
            model: cfg.model,
            timeoutMs: config_1.AI_ANALYST_TIMEOUT_MS,
        });
        if (!providerResult.ok) {
            const status = providerResult.error === "invalid_json" || providerResult.error?.startsWith("invalid_structure")
                ? "invalid_response"
                : "error";
            return {
                ran: true,
                status,
                dateKey,
                findings: [],
                reasonDe: providerResult.reasonDe,
                usage: providerResult.usage,
                error: providerResult.error,
            };
        }
        return {
            ran: true,
            status: "ok",
            dateKey,
            findings: providerResult.findings,
            reasonDe: providerResult.reasonDe,
            usage: providerResult.usage,
        };
    };
    const outcome = await result();
    try {
        await (0, persist_4.writeAiAnalystDay)(host.getAbsolutePath(persist_4.AI_ANALYST_FINDINGS_CATEGORY), dateKey, {
            status: outcome.status,
            reasonDe: outcome.reasonDe,
            model: cfg.model,
            findings: outcome.findings,
        });
        const todayKey = (0, time_1.localDateKeyInTimezone)(new Date(), timezoneFromConfig(host.config));
        await (0, persist_4.pruneAiAnalystFindings)(host.getAbsolutePath(persist_4.AI_ANALYST_FINDINGS_CATEGORY), cfg.retainedDays, todayKey);
    }
    catch (e) {
        host.log?.warn?.(`ai_daily_analyst persist: ${e instanceof Error ? e.message : String(e)}`);
    }
    await publish(host, ensure_states_1.AI_ANALYST_STATES.enabled, cfg.mode !== "disabled");
    await publish(host, ensure_states_1.AI_ANALYST_STATES.status, outcome.status);
    await publish(host, ensure_states_1.AI_ANALYST_STATES.lastRunAtIso, new Date().toISOString());
    await publish(host, ensure_states_1.AI_ANALYST_STATES.lastRunDateKey, dateKey);
    await publish(host, ensure_states_1.AI_ANALYST_STATES.reasonDe, outcome.reasonDe);
    await publish(host, ensure_states_1.AI_ANALYST_STATES.lastError, outcome.error ?? "");
    await publish(host, ensure_states_1.AI_ANALYST_STATES.findingsCount, outcome.findings.length);
    const top = [...outcome.findings].sort((a, b) => b.confidencePct - a.confidencePct)[0];
    await publish(host, ensure_states_1.AI_ANALYST_STATES.topFindingDe, top ? `${top.observedBehaviorDe} → ${top.suggestedImprovementDe}` : "");
    if (outcome.status === "ok" && cfg.overrideEnabled && outcome.findings.length > 0 && dateKey) {
        try {
            await (0, ingest_1.ingestAnalystFindingsAsOverrides)(host, outcome.findings, dateKey);
            await (0, tick_1.syncAiValidatorStates)(host);
        }
        catch (e) {
            host.log?.warn?.(`ai_daily_analyst override ingest: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    return outcome;
}
exports.runDailyAnalystForDate = runDailyAnalystForDate;
/**
 * `daily_auto`-Modus: einmal pro Kalendertag, für den zuletzt vollständig abgeschlossenen
 * Tag ("gestern"), sobald der Daily Evaluator ihn bewertet hat. Idempotent über
 * `lastRunDateKey` — kein zweiter KI-Aufruf für denselben Tag.
 */
async function maybeRunDailyAnalystAutomatically(host, now = new Date(), provider) {
    const cfg = await (0, ensure_states_1.syncAiDailyAnalystRuntimeFromConfig)(host);
    if (cfg.mode !== "daily_auto")
        return null;
    const timezone = timezoneFromConfig(host.config);
    const todayKey = (0, time_1.localDateKeyInTimezone)(now, timezone);
    const yesterdayKey = (0, time_1.addDaysToDateKey)(todayKey, -1);
    const already = await (0, persist_4.readAiAnalystDay)(host.getAbsolutePath(persist_4.AI_ANALYST_FINDINGS_CATEGORY), yesterdayKey);
    if (already)
        return null; // bereits verarbeitet (auch disabled/no_token/error zählt als "erledigt" für diesen Tag)
    return runDailyAnalystForDate(host, yesterdayKey, provider);
}
exports.maybeRunDailyAnalystAutomatically = maybeRunDailyAnalystAutomatically;
function emptyManualResult(status, reasonDe, dateKey = null) {
    return {
        ran: false,
        status,
        dateKey,
        findings: [],
        reasonDe,
        usage: { promptTokens: null, completionTokens: null },
    };
}
/**
 * Kurztext für den Admin-sendTo-Dialog — kein JSON-Dump, nur der effektive Ausgang.
 */
function formatAiDailyAnalystAdminHint(outcome) {
    switch (outcome.status) {
        case "disabled":
            return "Daily Analyst ist deaktiviert";
        case "no_token":
            return "no_token";
        case "no_data":
            return "kein evaluierter Tag verfügbar";
        case "ok":
            return "abgeschlossen";
        case "error":
        case "invalid_response":
            return outcome.error ? `Fehler: ${outcome.error}` : "Fehler";
        default:
            return outcome.reasonDe || outcome.status;
    }
}
exports.formatAiDailyAnalystAdminHint = formatAiDailyAnalystAdminHint;
/**
 * Admin-„Jetzt analysieren“: setzt denselben Runtime-Trigger wie der Objektbaum
 * (`ai.daily_analyst.run_now_request`) und führt denselben Manual-Pfad aus.
 * Overrides werden dadurch nicht eingeschaltet.
 */
async function runDailyAnalystFromAdminButton(host, now = new Date(), provider) {
    const cfg = await (0, ensure_states_1.syncAiDailyAnalystRuntimeFromConfig)(host);
    if (cfg.mode === "disabled") {
        const hint = formatAiDailyAnalystAdminHint(emptyManualResult("disabled", "Daily Analyst ist deaktiviert"));
        return { result: "error", status: "disabled", hint, text: hint };
    }
    if (!hostHasDataPath(host)) {
        const hint = "Daily Analyst: Datenpfad nicht verfügbar";
        host.log?.error?.(hint);
        return { result: "error", status: "error", hint, text: hint };
    }
    try {
        // ack:true — kein zweites onStateChange; der Trigger bleibt im Objektbaum sichtbar.
        await host.setStateAsync(ensure_states_1.AI_ANALYST_STATES.runNowRequest, { val: true, ack: true });
    }
    catch {
        /* Trigger-State ist best-effort; der Lauf folgt trotzdem über denselben Manual-Pfad. */
    }
    const outcome = await handleDailyAnalystRunNowRequest(host, now, provider);
    const hint = formatAiDailyAnalystAdminHint(outcome);
    const result = outcome.status === "disabled" || outcome.status === "error" || outcome.status === "invalid_response"
        ? "error"
        : "ok";
    return { result, status: outcome.status, hint, text: hint };
}
exports.runDailyAnalystFromAdminButton = runDailyAnalystFromAdminButton;
/** Gemeinsamer Handler für Objektbaum-Button und Admin-sendTo. */
async function handleDailyAnalystRunNowRequest(host, now = new Date(), provider) {
    try {
        await host.setStateAsync(ensure_states_1.AI_ANALYST_STATES.runNowRequest, { val: false, ack: true });
    }
    catch {
        /* Reset ist best-effort */
    }
    if (!hostHasDataPath(host)) {
        const outcome = emptyManualResult("error", "Daily Analyst: Datenpfad nicht verfügbar");
        host.log?.error?.(outcome.reasonDe);
        return outcome;
    }
    return runDailyAnalystManual(host, now, provider);
}
exports.handleDailyAnalystRunNowRequest = handleDailyAnalystRunNowRequest;
/**
 * Für den manuellen Button: analysiert den zuletzt vom Daily Evaluator bewerteten Tag.
 * `manual`: immer (erneut). `daily_auto`: nur wenn der Tag noch nicht persistiert ist
 * (bestehende Auto-Deduplizierung). `disabled`: kein Lauf.
 */
async function runDailyAnalystManual(host, now = new Date(), provider) {
    const cfg = await (0, ensure_states_1.syncAiDailyAnalystRuntimeFromConfig)(host);
    if (cfg.mode === "disabled") {
        return emptyManualResult("disabled", "Daily Analyst ist deaktiviert");
    }
    const timezone = timezoneFromConfig(host.config);
    const todayKey = (0, time_1.localDateKeyInTimezone)(now, timezone);
    const yesterdayKey = (0, time_1.addDaysToDateKey)(todayKey, -1);
    if (cfg.mode === "daily_auto") {
        const already = await (0, persist_4.readAiAnalystDay)(host.getAbsolutePath(persist_4.AI_ANALYST_FINDINGS_CATEGORY), yesterdayKey);
        if (already) {
            await publish(host, ensure_states_1.AI_ANALYST_STATES.status, already.status);
            await publish(host, ensure_states_1.AI_ANALYST_STATES.reasonDe, already.reasonDe);
            await publish(host, ensure_states_1.AI_ANALYST_STATES.findingsCount, already.findings.length);
            const top = [...already.findings].sort((a, b) => b.confidencePct - a.confidencePct)[0];
            await publish(host, ensure_states_1.AI_ANALYST_STATES.topFindingDe, top ? `${top.observedBehaviorDe} → ${top.suggestedImprovementDe}` : "");
            return {
                ran: false,
                status: already.status,
                dateKey: yesterdayKey,
                findings: already.findings,
                reasonDe: already.reasonDe || "bereits analysiert (1×/Tag)",
                usage: { promptTokens: null, completionTokens: null },
            };
        }
    }
    return runDailyAnalystForDate(host, yesterdayKey, provider);
}
exports.runDailyAnalystManual = runDailyAnalystManual;
