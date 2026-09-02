"use strict";
/**
 * Grid-Balance-Episoden + stabile GB-aus-Fenster.
 * Stabilität nur fürs Learning — keine feste Einschwing-Minutenlogik.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.advanceOffWindow = exports.advanceGridBalanceEpisode = exports.closeOffWindow = exports.closeGridBalanceEpisode = void 0;
const constants_1 = require("../grid_balance_economics/constants");
const stability_1 = require("../grid_balance_economics/stability");
function kwhFromW(w, dtSec) {
    if (w == null || !Number.isFinite(w) || !(dtSec > 0))
        return 0;
    return (Math.max(0, w) * dtSec) / 3_600_000;
}
function mean(sum, weight) {
    return weight > 0 ? sum / weight : null;
}
function capList(list, max) {
    return list.length <= max ? list : list.slice(list.length - max);
}
function closeGridBalanceEpisode(open, endTs, abortReason, list) {
    if (!open || endTs <= open.startTs)
        return list;
    const durationSec = Math.max(0, (endTs - open.startTs) / 1000);
    if (!(durationSec > 1))
        return list;
    const usable = open.stableDurationSec >= constants_1.MIN_STABLE_PHASE_SEC &&
        open.effectiveEnergyKwh >= constants_1.MIN_GB_ENERGY_KWH &&
        open.haveStableImport &&
        open.haveStableDischarge;
    const seg = {
        startTs: open.startTs,
        endTs,
        durationSec,
        requestedEnergyKwh: open.requestedEnergyKwh,
        effectiveEnergyKwh: open.effectiveEnergyKwh,
        stableImportKwh: open.haveStableImport ? open.stableImportKwh : null,
        stableBatteryDischargeKwh: open.haveStableDischarge ? open.stableDischargeKwh : null,
        socStartPct: open.socStartPct,
        socEndPct: open.socEndPct,
        priceMinCt: open.priceMinCt,
        priceMaxCt: open.priceMaxCt,
        stableDurationSec: open.stableDurationSec,
        unstableDurationSec: open.unstableDurationSec,
        stableHouseMeanW: mean(open.stableHouseWSec, open.stableWeightSec),
        stablePvMeanW: mean(open.stablePvWSec, open.stableWeightSec),
        stableGbMeanW: mean(open.stableGbWSec, open.stableWeightSec),
        stableDeficitMeanW: mean(open.stableDeficitWSec, open.stableWeightSec),
        abortReason,
        usable,
        qualityReason: usable
            ? null
            : open.stableDurationSec < constants_1.MIN_STABLE_PHASE_SEC
                ? "stable_phase_too_short"
                : "insufficient_stable_energy_or_meters",
    };
    return capList([...list, seg], constants_1.MAX_GB_SEGMENTS_PER_DAY);
}
exports.closeGridBalanceEpisode = closeGridBalanceEpisode;
function closeOffWindow(open, endTs, list) {
    if (!open || endTs <= open.startTs)
        return list;
    const durationSec = Math.max(0, (endTs - open.startTs) / 1000);
    if (durationSec < constants_1.MIN_STABLE_PHASE_SEC)
        return list;
    const w = {
        startTs: open.startTs,
        endTs,
        durationSec,
        importKwh: open.haveImport ? open.importKwh : null,
        batteryDischargeKwh: open.haveDischarge ? open.dischargeKwh : null,
        houseMeanW: mean(open.houseWSec, open.weightSec),
        pvMeanW: mean(open.pvWSec, open.weightSec),
        deficitMeanW: mean(open.deficitWSec, open.weightSec),
        socMeanPct: open.weightSec > 0 && open.socSec > 0 ? open.socSum / open.socSec : null,
        priceMeanCt: open.weightSec > 0 && open.priceSec > 0 ? open.priceSum / open.priceSec : null,
        usable: open.haveImport && open.haveDischarge,
    };
    if (!w.usable)
        return list;
    return capList([...list, w], constants_1.MAX_OFF_WINDOWS_PER_DAY);
}
exports.closeOffWindow = closeOffWindow;
function advanceGridBalanceEpisode(open, stabilityBuf, sample, prevTs, list) {
    const buf = (0, stability_1.pushStabilitySample)(stabilityBuf, sample, constants_1.STABILITY_MIN_SAMPLES + 2);
    const dtSec = prevTs != null && sample.ts > prevTs ? (sample.ts - prevTs) / 1000 : 0;
    const active = sample.gbActive || (sample.gbEffectiveW != null && sample.gbEffectiveW > 10);
    if (!active) {
        return {
            open: null,
            buf,
            list: closeGridBalanceEpisode(open, sample.ts, "gb_inactive", list),
        };
    }
    const stable = (0, stability_1.isStabilityWindowStable)(buf);
    const reqKwh = kwhFromW(sample.gbRequestedW, dtSec);
    const effKwh = kwhFromW(sample.gbEffectiveW, dtSec);
    const impKwh = kwhFromW(sample.gridImportW, dtSec);
    const disKwh = kwhFromW(sample.batteryDischargeW, dtSec);
    const house = sample.houseW ?? 0;
    const pv = sample.pvW ?? 0;
    const deficit = Math.max(0, house - pv);
    if (!open) {
        return {
            open: {
                startTs: sample.ts,
                lastTs: sample.ts,
                requestedEnergyKwh: reqKwh,
                effectiveEnergyKwh: effKwh,
                socStartPct: sample.socPct,
                socEndPct: sample.socPct,
                priceMinCt: sample.priceCt,
                priceMaxCt: sample.priceCt,
                stableDurationSec: 0,
                unstableDurationSec: 0,
                stableImportKwh: 0,
                stableDischargeKwh: 0,
                haveStableImport: false,
                haveStableDischarge: false,
                stableHouseWSec: 0,
                stablePvWSec: 0,
                stableGbWSec: 0,
                stableDeficitWSec: 0,
                stableWeightSec: 0,
                stableStreakSec: 0,
            },
            buf,
            list,
        };
    }
    const next = {
        ...open,
        lastTs: sample.ts,
        requestedEnergyKwh: open.requestedEnergyKwh + reqKwh,
        effectiveEnergyKwh: open.effectiveEnergyKwh + effKwh,
        socEndPct: sample.socPct ?? open.socEndPct,
        priceMinCt: sample.priceCt != null
            ? open.priceMinCt == null
                ? sample.priceCt
                : Math.min(open.priceMinCt, sample.priceCt)
            : open.priceMinCt,
        priceMaxCt: sample.priceCt != null
            ? open.priceMaxCt == null
                ? sample.priceCt
                : Math.max(open.priceMaxCt, sample.priceCt)
            : open.priceMaxCt,
        stableDurationSec: open.stableDurationSec,
        unstableDurationSec: open.unstableDurationSec,
        stableStreakSec: stable ? open.stableStreakSec + dtSec : 0,
    };
    if (stable && dtSec > 0) {
        next.stableDurationSec += dtSec;
        if (sample.gridImportW != null) {
            next.stableImportKwh += impKwh;
            next.haveStableImport = true;
        }
        if (sample.batteryDischargeW != null) {
            next.stableDischargeKwh += disKwh;
            next.haveStableDischarge = true;
        }
        if (sample.houseW != null)
            next.stableHouseWSec += sample.houseW * dtSec;
        if (sample.pvW != null)
            next.stablePvWSec += sample.pvW * dtSec;
        if (sample.gbEffectiveW != null)
            next.stableGbWSec += sample.gbEffectiveW * dtSec;
        next.stableDeficitWSec += deficit * dtSec;
        next.stableWeightSec += dtSec;
    }
    else if (dtSec > 0) {
        next.unstableDurationSec += dtSec;
    }
    return { open: next, buf, list };
}
exports.advanceGridBalanceEpisode = advanceGridBalanceEpisode;
function advanceOffWindow(open, stabilityBuf, sample, prevTs, list) {
    const dtSec = prevTs != null && sample.ts > prevTs ? (sample.ts - prevTs) / 1000 : 0;
    const gbOn = sample.gbActive || (sample.gbEffectiveW != null && sample.gbEffectiveW > 10);
    const discharging = sample.batteryDischargeW != null && sample.batteryDischargeW > 20;
    const stable = (0, stability_1.isStabilityWindowStable)(stabilityBuf);
    const candidate = !gbOn && discharging && stable;
    if (!candidate) {
        return { open: null, list: closeOffWindow(open, sample.ts, list) };
    }
    const house = sample.houseW ?? 0;
    const pv = sample.pvW ?? 0;
    if (!open) {
        return {
            open: {
                startTs: sample.ts,
                lastTs: sample.ts,
                durationSec: 0,
                importKwh: 0,
                dischargeKwh: 0,
                haveImport: false,
                haveDischarge: false,
                houseWSec: 0,
                pvWSec: 0,
                deficitWSec: 0,
                socSec: 0,
                priceSec: 0,
                weightSec: 0,
                socSum: 0,
                priceSum: 0,
            },
            list,
        };
    }
    const next = {
        ...open,
        lastTs: sample.ts,
        durationSec: open.durationSec + dtSec,
        importKwh: open.importKwh + kwhFromW(sample.gridImportW, dtSec),
        dischargeKwh: open.dischargeKwh + kwhFromW(sample.batteryDischargeW, dtSec),
        haveImport: open.haveImport || sample.gridImportW != null,
        haveDischarge: open.haveDischarge || sample.batteryDischargeW != null,
        houseWSec: open.houseWSec + (sample.houseW ?? 0) * dtSec,
        pvWSec: open.pvWSec + (sample.pvW ?? 0) * dtSec,
        deficitWSec: open.deficitWSec + Math.max(0, house - pv) * dtSec,
        weightSec: open.weightSec + dtSec,
        socSec: open.socSec + (sample.socPct != null ? dtSec : 0),
        priceSec: open.priceSec + (sample.priceCt != null ? dtSec : 0),
        socSum: open.socSum + (sample.socPct != null ? sample.socPct * dtSec : 0),
        priceSum: open.priceSum + (sample.priceCt != null ? sample.priceCt * dtSec : 0),
    };
    return { open: next, list };
}
exports.advanceOffWindow = advanceOffWindow;
