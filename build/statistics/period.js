"use strict";
/** Statistik-Zeiträume: von–bis aus Perioden-ID. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.fixedTariffCostForRange = exports.resolveStatisticsStartKey = exports.clipPeriodRangeToStart = exports.earliestDayKey = exports.dayKeysInRange = exports.listPeriodOptions = exports.resolvePeriodRange = exports.normalizePeriodId = exports.isValidPeriodId = exports.makeDateKey = exports.parseDateKey = void 0;
function pad2(n) {
    return n < 10 ? `0${n}` : String(n);
}
function parseDateKey(dateKey) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
    if (!m)
        return null;
    return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}
exports.parseDateKey = parseDateKey;
function makeDateKey(y, m, d) {
    return `${y}-${pad2(m)}-${pad2(d)}`;
}
exports.makeDateKey = makeDateKey;
function daysInMonthNum(y, m) {
    return new Date(y, m, 0).getDate();
}
function addDays(dateKey, delta) {
    const p = parseDateKey(dateKey);
    if (!p)
        return dateKey;
    const dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
    dt.setUTCDate(dt.getUTCDate() + delta);
    return makeDateKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
function quarterStartMonth(m) {
    return Math.floor((m - 1) / 3) * 3 + 1;
}
function isValidPeriodId(id) {
    if (id === "today" ||
        id === "yesterday" ||
        id === "last_7_days" ||
        id === "this_month" ||
        id === "last_month" ||
        id === "this_quarter" ||
        id === "last_quarter" ||
        id === "this_year" ||
        id === "last_year") {
        return true;
    }
    return /^year_\d{4}$/.test(id);
}
exports.isValidPeriodId = isValidPeriodId;
function normalizePeriodId(raw, fallback = "this_month") {
    const s = typeof raw === "string" ? raw.trim() : "";
    return isValidPeriodId(s) ? s : fallback;
}
exports.normalizePeriodId = normalizePeriodId;
function resolvePeriodRange(periodId, todayKey) {
    const today = parseDateKey(todayKey);
    if (!today)
        return null;
    const id = normalizePeriodId(periodId);
    if (id === "today") {
        return {
            id,
            labelDe: "Heute",
            fromKey: todayKey,
            toKey: todayKey,
        };
    }
    if (id === "yesterday") {
        const yKey = addDays(todayKey, -1);
        return {
            id,
            labelDe: "Gestern",
            fromKey: yKey,
            toKey: yKey,
        };
    }
    if (id === "last_7_days") {
        return {
            id,
            labelDe: "Letzte 7 Tage",
            fromKey: addDays(todayKey, -6),
            toKey: todayKey,
        };
    }
    if (id === "this_month") {
        return {
            id,
            labelDe: "Dieser Monat",
            fromKey: makeDateKey(today.y, today.m, 1),
            toKey: todayKey,
        };
    }
    if (id === "last_month") {
        const m = today.m === 1 ? 12 : today.m - 1;
        const y = today.m === 1 ? today.y - 1 : today.y;
        const lastDay = daysInMonthNum(y, m);
        return {
            id,
            labelDe: "Letzter Monat",
            fromKey: makeDateKey(y, m, 1),
            toKey: makeDateKey(y, m, lastDay),
        };
    }
    if (id === "this_quarter") {
        const qStart = quarterStartMonth(today.m);
        return {
            id,
            labelDe: "Dieses Quartal",
            fromKey: makeDateKey(today.y, qStart, 1),
            toKey: todayKey,
        };
    }
    if (id === "last_quarter") {
        const thisQ = quarterStartMonth(today.m);
        let y = today.y;
        let qStart = thisQ - 3;
        if (qStart < 1) {
            qStart += 12;
            y -= 1;
        }
        const qEndM = qStart + 2;
        const lastDay = daysInMonthNum(y, qEndM);
        return {
            id,
            labelDe: "Letztes Quartal",
            fromKey: makeDateKey(y, qStart, 1),
            toKey: makeDateKey(y, qEndM, lastDay),
        };
    }
    if (id === "this_year") {
        return {
            id,
            labelDe: "Dieses Jahr",
            fromKey: makeDateKey(today.y, 1, 1),
            toKey: todayKey,
        };
    }
    if (id === "last_year") {
        return {
            id,
            labelDe: "Letztes Jahr",
            fromKey: makeDateKey(today.y - 1, 1, 1),
            toKey: makeDateKey(today.y - 1, 12, 31),
        };
    }
    const ym = /^year_(\d{4})$/.exec(id);
    if (ym) {
        const y = Number(ym[1]);
        const toKey = y === today.y ? todayKey : makeDateKey(y, 12, 31);
        return {
            id,
            labelDe: `Jahr ${y}`,
            fromKey: makeDateKey(y, 1, 1),
            toKey,
        };
    }
    return null;
}
exports.resolvePeriodRange = resolvePeriodRange;
/** Feste Perioden + Jahre aus Persistenz (älteste zuerst). */
function listPeriodOptions(todayKey, dayKeys) {
    const fixed = [
        { id: "today", labelDe: "Heute" },
        { id: "yesterday", labelDe: "Gestern" },
        { id: "last_7_days", labelDe: "Letzte 7 Tage" },
        { id: "this_month", labelDe: "Dieser Monat" },
        { id: "last_month", labelDe: "Letzter Monat" },
        { id: "this_quarter", labelDe: "Dieses Quartal" },
        { id: "last_quarter", labelDe: "Letztes Quartal" },
        { id: "this_year", labelDe: "Dieses Jahr" },
        { id: "last_year", labelDe: "Letztes Jahr" },
    ];
    const today = parseDateKey(todayKey);
    const years = new Set();
    for (const k of dayKeys) {
        const p = parseDateKey(k);
        if (p)
            years.add(p.y);
    }
    if (today)
        years.add(today.y);
    const yearOpts = [...years]
        .sort((a, b) => b - a)
        .map((y) => ({ id: `year_${y}`, labelDe: `Jahr ${y}` }));
    return [...fixed, ...yearOpts];
}
exports.listPeriodOptions = listPeriodOptions;
function dayKeysInRange(days, fromKey, toKey) {
    return Object.keys(days)
        .filter((k) => k >= fromKey && k <= toKey)
        .sort();
}
exports.dayKeysInRange = dayKeysInRange;
/** Frühestes YYYY-MM-DD aus Persistenz-Tagen. */
function earliestDayKey(dayKeys) {
    const sorted = dayKeys.filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
    return sorted[0] ?? null;
}
exports.earliestDayKey = earliestDayKey;
/**
 * Zeitraum nicht vor Statistik-Start (Installation) beginnen.
 * Wenn der ganze Zeitraum vor dem Start liegt → null (keine Daten).
 */
function clipPeriodRangeToStart(range, statisticsStartKey) {
    if (!statisticsStartKey || !/^\d{4}-\d{2}-\d{2}$/.test(statisticsStartKey)) {
        return range;
    }
    if (range.toKey < statisticsStartKey) {
        return null;
    }
    const fromKey = range.fromKey < statisticsStartKey ? statisticsStartKey : range.fromKey;
    const clipped = fromKey !== range.fromKey;
    return {
        ...range,
        fromKey,
        labelDe: clipped ? `${range.labelDe} (ab ${statisticsStartKey})` : range.labelDe,
    };
}
exports.clipPeriodRangeToStart = clipPeriodRangeToStart;
/** Wirksamer Statistik-Start: Admin-Datum, sonst frühester Persist-/Tibber-Tag. */
function resolveStatisticsStartKey(input) {
    if (input.adminStartKey && /^\d{4}-\d{2}-\d{2}$/.test(input.adminStartKey)) {
        return input.adminStartKey;
    }
    const candidates = [
        earliestDayKey(input.persistDayKeys),
        input.tibberEarliestKey,
    ].filter((k) => !!k);
    if (!candidates.length)
        return null;
    return candidates.sort()[0];
}
exports.resolveStatisticsStartKey = resolveStatisticsStartKey;
/** Monatliche Grundgebühr anteilig über alle Kalendermonate in [from,to]. */
function fixedTariffCostForRange(input) {
    if (input.gridImportKwh === null || input.compareTariffCtPerKwh === null)
        return null;
    if (!(input.gridImportKwh >= 0) || !(input.compareTariffCtPerKwh >= 0))
        return null;
    const energyEur = (input.gridImportKwh * input.compareTariffCtPerKwh) / 100;
    let base = 0;
    const from = parseDateKey(input.fromKey);
    const to = parseDateKey(input.toKey);
    if (from && to && input.monthlyBaseEur !== null && input.monthlyBaseEur > 0) {
        let y = from.y;
        let m = from.m;
        while (y < to.y || (y === to.y && m <= to.m)) {
            const dim = daysInMonthNum(y, m);
            const startD = y === from.y && m === from.m ? from.d : 1;
            const endD = y === to.y && m === to.m ? to.d : dim;
            const days = Math.max(0, endD - startD + 1);
            base += input.monthlyBaseEur * (days / dim);
            m += 1;
            if (m > 12) {
                m = 1;
                y += 1;
            }
        }
    }
    return Math.round((energyEur + base) * 100) / 100;
}
exports.fixedTariffCostForRange = fixedTariffCostForRange;
