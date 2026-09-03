"use strict";
/**
 * Empirisches Climate-Thermal-Learning aus Day-Telemetry.
 * Keine physikalischen Konstanten, keine erfundenen 0-Werte, keine Steuerung.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.thermalTestSegment = exports.computeClimateThermalModels = exports.computeClimateThermalUnitModel = exports.collectInertiaSamples = exports.collectDehumidifyHumiditySamples = exports.collectActiveTempSamples = exports.collectPassiveTempSamples = exports.trimOutliersIqr = exports.CLIMATE_THERMAL_FRESHNESS_ZERO_DAYS = exports.CLIMATE_THERMAL_FRESHNESS_FULL_DAYS = exports.CLIMATE_THERMAL_MAX_IQR_RH_PER_H = exports.CLIMATE_THERMAL_MAX_IQR_TEMP_K_PER_H = exports.CLIMATE_THERMAL_MIN_CONFIDENCE_USABLE = exports.CLIMATE_THERMAL_TARGET_SAMPLES = exports.CLIMATE_THERMAL_MIN_SAMPLES = exports.CLIMATE_THERMAL_MAX_JUMP_RH = exports.CLIMATE_THERMAL_MAX_JUMP_K = exports.CLIMATE_THERMAL_SLOT_GAP_MAX_SEC = exports.CLIMATE_THERMAL_SLOT_GAP_MIN_SEC = exports.CLIMATE_THERMAL_INERTIA_MAX_SEC = exports.CLIMATE_THERMAL_INERTIA_MIN_SEC = exports.CLIMATE_THERMAL_MIN_ACTIVE_SEC = exports.CLIMATE_THERMAL_MIN_PASSIVE_SEC = void 0;
const constants_1 = require("../day_telemetry/constants");
const climate_unit_slots_1 = require("../day_telemetry/climate_unit_slots");
const types_1 = require("./types");
/** Passive Abschnitte: mindestens 30 Minuten zusammenhängend. */
exports.CLIMATE_THERMAL_MIN_PASSIVE_SEC = 1800;
/** Aktive Segmente: mindestens 15 Minuten. */
exports.CLIMATE_THERMAL_MIN_ACTIVE_SEC = 900;
/** Trägheit: 20–90 Minuten nach Climate-Ende. */
exports.CLIMATE_THERMAL_INERTIA_MIN_SEC = 1200;
exports.CLIMATE_THERMAL_INERTIA_MAX_SEC = 5400;
/** Slot-Abstand für passive Ketten. */
exports.CLIMATE_THERMAL_SLOT_GAP_MIN_SEC = 300;
exports.CLIMATE_THERMAL_SLOT_GAP_MAX_SEC = 2100;
/** Offensichtlicher Messsprung in 15 Min. */
exports.CLIMATE_THERMAL_MAX_JUMP_K = 4;
exports.CLIMATE_THERMAL_MAX_JUMP_RH = 15;
/** Konservative Freigabe — nicht nach 2–3 Samples. */
exports.CLIMATE_THERMAL_MIN_SAMPLES = 8;
exports.CLIMATE_THERMAL_TARGET_SAMPLES = 24;
exports.CLIMATE_THERMAL_MIN_CONFIDENCE_USABLE = 0.45;
exports.CLIMATE_THERMAL_MAX_IQR_TEMP_K_PER_H = 1.5;
exports.CLIMATE_THERMAL_MAX_IQR_RH_PER_H = 8;
exports.CLIMATE_THERMAL_FRESHNESS_FULL_DAYS = 30;
exports.CLIMATE_THERMAL_FRESHNESS_ZERO_DAYS = 90;
function quantile(sortedAsc, q) {
    if (sortedAsc.length === 0)
        return 0;
    if (sortedAsc.length === 1)
        return sortedAsc[0];
    const pos = (sortedAsc.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (base + 1 < sortedAsc.length) {
        return sortedAsc[base] + rest * (sortedAsc[base + 1] - sortedAsc[base]);
    }
    return sortedAsc[base];
}
function trimOutliersIqr(values) {
    if (values.length < 4)
        return values;
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const iqr = q3 - q1;
    if (!(iqr > 0))
        return values;
    const lo = q1 - 1.5 * iqr;
    const hi = q3 + 1.5 * iqr;
    const kept = values.filter((v) => v >= lo && v <= hi);
    return kept.length > 0 ? kept : values;
}
exports.trimOutliersIqr = trimOutliersIqr;
function median(values) {
    if (values.length === 0)
        return null;
    const sorted = [...values].sort((a, b) => a - b);
    return quantile(sorted, 0.5);
}
function round3(n) {
    return Math.round(n * 1000) / 1000;
}
function confidenceFrom(sampleCount, ageDays, spreadFactor) {
    if (sampleCount <= 0)
        return 0;
    const sampleFactor = sampleCount < exports.CLIMATE_THERMAL_MIN_SAMPLES
        ? (sampleCount / exports.CLIMATE_THERMAL_MIN_SAMPLES) * 0.35
        : Math.min(1, sampleCount / exports.CLIMATE_THERMAL_TARGET_SAMPLES);
    let freshness = 1;
    if (ageDays != null && ageDays > exports.CLIMATE_THERMAL_FRESHNESS_FULL_DAYS) {
        const span = exports.CLIMATE_THERMAL_FRESHNESS_ZERO_DAYS - exports.CLIMATE_THERMAL_FRESHNESS_FULL_DAYS;
        freshness = Math.max(0, 1 - (ageDays - exports.CLIMATE_THERMAL_FRESHNESS_FULL_DAYS) / span);
    }
    return Math.round(sampleFactor * freshness * spreadFactor * 100) / 100;
}
function finishEffect(samples, nowMs, kind, unavailable, unavailableReason, notEnoughReason) {
    const lastRunIso = new Date(nowMs).toISOString();
    if (unavailable) {
        return (0, types_1.emptyEffectStat)("unavailable", unavailableReason, lastRunIso);
    }
    const auto = samples.filter((s) => !s.override);
    if (auto.length === 0) {
        return (0, types_1.emptyEffectStat)("not_evaluable", notEnoughReason, lastRunIso);
    }
    const trimmed = trimOutliersIqr(auto.map((s) => s.rate));
    const rates = trimmed;
    const sampleCount = rates.length;
    const usableDurationSec = auto.reduce((a, s) => a + s.durationSec, 0);
    const lastTs = auto.reduce((m, s) => Math.max(m, s.endTs), 0);
    const ageDays = lastTs > 0 ? Math.max(0, Math.round((nowMs - lastTs) / 86_400_000)) : null;
    const sorted = [...rates].sort((a, b) => a - b);
    const iqr = sampleCount > 0 ? quantile(sorted, 0.75) - quantile(sorted, 0.25) : null;
    const maxIqr = kind === "temp" ? exports.CLIMATE_THERMAL_MAX_IQR_TEMP_K_PER_H : exports.CLIMATE_THERMAL_MAX_IQR_RH_PER_H;
    const spreadWide = iqr != null && iqr > maxIqr;
    const spreadFactor = spreadWide ? 0.55 : 1;
    const confidence = confidenceFrom(sampleCount, ageDays, spreadFactor);
    const rate = median(rates);
    const usable = sampleCount >= exports.CLIMATE_THERMAL_MIN_SAMPLES &&
        confidence >= exports.CLIMATE_THERMAL_MIN_CONFIDENCE_USABLE &&
        !spreadWide &&
        rate != null;
    let status = "not_evaluable";
    let reasonDe = notEnoughReason;
    if (usable) {
        status = "ok";
        reasonDe = `${sampleCount} belastbare Samples, Rate ${round3(rate)} /h.`;
    }
    else if (sampleCount >= exports.CLIMATE_THERMAL_MIN_SAMPLES && spreadWide) {
        reasonDe = `Zu große Streuung (IQR ${round3(iqr)} /h) — nicht usable.`;
    }
    else if (sampleCount > 0) {
        reasonDe = `Zu wenig Samples (${sampleCount}/${exports.CLIMATE_THERMAL_MIN_SAMPLES}) — nicht usable.`;
    }
    return {
        sampleCount,
        usableDurationSec,
        rate: rate != null ? round3(rate) : null,
        spread: iqr != null ? round3(iqr) : null,
        confidence,
        usable,
        status,
        reasonDe,
        lastRunIso,
        soloSampleCount: auto.filter((s) => s.solo).length,
        sharedSampleCount: auto.filter((s) => !s.solo).length,
    };
}
function comboSolo(combo) {
    if (!combo || combo === "none")
        return true;
    return !combo.includes("+");
}
function slotAt(day, index) {
    const slots = day.buckets.climateUnitSlots;
    if (!Array.isArray(slots) || index < 0 || index >= slots.length)
        return null;
    return slots[index];
}
function unitInSlot(slots, unitIndex) {
    if (!slots)
        return null;
    return slots.find((s) => s.unitIndex === unitIndex) ?? null;
}
function plausibleJump(prev, next, maxAbs) {
    return Math.abs(next - prev) <= maxAbs;
}
function collectPassiveTempSamples(days, unitIndex) {
    const out = [];
    for (const day of days) {
        const n = day.slotCount;
        let i = 0;
        while (i < n) {
            const first = unitInSlot(slotAt(day, i), unitIndex);
            if (!first ||
                first.running !== false ||
                first.roomTempC == null ||
                first.modePurpose === "cooling" ||
                first.modePurpose === "heating" ||
                first.modePurpose === "dehumidify") {
                i += 1;
                continue;
            }
            let last = first;
            let lastIdx = i;
            let override = first.overrideActive === true;
            let outdoorSum = first.roomTempC != null && day.buckets.outdoorTempC?.[i] != null ? 1 : 0;
            let outdoorAcc = day.buckets.outdoorTempC?.[i] ?? 0;
            let rejected = false;
            let j = i + 1;
            for (; j < n; j++) {
                const cur = unitInSlot(slotAt(day, j), unitIndex);
                if (!cur ||
                    cur.running !== false ||
                    cur.roomTempC == null ||
                    cur.modePurpose === "cooling" ||
                    cur.modePurpose === "heating" ||
                    cur.modePurpose === "dehumidify") {
                    break;
                }
                const dtSec = ((day.startMs + j * constants_1.DAY_TELEMETRY_SLOT_MS) - (day.startMs + lastIdx * constants_1.DAY_TELEMETRY_SLOT_MS)) / 1000;
                if (dtSec < exports.CLIMATE_THERMAL_SLOT_GAP_MIN_SEC || dtSec > exports.CLIMATE_THERMAL_SLOT_GAP_MAX_SEC) {
                    break;
                }
                if (!plausibleJump(last.roomTempC, cur.roomTempC, exports.CLIMATE_THERMAL_MAX_JUMP_K)) {
                    rejected = true;
                    break;
                }
                if (cur.overrideActive === true)
                    override = true;
                const outC = day.buckets.outdoorTempC?.[j];
                if (outC != null) {
                    outdoorSum += 1;
                    outdoorAcc += outC;
                }
                last = cur;
                lastIdx = j;
            }
            const durationSec = ((lastIdx - i) * constants_1.DAY_TELEMETRY_SLOT_MS) / 1000;
            if (!rejected && durationSec >= exports.CLIMATE_THERMAL_MIN_PASSIVE_SEC && last.roomTempC != null && first.roomTempC != null) {
                const hours = durationSec / 3600;
                if (hours > 0) {
                    out.push({
                        rate: (last.roomTempC - first.roomTempC) / hours,
                        durationSec,
                        endTs: day.startMs + (lastIdx + 1) * constants_1.DAY_TELEMETRY_SLOT_MS,
                        solo: true,
                        outdoorMeanC: outdoorSum > 0 ? outdoorAcc / outdoorSum : null,
                        override,
                    });
                }
            }
            i = Math.max(j, i + 1);
        }
    }
    return out;
}
exports.collectPassiveTempSamples = collectPassiveTempSamples;
function segmentModePurpose(mode) {
    return (0, climate_unit_slots_1.normalizeClimateModePurpose)(mode);
}
function collectActiveTempSamples(days, unitIndex, purpose) {
    const out = [];
    for (const day of days) {
        for (const seg of day.climateRunSegments ?? []) {
            if (segmentModePurpose(seg.mode) !== purpose)
                continue;
            if (seg.activeUnitCombination === "none")
                continue;
            if (seg.runtimeSec < exports.CLIMATE_THERMAL_MIN_ACTIVE_SEC)
                continue;
            const obs = (seg.unitObservations ?? []).find((o) => o.unitIndex === unitIndex);
            if (!obs || obs.roomTempStartC == null || obs.roomTempEndC == null)
                continue;
            const hours = seg.runtimeSec / 3600;
            if (!(hours > 0))
                continue;
            const dT = obs.roomTempEndC - obs.roomTempStartC;
            if (Math.abs(dT) / Math.max(hours, 0.25) > (exports.CLIMATE_THERMAL_MAX_JUMP_K * 4)) {
                /* extremer Sprung über die Segmentlänge — nicht als Wirkung werten */
                continue;
            }
            out.push({
                rate: dT / hours,
                durationSec: seg.runtimeSec,
                endTs: seg.endTs,
                solo: comboSolo(seg.activeUnitCombination),
                outdoorMeanC: seg.outdoorTempStartC != null && seg.outdoorTempEndC != null
                    ? (seg.outdoorTempStartC + seg.outdoorTempEndC) / 2
                    : (seg.outdoorTempStartC ?? seg.outdoorTempEndC ?? null),
                override: obs.overrideActive === true || seg.overrideActive === true,
            });
        }
    }
    return out;
}
exports.collectActiveTempSamples = collectActiveTempSamples;
function collectDehumidifyHumiditySamples(days, unitIndex) {
    const out = [];
    for (const day of days) {
        for (const seg of day.climateRunSegments ?? []) {
            if (segmentModePurpose(seg.mode) !== "dehumidify")
                continue;
            if (seg.runtimeSec < exports.CLIMATE_THERMAL_MIN_ACTIVE_SEC)
                continue;
            const obs = (seg.unitObservations ?? []).find((o) => o.unitIndex === unitIndex);
            if (!obs || obs.roomHumidityStartPct == null || obs.roomHumidityEndPct == null)
                continue;
            const hours = seg.runtimeSec / 3600;
            if (!(hours > 0))
                continue;
            const dH = obs.roomHumidityEndPct - obs.roomHumidityStartPct;
            if (Math.abs(dH) / Math.max(hours, 0.25) > exports.CLIMATE_THERMAL_MAX_JUMP_RH * 4)
                continue;
            out.push({
                rate: dH / hours,
                durationSec: seg.runtimeSec,
                endTs: seg.endTs,
                solo: comboSolo(seg.activeUnitCombination),
                outdoorMeanC: null,
                override: obs.overrideActive === true || seg.overrideActive === true,
            });
        }
    }
    return out;
}
exports.collectDehumidifyHumiditySamples = collectDehumidifyHumiditySamples;
/**
 * Residualrate in der ersten Stunde nach einem aktiven Segment — nur wenn messbar.
 * Keine erzwungene Zeitkonstante.
 */
function collectInertiaSamples(days, unitIndex) {
    const out = [];
    for (const day of days) {
        const segs = (day.climateRunSegments ?? []).filter((s) => {
            const p = segmentModePurpose(s.mode);
            return (p === "cooling" || p === "heating" || p === "dehumidify") && s.runtimeSec >= exports.CLIMATE_THERMAL_MIN_ACTIVE_SEC;
        });
        for (const seg of segs) {
            const obs = (seg.unitObservations ?? []).find((o) => o.unitIndex === unitIndex);
            const startTemp = obs?.roomTempEndC;
            if (startTemp == null)
                continue;
            const startSlot = Math.floor((seg.endTs - day.startMs) / constants_1.DAY_TELEMETRY_SLOT_MS);
            if (startSlot < 0 || startSlot >= day.slotCount)
                continue;
            let endSlot = -1;
            let endTemp = null;
            let override = obs?.overrideActive === true || seg.overrideActive === true;
            for (let i = startSlot; i < day.slotCount; i++) {
                const elapsed = ((i - startSlot) * constants_1.DAY_TELEMETRY_SLOT_MS) / 1000;
                if (elapsed > exports.CLIMATE_THERMAL_INERTIA_MAX_SEC)
                    break;
                const cur = unitInSlot(slotAt(day, i), unitIndex);
                if (!cur || cur.running === true)
                    break;
                if (cur.roomTempC == null)
                    continue;
                if (elapsed >= exports.CLIMATE_THERMAL_INERTIA_MIN_SEC) {
                    endSlot = i;
                    endTemp = cur.roomTempC;
                    if (cur.overrideActive === true)
                        override = true;
                }
            }
            if (endSlot < 0 || endTemp == null)
                continue;
            const durationSec = ((endSlot - startSlot) * constants_1.DAY_TELEMETRY_SLOT_MS) / 1000;
            if (durationSec < exports.CLIMATE_THERMAL_INERTIA_MIN_SEC)
                continue;
            const hours = durationSec / 3600;
            if (!(hours > 0))
                continue;
            if (!plausibleJump(startTemp, endTemp, exports.CLIMATE_THERMAL_MAX_JUMP_K * 3))
                continue;
            out.push({
                rate: (endTemp - startTemp) / hours,
                durationSec,
                endTs: day.startMs + (endSlot + 1) * constants_1.DAY_TELEMETRY_SLOT_MS,
                solo: comboSolo(seg.activeUnitCombination),
                outdoorMeanC: null,
                override,
            });
        }
    }
    return out;
}
exports.collectInertiaSamples = collectInertiaSamples;
function finishPassive(samples, nowMs) {
    const base = finishEffect(samples, nowMs, "temp", false, "", "Passive Raumdynamik noch nicht auswertbar (zu wenig Climate-AUS-Abschnitte).");
    const auto = samples.filter((s) => !s.override);
    const warming = median(auto.filter((s) => s.rate > 0).map((s) => s.rate));
    const cooling = median(auto.filter((s) => s.rate < 0).map((s) => s.rate));
    return {
        ...base,
        warmingRateKPerH: warming != null ? round3(warming) : null,
        coolingRateKPerH: cooling != null ? round3(cooling) : null,
    };
}
function computeClimateThermalUnitModel(days, availability, nowMs) {
    const unitIndex = availability.unitIndex;
    const lastRunIso = new Date(nowMs).toISOString();
    const hasCooling = availability.modesAvailable.includes("cooling");
    const hasHeating = availability.modesAvailable.includes("heating");
    const hasDry = availability.modesAvailable.includes("dehumidify");
    const passiveSamples = collectPassiveTempSamples(days, unitIndex);
    const coolingSamples = collectActiveTempSamples(days, unitIndex, "cooling");
    const heatingSamples = collectActiveTempSamples(days, unitIndex, "heating");
    const dryTempSamples = collectActiveTempSamples(days, unitIndex, "dehumidify");
    const dryHumSamples = collectDehumidifyHumiditySamples(days, unitIndex);
    const inertiaSamples = collectInertiaSamples(days, unitIndex);
    const passive = finishPassive(passiveSamples, nowMs);
    const cooling = finishEffect(coolingSamples, nowMs, "temp", !hasCooling && coolingSamples.length === 0, "Climate Cooling nicht verfügbar — nicht auswertbar.", "Cooling-Wirkung noch nicht auswertbar.");
    const heating = finishEffect(heatingSamples, nowMs, "temp", !hasHeating && heatingSamples.length === 0, "Climate Heating nicht verfügbar — nicht auswertbar.", "Heating-Wirkung noch nicht auswertbar.");
    const dehumidifyTemp = finishEffect(dryTempSamples, nowMs, "temp", !hasDry && dryTempSamples.length === 0, "Climate Dehumidify nicht verfügbar — nicht auswertbar.", "Dehumidify-Temperaturwirkung noch nicht auswertbar.");
    const dehumidifyHumidity = finishEffect(dryHumSamples, nowMs, "humidity", !hasDry && dryHumSamples.length === 0, "Climate Dehumidify nicht verfügbar — nicht auswertbar.", "Dehumidify-Feuchtewirkung noch nicht auswertbar.");
    const inertia = finishEffect(inertiaSamples, nowMs, "temp", false, "", "Trägheit nicht auswertbar — zu wenig belastbare Nachlauf-Abschnitte.");
    if (inertia.sampleCount < exports.CLIMATE_THERMAL_MIN_SAMPLES) {
        inertia.status = "not_evaluable";
        inertia.usable = false;
        inertia.reasonDe = "Trägheit nicht auswertbar — zu wenig belastbare Nachlauf-Abschnitte.";
    }
    const bits = [];
    if (passive.usable)
        bits.push("passiv usable");
    if (cooling.usable)
        bits.push("cooling usable");
    if (heating.usable)
        bits.push("heating usable");
    if (dehumidifyHumidity.usable || dehumidifyTemp.usable)
        bits.push("dehumidify teilw. usable");
    if (heating.status === "unavailable")
        bits.push("heating unavailable");
    const reasonDe = bits.length > 0
        ? `Unit ${unitIndex}: ${bits.join(", ")}.`
        : `Unit ${unitIndex}: sammelt noch, kein Modell usable.`;
    return {
        unitIndex,
        passive,
        cooling,
        heating,
        dehumidify: { temp: dehumidifyTemp, humidity: dehumidifyHumidity },
        inertia,
        reasonDe,
        lastRunIso,
    };
}
exports.computeClimateThermalUnitModel = computeClimateThermalUnitModel;
function computeClimateThermalModels(days, units, nowMs) {
    const out = {};
    for (const u of units) {
        if (!u.enabled && !days.some((d) => (d.buckets.climateUnitSlots ?? []).some((s) => s?.some((x) => x.unitIndex === u.unitIndex)))) {
            continue;
        }
        out[String(u.unitIndex)] = computeClimateThermalUnitModel(days, u, nowMs);
    }
    return out;
}
exports.computeClimateThermalModels = computeClimateThermalModels;
/** Für Tests: Segment-Hilfsbauer. */
function thermalTestSegment(overrides = {}) {
    const unitIndex = overrides.unitIndex ?? 1;
    return {
        startTs: overrides.startTs ?? 1_000,
        endTs: overrides.endTs ?? 1_000 + 1_800_000,
        sharedPowerGroupId: overrides.sharedPowerGroupId ?? "outdoor_1",
        mode: overrides.mode ?? "cooling",
        activeUnitCombination: overrides.activeUnitCombination ?? "1",
        energyKwh: overrides.energyKwh ?? 0.35,
        runtimeSec: overrides.runtimeSec ?? 1800,
        valid: overrides.valid ?? true,
        rejectReason: overrides.rejectReason ?? null,
        outdoorTempStartC: overrides.outdoorTempStartC ?? 30,
        outdoorTempEndC: overrides.outdoorTempEndC ?? 31,
        unitObservations: overrides.unitObservations ?? [
            {
                unitIndex,
                roomTempStartC: 27,
                roomTempEndC: 25.5,
                roomHumidityStartPct: 55,
                roomHumidityEndPct: 54,
                ownershipOwner: "ems",
                overrideActive: false,
            },
        ],
        ownershipOwner: overrides.ownershipOwner ?? "ems",
        overrideActive: overrides.overrideActive ?? false,
        thermalUsable: overrides.thermalUsable ?? true,
        thermalRejectReason: overrides.thermalRejectReason ?? null,
    };
}
exports.thermalTestSegment = thermalTestSegment;
