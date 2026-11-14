"use strict";
/**
 * Energyforecast (energyforecast.de) API v2 — Antwort auswerten. Rein, ohne I/O.
 * Felder je Viertelstunde: start, end, price_ct_kwh (Markt), total_ct_kwh (inkl. Netzentgelt/Steuern,
 * laut Profil beim Anbieter), price_origin ("market" = echter Day-Ahead-Preis, "forecast" = Prognose).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EF_SLOT_MS = void 0;
exports.parseEnergyforecastResponse = parseEnergyforecastResponse;
exports.localDay = localDay;
exports.fullDaysAhead = fullDaysAhead;
exports.slotAt = slotAt;
exports.redactToken = redactToken;
exports.EF_SLOT_MS = 15 * 60 * 1000;
function num(v) {
    return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function iso(v) {
    if (typeof v !== "string")
        return null;
    return Number.isFinite(Date.parse(v)) ? v : null;
}
function parseEnergyforecastResponse(raw) {
    const root = (typeof raw === "string" ? safeJson(raw) : raw);
    const rows = root && Array.isArray(root.data) ? root.data : [];
    const byStart = new Map();
    for (const row of rows) {
        if (!row || typeof row !== "object")
            continue;
        const r = row;
        const startMs = typeof r.start === "string" ? Date.parse(r.start) : Number.NaN;
        const total = num(r.total_ct_kwh);
        // Plausibilitätsgrenzen (ct/kWh brutto) — alles andere ist kein Preis.
        if (!Number.isFinite(startMs) || total === null || total < -100 || total > 500)
            continue;
        const endParsed = typeof r.end === "string" ? Date.parse(r.end) : Number.NaN;
        const origin = r.price_origin === "market" ? "market" : r.price_origin === "forecast" ? "forecast" : "unknown";
        byStart.set(startMs, {
            startMs,
            endMs: Number.isFinite(endParsed) ? endParsed : startMs + exports.EF_SLOT_MS,
            priceCt: num(r.price_ct_kwh),
            totalCt: total,
            origin,
        });
    }
    const slots = [...byStart.values()].sort((a, b) => a.startMs - b.startMs);
    return {
        slots,
        plan: root && typeof root.plan === "string" ? root.plan : null,
        generatedAtIso: root ? iso(root.generated_at) : null,
        validUntilIso: root ? iso(root.valid_until) : null,
    };
}
function safeJson(s) {
    try {
        return JSON.parse(s);
    }
    catch {
        return null;
    }
}
/** Lokaler Kalendertag YYYY-MM-DD. */
function localDay(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** Anzahl voller Tage nach heute (>= 22 h an Slots, wegen Sommerzeitwechsel). */
function fullDaysAhead(slots, nowMs) {
    const today = localDay(nowMs);
    const counts = new Map();
    for (const s of slots) {
        const day = localDay(s.startMs);
        if (day > today)
            counts.set(day, (counts.get(day) ?? 0) + 1);
    }
    let n = 0;
    for (const c of counts.values())
        if (c >= 88)
            n++;
    return n;
}
/** Slot, der gerade läuft. */
function slotAt(slots, nowMs) {
    for (const s of slots)
        if (s.startMs <= nowMs && nowMs < s.endMs)
            return s;
    return null;
}
/** Token aus Fehlertexten entfernen — der Token darf nie in Logs oder States landen. */
function redactToken(message, token) {
    let out = message;
    if (token)
        out = out.split(token).join("***").split(encodeURIComponent(token)).join("***");
    return out.replace(/token=[^&\s"']+/gi, "token=***");
}
