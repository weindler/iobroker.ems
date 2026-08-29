"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeUnknownHouseLoadW = exports.pruneOldDays = exports.resolveSlotPeriods = exports.sumDaysForPrefix = exports.skipPowerIntegrationGap = exports.applyPowerIntegrationSample = exports.applyEnergyStateSample = exports.padSlotIndex = exports.round1 = exports.round3 = void 0;
/**
 * Reine Rechenlogik für den messenden Verbraucherblock.
 * Keine I/O, keine State-IDs — nur Energie-Akkumulation, Zählerreset-Erkennung
 * und Periodensummen. Wiederverwendet den bestehenden Reset-Erkennungsbaustein
 * aus der Statistik (`energyCounterDeltaKwh`) statt eine Parallellogik zu bauen.
 */
const compute_1 = require("../../statistics/compute");
function round3(n) {
    return Math.round(n * 1000) / 1000;
}
exports.round3 = round3;
function round1(n) {
    return Math.round(n * 10) / 10;
}
exports.round1 = round1;
function padSlotIndex(index) {
    return String(index).padStart(2, "0");
}
exports.padSlotIndex = padSlotIndex;
function addDayDelta(slot, dateKey, deltaKwh) {
    if (!(deltaKwh > 0))
        return;
    if (!slot.days || typeof slot.days !== "object") {
        slot.days = {};
    }
    slot.days[dateKey] = round3((slot.days[dateKey] ?? 0) + deltaKwh);
}
/**
 * Fall A: kumulativer Energiezähler vorhanden.
 * - Erstes Sample: übernimmt initialEnergyKwh als gewünschten EMS-Gesamtstand
 *   (bzw. den Rohzähler direkt, wenn kein Startwert vorgegeben ist) — kein Tagesverbrauch.
 * - Danach: nur das Delta zum vorherigen Rohwert wird zu total + days addiert.
 * - Sub-Schwellwert-Inkremente (round3 → 0, z. B. < 0.0005 kWh): Baseline NICHT
 *   fortschreiben, sonst gehen viele winzige Zähler-Updates verloren und today bleibt 0.
 * - Zählerreset (neuer Rohwert deutlich kleiner): nur Basis neu, kein Phantomverbrauch.
 */
function applyEnergyStateSample(slot, rawKwh, initialEnergyKwh, dateKey) {
    if (!slot.days || typeof slot.days !== "object") {
        slot.days = {};
    }
    if (!slot.initialized) {
        slot.totalKwh = round3(initialEnergyKwh !== null ? initialEnergyKwh : rawKwh);
        slot.rawEnergyBaselineKwh = rawKwh;
        slot.initialized = true;
        return;
    }
    const previous = slot.rawEnergyBaselineKwh;
    const d = (0, compute_1.energyCounterDeltaKwh)(previous, rawKwh);
    if (d.deltaKwh !== null && d.deltaKwh > 0) {
        slot.totalKwh = round3(slot.totalKwh + d.deltaKwh);
        addDayDelta(slot, dateKey, d.deltaKwh);
        slot.rawEnergyBaselineKwh = d.newBaseline;
        return;
    }
    /*
     * Reset: Rohwert deutlich kleiner → Basis übernehmen, keinen Verbrauch buchen.
     * Gleicher Stand oder sub-threshold-Zuwachs: Baseline unverändert lassen, damit
     * sich winzige Inkremente bis zur nächsten sichtbaren 0.001-kWh-Stufe aufsummieren.
     */
    if (previous !== null && rawKwh + 0.05 < previous) {
        slot.rawEnergyBaselineKwh = rawKwh;
    }
}
exports.applyEnergyStateSample = applyEnergyStateSample;
/**
 * Fall B: kein Energiezähler — Integration aus Leistung × echter Zeitdifferenz.
 * - Erstes Sample: nur Zeitbasis setzen (+ initialEnergyKwh übernehmen), kein Delta.
 * - Lücken über `maxDtSec` (z. B. Adapter-Neustart) werden NICHT nachintegriert.
 */
function applyPowerIntegrationSample(slot, powerW, nowMs, initialEnergyKwh, dateKey, maxDtSec) {
    if (!slot.initialized) {
        slot.totalKwh = round3(initialEnergyKwh ?? 0);
        slot.initialized = true;
        slot.lastPowerTsMs = nowMs;
        return;
    }
    if (slot.lastPowerTsMs === null) {
        slot.lastPowerTsMs = nowMs;
        return;
    }
    const dtSec = (nowMs - slot.lastPowerTsMs) / 1000;
    slot.lastPowerTsMs = nowMs;
    if (!(dtSec > 0) || dtSec > maxDtSec)
        return;
    if (!(powerW >= 0))
        return;
    const deltaKwh = (powerW * dtSec) / 3_600_000;
    if (!(deltaKwh > 0))
        return;
    slot.totalKwh = round3(slot.totalKwh + deltaKwh);
    addDayDelta(slot, dateKey, deltaKwh);
}
exports.applyPowerIntegrationSample = applyPowerIntegrationSample;
/** Überspringt eine Lücke (ungültiges Sample) ohne Energie zu addieren; verhindert Phantomsprünge danach. */
function skipPowerIntegrationGap(slot, nowMs) {
    if (slot.initialized) {
        slot.lastPowerTsMs = nowMs;
    }
}
exports.skipPowerIntegrationGap = skipPowerIntegrationGap;
function sumDaysForPrefix(days, prefix) {
    let sum = 0;
    for (const [k, v] of Object.entries(days)) {
        if (k.startsWith(prefix))
            sum += v;
    }
    return round3(sum);
}
exports.sumDaysForPrefix = sumDaysForPrefix;
function resolveSlotPeriods(slot, todayKey, yesterdayKey) {
    const monthPrefix = todayKey.slice(0, 7);
    const yearPrefix = todayKey.slice(0, 4);
    return {
        totalKwh: slot.totalKwh,
        todayKwh: slot.days[todayKey] ?? 0,
        yesterdayKwh: slot.days[yesterdayKey] ?? 0,
        monthKwh: sumDaysForPrefix(slot.days, monthPrefix),
        yearKwh: sumDaysForPrefix(slot.days, yearPrefix),
    };
}
exports.resolveSlotPeriods = resolveSlotPeriods;
/** Entfernt Tages-Einträge älter als `retentionDays` relativ zu `todayDateKey` (kappt Dateiwachstum). */
function pruneOldDays(days, todayDateKey, retentionDays) {
    const todayMs = Date.parse(`${todayDateKey}T00:00:00Z`);
    if (!Number.isFinite(todayMs))
        return days;
    const cutoffMs = todayMs - retentionDays * 86_400_000;
    const out = {};
    for (const [k, v] of Object.entries(days)) {
        const ms = Date.parse(`${k}T00:00:00Z`);
        if (!Number.isFinite(ms) || ms >= cutoffMs) {
            out[k] = v;
        }
    }
    return out;
}
exports.pruneOldDays = pruneOldDays;
/**
 * Unbekannte Restlast = Hausverbrauch minus Summe der gemessenen (aktiven, gültigen)
 * Verbraucher — niemals negativ, niemals Addition zum Hausverbrauch.
 */
function computeUnknownHouseLoadW(houseLoadW, measuredTotalW) {
    if (houseLoadW === null || !Number.isFinite(houseLoadW))
        return null;
    return Math.max(0, round1(houseLoadW - measuredTotalW));
}
exports.computeUnknownHouseLoadW = computeUnknownHouseLoadW;
