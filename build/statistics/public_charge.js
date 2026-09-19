"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invoicedPublicTotals = exports.pendingPublicKwh = exports.applyPublicInvoice = exports.openPublicChargeSession = exports.parsePublicInvoiceSubmit = void 0;
const state_util_1 = require("../ems_light/state_util");
function parseDateKey(raw) {
    if (typeof raw !== "string")
        return null;
    const value = raw.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        return null;
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
        ? value
        : null;
}
function parsePublicInvoiceSubmit(raw) {
    if (raw == null || raw === "")
        return null;
    try {
        const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (!obj || typeof obj !== "object")
            return null;
        const o = obj;
        const date = parseDateKey(o.date);
        if (o.date !== undefined && date === null)
            return null;
        return {
            sessionId: typeof o.sessionId === "string" ? o.sessionId.trim() : undefined,
            date: date ?? undefined,
            kwh: (0, state_util_1.asNum)(o.kwh) ?? undefined,
            eur: (0, state_util_1.asNum)(o.eur) ?? undefined,
            noteDe: typeof o.noteDe === "string" ? o.noteDe.trim().slice(0, 200) : undefined,
            discard: o.discard === true,
            manual: o.manual === true,
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
    if (submit.manual) {
        const kwh = submit.kwh;
        const eur = submit.eur;
        if (kwh === null || kwh === undefined || !(kwh > 0) || eur === null || eur === undefined || !(eur >= 0)) {
            return { sessions, ackDe: "Rechnung unvollständig — bitte kWh und Gesamtbetrag angeben." };
        }
        const id = `pc_manual_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
        const entry = {
            id,
            openedAtIso: nowIso,
            closedAtIso: nowIso,
            estimatedKwh: null,
            invoiceKwh: kwh,
            invoiceEur: eur,
            fuelPriceEurPerLSnapshot: null,
            status: "invoiced",
            noteDe: submit.noteDe || "Schnelllader-Rechnung manuell erfasst.",
        };
        return {
            sessions: [...sessions, entry],
            ackDe: `Rechnung erfasst: ${kwh} kWh / ${eur} €${submit.date ? ` am ${submit.date}` : ""}.`,
        };
    }
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
