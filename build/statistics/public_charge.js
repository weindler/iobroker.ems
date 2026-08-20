"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invoicedPublicTotals = exports.pendingPublicKwh = exports.applyPublicInvoice = exports.openPublicChargeSession = exports.parsePublicInvoiceSubmit = void 0;
const state_util_1 = require("../ems_light/state_util");
function parsePublicInvoiceSubmit(raw) {
    if (raw == null || raw === "")
        return null;
    try {
        const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (!obj || typeof obj !== "object")
            return null;
        const o = obj;
        return {
            sessionId: typeof o.sessionId === "string" ? o.sessionId.trim() : undefined,
            kwh: (0, state_util_1.asNum)(o.kwh) ?? undefined,
            eur: (0, state_util_1.asNum)(o.eur) ?? undefined,
            noteDe: typeof o.noteDe === "string" ? o.noteDe.trim().slice(0, 200) : undefined,
            discard: o.discard === true,
        };
    }
    catch {
        return null;
    }
}
exports.parsePublicInvoiceSubmit = parsePublicInvoiceSubmit;
function openPublicChargeSession(input) {
    const id = `pc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    return {
        id,
        openedAtIso: input.nowIso,
        closedAtIso: null,
        estimatedKwh: input.estimatedKwh,
        invoiceKwh: null,
        invoiceEur: null,
        fuelPriceEurPerLSnapshot: input.fuelPriceEurPerLSnapshot,
        status: "pending_invoice",
        noteDe: input.noteDe ?? "Schnellader erkannt — Rechnung manuell eintragen.",
    };
}
exports.openPublicChargeSession = openPublicChargeSession;
function applyPublicInvoice(sessions, submit, nowIso) {
    const pending = sessions.filter((s) => s.status === "pending_invoice");
    const target = (submit.sessionId
        ? sessions.find((s) => s.id === submit.sessionId)
        : pending[pending.length - 1]) ?? null;
    if (!target || target.status !== "pending_invoice") {
        return { sessions, ackDe: "Keine offene Schnellader-Session gefunden." };
    }
    const next = sessions.map((s) => {
        if (s.id !== target.id)
            return s;
        if (submit.discard) {
            return {
                ...s,
                status: "discarded",
                closedAtIso: nowIso,
                noteDe: submit.noteDe || s.noteDe || "Verworfen.",
            };
        }
        const kwh = submit.kwh ?? s.estimatedKwh;
        const eur = submit.eur;
        if (eur === null || eur === undefined || !(eur >= 0) || kwh === null || !(kwh >= 0)) {
            return s;
        }
        return {
            ...s,
            status: "invoiced",
            closedAtIso: nowIso,
            invoiceKwh: kwh,
            invoiceEur: eur,
            noteDe: submit.noteDe || s.noteDe,
        };
    });
    if (submit.discard) {
        return { sessions: next, ackDe: `Session ${target.id} verworfen.` };
    }
    const updated = next.find((s) => s.id === target.id);
    if (updated?.status !== "invoiced") {
        return {
            sessions,
            ackDe: "Rechnung unvollständig — bitte kwh und eur angeben.",
        };
    }
    return {
        sessions: next,
        ackDe: `Rechnung erfasst: ${updated.invoiceKwh} kWh / ${updated.invoiceEur} € (${target.id}).`,
    };
}
exports.applyPublicInvoice = applyPublicInvoice;
function pendingPublicKwh(sessions) {
    return sessions
        .filter((s) => s.status === "pending_invoice")
        .reduce((sum, s) => sum + (s.estimatedKwh ?? 0), 0);
}
exports.pendingPublicKwh = pendingPublicKwh;
function invoicedPublicTotals(sessions) {
    let kwh = 0;
    let eur = 0;
    for (const s of sessions) {
        if (s.status !== "invoiced")
            continue;
        kwh += s.invoiceKwh ?? 0;
        eur += s.invoiceEur ?? 0;
    }
    return { kwh: Math.round(kwh * 1000) / 1000, eur: Math.round(eur * 100) / 100 };
}
exports.invoicedPublicTotals = invoicedPublicTotals;
