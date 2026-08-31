"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearStaleDailyAnalystRunNowRequest = exports.syncAiDailyAnalystRuntimeFromConfig = exports.ensureAiDailyAnalystStates = exports.AI_ANALYST_STATES = void 0;
const state_util_1 = require("../../ems_light/state_util");
const config_1 = require("./config");
function strState(id, name, def) {
    return {
        id,
        common: { name, type: "string", role: "text", read: true, write: false, def },
        defaultVal: def,
        setDefaultIfEmpty: true,
    };
}
function numState(id, name) {
    return { id, common: { name, type: "number", role: "value", read: true, write: false, def: 0 } };
}
function boolState(id, name, opts = {}) {
    return {
        id,
        common: {
            name,
            type: "boolean",
            role: opts.role ?? "indicator",
            read: true,
            write: opts.write ?? false,
            def: opts.def ?? false,
        },
        defaultVal: opts.def ?? false,
        setDefaultIfEmpty: true,
    };
}
const BASE = "ai.daily_analyst";
exports.AI_ANALYST_STATES = {
    modeEffective: `${BASE}.mode_effective`,
    enabled: `${BASE}.enabled`,
    status: `${BASE}.status`,
    lastRunAtIso: `${BASE}.last_run_at`,
    lastRunDateKey: `${BASE}.last_run_date_key`,
    reasonDe: `${BASE}.reason_de`,
    lastError: `${BASE}.last_error`,
    findingsCount: `${BASE}.findings_count`,
    topFindingDe: `${BASE}.top_finding_de`,
    /** Nummerierte Findings des letzten Laufs (Klartext, kein JSON-Dump). */
    findingsDe: `${BASE}.findings_de`,
    runNowRequest: `${BASE}.run_now_request`,
};
async function ensureAiDailyAnalystStates(host) {
    await (0, state_util_1.ensureChannel)(host, "ai.daily_analyst", "KI Daily Analyst (Phase 4) — reine Analyse, kein Regler");
    const defs = [
        strState(exports.AI_ANALYST_STATES.modeEffective, "KI Daily Analyst Modus (effektiv)", "disabled"),
        boolState(exports.AI_ANALYST_STATES.enabled, "KI Daily Analyst aktiv"),
        strState(exports.AI_ANALYST_STATES.status, "KI Daily Analyst Status", "disabled"),
        strState(exports.AI_ANALYST_STATES.lastRunAtIso, "KI Daily Analyst letzter Lauf (ISO)"),
        strState(exports.AI_ANALYST_STATES.lastRunDateKey, "KI Daily Analyst letzter analysierter Tag"),
        strState(exports.AI_ANALYST_STATES.reasonDe, "KI Daily Analyst Status/Begründung", "KI Daily Analyst deaktiviert."),
        strState(exports.AI_ANALYST_STATES.lastError, "KI Daily Analyst letzter Fehler", ""),
        numState(exports.AI_ANALYST_STATES.findingsCount, "KI Daily Analyst Findings letzter Tag"),
        strState(exports.AI_ANALYST_STATES.topFindingDe, "KI Daily Analyst wichtigstes Finding", ""),
        strState(exports.AI_ANALYST_STATES.findingsDe, "KI Daily Analyst Findings (nummeriert)", ""),
        boolState(exports.AI_ANALYST_STATES.runNowRequest, "KI Daily Analyst jetzt analysieren (manuell)", {
            write: true,
            role: "button",
        }),
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensureAiDailyAnalystStates = ensureAiDailyAnalystStates;
async function publish(host, id, val) {
    try {
        await host.setStateAsync(id, { val, ack: true });
    }
    catch {
        /* Status-States sind best-effort */
    }
}
function idleReasonDe(mode) {
    if (mode === "manual") {
        return "Bereit — manueller Lauf über „Jetzt analysieren“.";
    }
    if (mode === "daily_auto") {
        return "Bereit — automatische Tagesanalyse aktiv.";
    }
    return "KI Daily Analyst deaktiviert.";
}
/**
 * Schreibt enabled/mode_effective (und status, falls er zum Admin-Modus nicht passt)
 * aus der nativen Adapter-Config. Ohne diesen Schritt bleiben die Ensure-Defaults
 * (`disabled`/`false`) nach Speichern/Neustart stehen, weil kein Analyst-Lauf nötig war.
 */
async function syncAiDailyAnalystRuntimeFromConfig(host) {
    await ensureAiDailyAnalystStates(host);
    const cfg = (0, config_1.aiAnalystConfigFromAdapter)(host.config);
    await publish(host, exports.AI_ANALYST_STATES.modeEffective, cfg.mode);
    await publish(host, exports.AI_ANALYST_STATES.enabled, cfg.mode !== "disabled");
    const curStatus = String((await host.getStateAsync(exports.AI_ANALYST_STATES.status))?.val ?? "");
    if (cfg.mode === "disabled") {
        await publish(host, exports.AI_ANALYST_STATES.status, "disabled");
        const curReason = String((await host.getStateAsync(exports.AI_ANALYST_STATES.reasonDe))?.val ?? "");
        if (curStatus !== "disabled" || !curReason) {
            await publish(host, exports.AI_ANALYST_STATES.reasonDe, idleReasonDe("disabled"));
        }
    }
    else if (curStatus === "disabled" || curStatus === "") {
        await publish(host, exports.AI_ANALYST_STATES.status, "idle");
        await publish(host, exports.AI_ANALYST_STATES.reasonDe, idleReasonDe(cfg.mode));
    }
    return cfg;
}
exports.syncAiDailyAnalystRuntimeFromConfig = syncAiDailyAnalystRuntimeFromConfig;
/** Hängenden Button (true) nach Restart leeren — kein stiller Lauf. */
async function clearStaleDailyAnalystRunNowRequest(host) {
    const st = await host.getStateAsync(exports.AI_ANALYST_STATES.runNowRequest);
    if (st?.val !== true) {
        return false;
    }
    await host.setStateAsync(exports.AI_ANALYST_STATES.runNowRequest, { val: false, ack: true });
    return true;
}
exports.clearStaleDailyAnalystRunNowRequest = clearStaleDailyAnalystRunNowRequest;
