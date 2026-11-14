"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dateKeyFromTs = dateKeyFromTs;
exports.dateKeyFromOffset = dateKeyFromOffset;
exports.dayBoundsMs = dayBoundsMs;
exports.detectPriceUnit = detectPriceUnit;
exports.isValidPriceValue = isValidPriceValue;
exports.toEurPerKwh = toEurPerKwh;
exports.resolvePriceUnit = resolvePriceUnit;
exports.fetchPriceSamples = fetchPriceSamples;
exports.summarizeDays = summarizeDays;
const state_util_1 = require("../../ems_light/state_util");
const history_query_1 = require("../history_query");
const constants_1 = require("./constants");
function isForeignStateId(stateId) {
    return /^[a-z0-9_-]+\.\d+\./i.test(stateId);
}
function hourBucketMs(ts) {
    return Math.floor(ts / 3_600_000) * 3_600_000;
}
function dateKeyFromTs(ts) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}
function dateKeyFromOffset(dayOffset) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - dayOffset);
    return dateKeyFromTs(d.getTime());
}
function dayBoundsMs(dayOffset) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - dayOffset);
    const start = d.getTime();
    return { start, end: start + constants_1.MS_PER_DAY };
}
function detectPriceUnit(stateId, unit) {
    const u = (unit ?? "").toLowerCase();
    if (u.includes("ct") || stateId.includes("ct_per_kwh")) {
        return "ct_per_kwh";
    }
    if (u.includes("eur") || u.includes("€") || u.includes("euro")) {
        return "eur_per_kwh";
    }
    return stateId.includes("ct_per_kwh") ? "ct_per_kwh" : "eur_per_kwh";
}
/** missing ≠ 0 — nur explizit gelieferte, endliche, plausible Werte sind gültig. */
function isValidPriceValue(value, unit) {
    if (value === null || !Number.isFinite(value)) {
        return false;
    }
    if (unit === "ct_per_kwh") {
        return value >= constants_1.PLAUSIBLE_CT_MIN && value <= constants_1.PLAUSIBLE_CT_MAX;
    }
    return value >= constants_1.PLAUSIBLE_EUR_MIN && value <= constants_1.PLAUSIBLE_EUR_MAX;
}
function toEurPerKwh(value, unit) {
    return unit === "ct_per_kwh" ? value / 100 : value;
}
async function resolvePriceUnit(host, stateId) {
    if (!host.getObjectAsync) {
        return detectPriceUnit(stateId);
    }
    try {
        const obj = await host.getObjectAsync(stateId);
        const unit = obj?.common && typeof obj.common === "object" ? String(obj.common.unit ?? "") : "";
        return detectPriceUnit(stateId, unit);
    }
    catch {
        return detectPriceUnit(stateId);
    }
}
async function fetchPriceSamples(host, stateId, lookbackDays) {
    const unit = await resolvePriceUnit(host, stateId);
    const samples = [];
    const rows = await (0, history_query_1.fetchHistoryRowsLookback)(host, stateId, lookbackDays, history_query_1.HISTORY_ROWS_PER_DAY, history_query_1.HISTORY_CHUNK_TIMEOUT_MS);
    const seen = new Set();
    for (const row of rows) {
        const ts = typeof row?.ts === "number" ? row.ts : null;
        const raw = (0, state_util_1.asNum)(row?.val);
        if (ts === null || !isValidPriceValue(raw, unit)) {
            continue;
        }
        const bucket = hourBucketMs(ts);
        if (seen.has(bucket)) {
            continue;
        }
        seen.add(bucket);
        const d = new Date(bucket);
        samples.push({
            ts: bucket,
            priceEur: toEurPerKwh(raw, unit),
            hourBucket: bucket,
            dateKey: dateKeyFromTs(bucket),
            hourOfDay: d.getHours(),
        });
    }
    return { samples, unit };
}
function summarizeDays(samples, lookbackDays) {
    const byDay = new Map();
    for (const s of samples) {
        const list = byDay.get(s.dateKey) ?? [];
        list.push(s.priceEur);
        byDay.set(s.dateKey, list);
    }
    const summaries = [];
    for (let dayOffset = 0; dayOffset < lookbackDays; dayOffset++) {
        const dateKey = dateKeyFromOffset(dayOffset);
        const prices = byDay.get(dateKey) ?? [];
        const validHours = prices.length;
        const avgPriceEur = validHours > 0 ? prices.reduce((a, b) => a + b, 0) / validHours : null;
        summaries.push({ dateKey, dayOffset, validHours, avgPriceEur });
    }
    return summaries;
}
