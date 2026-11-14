"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BIAS_HISTORY_DAYS = exports.BIAS_MAX_CT = exports.BIAS_SHRINK_DAYS = exports.BIAS_MIN_DAYS = void 0;
exports.dayTypeOf = dayTypeOf;
exports.leadBucket = leadBucket;
exports.dayHourBiases = dayHourBiases;
exports.mergeBiasHistory = mergeBiasHistory;
exports.biasDaysAvailable = biasDaysAvailable;
exports.estimateBiasCt = estimateBiasCt;
/**
 * Energyforecast: gelernte Verzerrung je Stunde und Tagestyp.
 * Aus festgehaltenen Prognosen und später bekannten echten Preisen entsteht je Zieltag ein Stundenfehler.
 * Daraus wird für Prognose-Preise ein Abzug geschätzt — erst ab genug verglichenen Tagen und mit Rückfall auf
 * das Gesamtmittel, wenn für den Tagestyp (Werktag / Samstag / Sonntag) noch wenig Daten da sind.
 */
const parse_1 = require("./parse");
const compare_1 = require("./compare");
/** Mindestens so viele verglichene Tage (je Vorlauf-Gruppe), bevor überhaupt korrigiert wird. */
exports.BIAS_MIN_DAYS = 4;
/** Gewicht des Gesamtmittels gegenüber dem Tagestyp (in "Tagen"): wenige Tage → Gesamtmittel zählt stärker. */
exports.BIAS_SHRINK_DAYS = 3;
/** Größter Abzug/Zuschlag in ct/kWh. */
exports.BIAS_MAX_CT = 12;
exports.BIAS_HISTORY_DAYS = 150;
function dayTypeOf(date) {
    const [y, m, d] = date.split("-").map(Number);
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return wd === 0 ? "sonntag" : wd === 6 ? "samstag" : "werktag";
}
function leadBucket(lead) {
    return Math.min(3, Math.max(1, lead));
}
function localHour(ms) {
    return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hour12: false }).format(new Date(ms))) % 24;
}
function dayDiff(a, b) {
    const pa = a.split("-").map(Number);
    const pb = b.split("-").map(Number);
    return Math.round((Date.UTC(pa[0], pa[1] - 1, pa[2]) - Date.UTC(pb[0], pb[1] - 1, pb[2])) / 86_400_000);
}
/** Je (Zieltag, Vorlauf) den Stundenfehler — gleiche Auswahl wie die Auswertung (letzter Snapshot des Abruftags). */
function dayHourBiases(snapshots, actual) {
    const best = new Map();
    for (const snap of [...snapshots].sort((a, b) => a.atMs - b.atMs)) {
        const snapDay = (0, parse_1.localDay)(snap.atMs);
        for (const date of new Set(snap.slots.map(([s]) => (0, parse_1.localDay)(s)))) {
            const lead = dayDiff(date, snapDay);
            if (lead < 1)
                continue;
            best.set(`${date}|${lead}`, { snap, date, lead });
        }
    }
    const out = [];
    for (const { snap, date, lead } of best.values()) {
        const perHour = new Map();
        let pairs = 0;
        for (const [start, f] of snap.slots) {
            if ((0, parse_1.localDay)(start) !== date)
                continue;
            const a = actual[String(start)];
            if (typeof a !== "number" || !Number.isFinite(a))
                continue;
            pairs++;
            const h = localHour(start);
            const cur = perHour.get(h) ?? { sum: 0, n: 0 };
            cur.sum += f - a;
            cur.n++;
            perHour.set(h, cur);
        }
        if (pairs < compare_1.MIN_SLOTS_PER_DAY)
            continue;
        out.push({
            date,
            lead,
            dayType: dayTypeOf(date),
            hours: [...perHour.entries()]
                .sort((x, y) => x[0] - y[0])
                .map(([hour, v]) => ({ hour, biasCt: Math.round((v.sum / v.n) * 100) / 100, n: v.n })),
        });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.lead - b.lead);
}
/** Neue Einträge in den Verlauf einarbeiten (je Datum+Vorlauf ersetzen), Altes entfernen. */
function mergeBiasHistory(history, fresh, nowMs) {
    const map = new Map();
    for (const e of history)
        map.set(`${e.date}|${e.lead}`, e);
    for (const e of fresh)
        map.set(`${e.date}|${e.lead}`, e);
    const cutoff = nowMs - exports.BIAS_HISTORY_DAYS * 86_400_000;
    return [...map.values()]
        .filter((e) => Date.parse(`${e.date}T12:00:00Z`) >= cutoff)
        .sort((a, b) => a.date.localeCompare(b.date) || a.lead - b.lead);
}
function biasDaysAvailable(history, lead) {
    const b = leadBucket(lead);
    return new Set(history.filter((e) => leadBucket(e.lead) === b).map((e) => e.date)).size;
}
/**
 * Geschätzte Verzerrung (ct/kWh, + = Prognose zu hoch) für Stunde, Tagestyp und Vorlauf.
 * null, solange zu wenig Tage verglichen wurden.
 */
function estimateBiasCt(history, hour, dayType, lead) {
    const b = leadBucket(lead);
    const entries = history.filter((e) => leadBucket(e.lead) === b);
    if (new Set(entries.map((e) => e.date)).size < exports.BIAS_MIN_DAYS)
        return null;
    const mean = (list) => {
        let sum = 0;
        let w = 0;
        const days = new Set();
        for (const e of list) {
            const h = e.hours.find((x) => x.hour === hour);
            if (!h)
                continue;
            sum += h.biasCt * h.n;
            w += h.n;
            days.add(e.date);
        }
        return w > 0 ? { v: sum / w, days: days.size } : null;
    };
    const all = mean(entries);
    if (!all)
        return null;
    const same = mean(entries.filter((e) => e.dayType === dayType));
    const est = same ? (same.days * same.v + exports.BIAS_SHRINK_DAYS * all.v) / (same.days + exports.BIAS_SHRINK_DAYS) : all.v;
    return Math.max(-exports.BIAS_MAX_CT, Math.min(exports.BIAS_MAX_CT, Math.round(est * 100) / 100));
}
