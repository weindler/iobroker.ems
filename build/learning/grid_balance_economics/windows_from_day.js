"use strict";
/**
 * Vergleichsfenster aus Day-Telemetry: primär GB-Episoden / Off-Windows,
 * ergänzend 15-Min-Slots (niedrigere Quelle, mehr Samples nötig).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectMatchWindows = exports.matchWindowsFromSlots = exports.matchWindowsFromOffWindow = exports.matchWindowsFromEpisode = void 0;
const constants_1 = require("./constants");
function slotHours(day) {
    return day.slotWidthMs > 0 ? day.slotWidthMs / 3_600_000 : 0.25;
}
function matchWindowsFromEpisode(seg) {
    if (!seg.usable)
        return null;
    if (!(seg.stableDurationSec >= constants_1.MIN_STABLE_PHASE_SEC))
        return null;
    if (!(seg.effectiveEnergyKwh >= constants_1.MIN_GB_ENERGY_KWH))
        return null;
    if (seg.stableImportKwh == null || seg.stableBatteryDischargeKwh == null)
        return null;
    return {
        startTs: seg.startTs,
        durationSec: seg.stableDurationSec,
        gbOn: true,
        eGbKwh: seg.effectiveEnergyKwh,
        importKwh: seg.stableImportKwh,
        batteryDischargeKwh: seg.stableBatteryDischargeKwh,
        houseMeanW: seg.stableHouseMeanW,
        pvMeanW: seg.stablePvMeanW,
        deficitMeanW: seg.stableDeficitMeanW,
        socMeanPct: seg.socStartPct,
        source: "episode",
    };
}
exports.matchWindowsFromEpisode = matchWindowsFromEpisode;
function matchWindowsFromOffWindow(w) {
    if (!w.usable)
        return null;
    if (!(w.durationSec >= constants_1.MIN_STABLE_PHASE_SEC))
        return null;
    if (w.importKwh == null || w.batteryDischargeKwh == null)
        return null;
    return {
        startTs: w.startTs,
        durationSec: w.durationSec,
        gbOn: false,
        eGbKwh: 0,
        importKwh: w.importKwh,
        batteryDischargeKwh: w.batteryDischargeKwh,
        houseMeanW: w.houseMeanW,
        pvMeanW: w.pvMeanW,
        deficitMeanW: w.deficitMeanW,
        socMeanPct: w.socMeanPct,
        source: "episode",
    };
}
exports.matchWindowsFromOffWindow = matchWindowsFromOffWindow;
function matchWindowsFromSlots(day) {
    const b = day.buckets;
    const hours = slotHours(day);
    const sec = hours * 3600;
    const out = [];
    for (let i = 0; i < day.slotCount; i++) {
        const house = b.houseTotalKwh[i];
        const pv = b.pvKwh[i];
        const gi = b.gridImportKwh[i];
        const bd = b.batteryDischargedKwh[i];
        const gb = b.gridBalanceDischargeKwh[i];
        const soc = b.batterySocEndPct[i];
        if (house == null || gi == null || bd == null)
            continue;
        const houseW = house / hours;
        const pvW = pv != null ? pv / hours : null;
        const deficitW = pvW != null ? Math.max(0, houseW - pvW) : houseW;
        const eGb = gb != null && gb > 0 ? gb : 0;
        out.push({
            startTs: day.startMs + i * day.slotWidthMs,
            durationSec: sec,
            gbOn: eGb >= constants_1.MIN_GB_ENERGY_KWH,
            eGbKwh: eGb,
            importKwh: gi,
            batteryDischargeKwh: bd,
            houseMeanW: houseW,
            pvMeanW: pvW,
            deficitMeanW: deficitW,
            socMeanPct: soc,
            source: "slot",
        });
    }
    return out;
}
exports.matchWindowsFromSlots = matchWindowsFromSlots;
function collectMatchWindows(day) {
    const out = [];
    for (const seg of day.gridBalanceRunSegments ?? []) {
        const w = matchWindowsFromEpisode(seg);
        if (w)
            out.push(w);
    }
    for (const off of day.gridBalanceOffWindows ?? []) {
        const w = matchWindowsFromOffWindow(off);
        if (w)
            out.push(w);
    }
    if (out.filter((w) => w.gbOn).length < 4 || out.filter((w) => !w.gbOn).length < 4) {
        out.push(...matchWindowsFromSlots(day));
    }
    return out;
}
exports.collectMatchWindows = collectMatchWindows;
