"use strict";
/**
 * PHASE 6 — Öffentliche Fassade des KI-Override-Ledgers für andere Module (z. B. Shadow Engine,
 * Economics), damit diese nicht auf interne Validator-Details angewiesen sind.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.listActiveOverrides = exports.listOverridesForDate = exports.wasAiOverrideActiveOnDate = void 0;
const persist_1 = require("./override/persist");
const validate_1 = require("./override/validate");
/**
 * Wurde am angegebenen lokalen Kalendertag ein validierter KI-Override aktiv (nicht abgelehnt)?
 * Aktuell im Produktionsbetrieb `false`, solange Admin `ai_override_enabled` aus ist oder
 * keine validierten Overrides existieren — das ist korrekt, keine Vereinfachung
 * (siehe `simulateEmsWithoutAi`).
 */
async function wasAiOverrideActiveOnDate(host, dateKey) {
    if (typeof host.getAbsolutePath !== "function")
        return false;
    try {
        const baseDir = host.getAbsolutePath(persist_1.AI_OVERRIDE_LEDGER_CATEGORY);
        const store = await (0, persist_1.readOverrideLedgerStore)(baseDir);
        const swept = (0, validate_1.sweepExpiredOverrides)(store.overrides);
        return swept.some((o) => o.dateKey === dateKey && o.status !== "rejected");
    }
    catch {
        return false;
    }
}
exports.wasAiOverrideActiveOnDate = wasAiOverrideActiveOnDate;
async function listOverridesForDate(host, dateKey) {
    if (typeof host.getAbsolutePath !== "function")
        return [];
    try {
        const baseDir = host.getAbsolutePath(persist_1.AI_OVERRIDE_LEDGER_CATEGORY);
        const store = await (0, persist_1.readOverrideLedgerStore)(baseDir);
        return (0, validate_1.sweepExpiredOverrides)(store.overrides).filter((o) => o.dateKey === dateKey);
    }
    catch {
        return [];
    }
}
exports.listOverridesForDate = listOverridesForDate;
async function listActiveOverrides(host) {
    if (typeof host.getAbsolutePath !== "function")
        return [];
    try {
        const baseDir = host.getAbsolutePath(persist_1.AI_OVERRIDE_LEDGER_CATEGORY);
        const store = await (0, persist_1.readOverrideLedgerStore)(baseDir);
        return (0, validate_1.sweepExpiredOverrides)(store.overrides).filter((o) => o.status === "active");
    }
    catch {
        return [];
    }
}
exports.listActiveOverrides = listActiveOverrides;
