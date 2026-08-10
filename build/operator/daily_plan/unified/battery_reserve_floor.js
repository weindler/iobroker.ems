"use strict";
/**
 * Zeitabhängiger Battery-Reserve-Floor (Befund 004 Ergänzung).
 *
 * requiredBatteryEnergy(t) = unvermeidbarer Bedarf bis zur nächsten PV-/Lade-Recovery
 *   + Sicherheitsreserve (minSoc)
 * usableBatteryEnergy(t) = soc(t) − required(t)  (alles darüber ist flexibel für Verbraucher)
 *
 * Keine festen %-Regeln, keine Writes — nur Planungszahlen für Score-Allocation.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.usableBatteryEnergyKwh = exports.reserveFloorAt = exports.buildBatteryReserveFloor = exports.replacementCostCtPerKwh = exports.unavoidableNeedKwh = exports.findPvRecoverySlotIdx = exports.FLOOR_EPS = void 0;
exports.FLOOR_EPS = 1e-6;
function round3(n) {
    return Math.round(n * 1000) / 1000;
}
/** Lokale Stunde 0–23 aus ISO + IANA-Timezone. */
function localHour(iso, timeZone) {
    try {
        const parts = new Intl.DateTimeFormat("en-GB", {
            timeZone,
            hour: "numeric",
            hourCycle: "h23",
        }).formatToParts(new Date(iso));
        const h = Number(parts.find((p) => p.type === "hour")?.value);
        return Number.isFinite(h) ? h : new Date(iso).getUTCHours();
    }
    catch {
        return new Date(iso).getUTCHours();
    }
}
/**
 * Nächste PV-Recovery: frühester Slot, ab dem in ~12 h genug PV-Überschuss
 * zum Nachladen entsteht (Surplus ≥ 3 kWh oder PV ≥ 8 kWh).
 */
function findPvRecoverySlotIdx(slots, fromIdx) {
    if (slots.length === 0)
        return null;
    const start = Math.max(0, Math.min(fromIdx, slots.length - 1));
    for (let i = start; i < slots.length; i++) {
        let cumSurplus = 0;
        let cumPv = 0;
        const end = Math.min(slots.length, i + 48); // 12 h
        for (let j = i; j < end; j++) {
            const s = slots[j];
            cumPv += s.pvKwh;
            cumSurplus += Math.max(0, s.pvKwh - s.houseKwh);
            // Beide Schwellen: verhindert falsche „Recovery“ aus flachem Minimalsurplus.
            if ((cumSurplus >= 3 - exports.FLOOR_EPS && cumPv >= 5 - exports.FLOOR_EPS) ||
                cumPv >= 10 - exports.FLOOR_EPS) {
                return i;
            }
        }
    }
    return slots.length - 1;
}
exports.findPvRecoverySlotIdx = findPvRecoverySlotIdx;
/**
 * Unvermeidbarer Brückenbedarf am Slot i bis Recovery.
 *
 * Primär (wenn Nettobedarf bekannt): Energie bis zur nächsten Versorgung
 *   min(nightAnker, net + confidence-Unsicherheit)
 *   — zu jeder Tageszeit gleich, kein pauschaler %-Floor der Nachtmenge.
 * Safety/minSoc liegt separat in buildBatteryReserveFloor (safetyKwh).
 *
 * Fallback ohne Netto: gelernte nightReserve zeitlich abschmelzen (statistischer Anker).
 */
function unavoidableNeedKwh(opts) {
    const night = opts.nightReserveKwh;
    if (!(night > exports.FLOOR_EPS))
        return 0;
    const conf = opts.pvConfidence01 != null && Number.isFinite(opts.pvConfidence01)
        ? Math.max(0.2, Math.min(1, opts.pvConfidence01))
        : 0.7;
    const net = opts.netDemandUntilRecoveryKwh != null && Number.isFinite(opts.netDemandUntilRecoveryKwh)
        ? Math.max(0, opts.netDemandUntilRecoveryKwh)
        : null;
    if (net !== null) {
        /** Charge-Logic-Muster: Unsicherheitskissen nur bei conf < 70 %. */
        const uncertainty = conf < 0.7 ? night * ((0.7 - conf) / 0.7) * 0.35 : 0;
        return round3(Math.min(night, Math.max(0, net + uncertainty)));
    }
    /** Fallback ohne Forecast-Netto: Anker nach lokaler Tagesphase abschmelzen. */
    const hour = localHour(opts.slotStartIso, opts.timeZone);
    const inNight = hour >= 22 || hour < 6;
    if (hour >= 10 && hour < 22)
        return round3(night);
    if (inNight) {
        const hoursLeft = hour >= 22 ? 24 - hour + 6 : 6 - hour;
        const frac = Math.max(0, Math.min(1, hoursLeft / 8));
        return round3(night * frac);
    }
    if (opts.slotMs >= opts.recoveryMs)
        return round3(night * 0.1);
    const hoursToRec = Math.max(0, (opts.recoveryMs - opts.slotMs) / 3600_000);
    if (hoursToRec < 4)
        return round3(night * 0.12);
    return round3(night * 0.2);
}
exports.unavoidableNeedKwh = unavoidableNeedKwh;
/** Erwartete Ersatz-ct/kWh: min Import bis Recovery, ~0 wenn PV reichlich nachlädt. */
function replacementCostCtPerKwh(slots, fromIdx, recoveryIdx) {
    let cumSurplus = 0;
    let minImport = null;
    const end = Math.max(fromIdx, recoveryIdx);
    for (let j = fromIdx; j <= end && j < slots.length; j++) {
        const s = slots[j];
        cumSurplus += Math.max(0, s.pvKwh - s.houseKwh);
        if (s.importCt !== null && Number.isFinite(s.importCt)) {
            minImport = minImport === null ? s.importCt : Math.min(minImport, s.importCt);
        }
    }
    if (cumSurplus >= 3 - exports.FLOOR_EPS) {
        // Baldige PV-Recovery → kWh ist billig ersetzbar.
        return Math.min(4, minImport ?? 4);
    }
    if (minImport !== null)
        return minImport;
    return 28;
}
exports.replacementCostCtPerKwh = replacementCostCtPerKwh;
function buildBatteryReserveFloor(input, slots) {
    const cap = input.battery.usableCapacityKwh;
    const reservePct = input.battery.reserveSocPct ?? input.battery.minSocPct ?? 0;
    const safetyKwh = cap !== null && cap > 0 ? round3(cap * (Math.max(0, reservePct) / 100)) : 0;
    const night = input.battery.nightReserveKwh !== null && input.battery.nightReserveKwh > 0
        ? input.battery.nightReserveKwh
        : 0;
    const tz = input.time.timezone || "Europe/Berlin";
    const nowMs = Date.parse(input.time.nowIso);
    const fromIdx = Math.max(0, slots.findIndex((s) => s.startMs + 15 * 60_000 > nowMs));
    const pvConfRaw = input.pv.uncertainty.confidencePct;
    const pvConfidence01 = pvConfRaw !== null && Number.isFinite(pvConfRaw) ? Math.max(0.2, Math.min(1, pvConfRaw / 100)) : 0.7;
    /** Confidence-abgewertete Recovery (stärkerer Forecast → frühere Recovery). */
    const recoverySlots = slots.map((s) => ({ ...s, pvKwh: s.pvKwh * pvConfidence01 }));
    const recoverySlotIdx = findPvRecoverySlotIdx(recoverySlots, fromIdx);
    const recoveryMs = recoverySlotIdx !== null && slots[recoverySlotIdx]
        ? slots[recoverySlotIdx].startMs
        : slots.length > 0
            ? Date.parse(slots[slots.length - 1].endIso)
            : nowMs;
    const requiredKwhBySlot = [];
    const replacementCtBySlot = [];
    for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        /** null = Hauslast fehlend/leer → kein Fake-Nuller als „kein Bedarf“. */
        const netDemand = netDemandUntilRecoveryKwh(slots, i, recoverySlotIdx, pvConfidence01);
        const unavoidable = unavoidableNeedKwh({
            slotStartIso: s.startIso,
            slotMs: s.startMs,
            recoveryMs,
            nightReserveKwh: night,
            timeZone: tz,
            netDemandUntilRecoveryKwh: netDemand,
            pvConfidence01,
        });
        const required = round3(Math.min(cap ?? unavoidable + safetyKwh, Math.max(safetyKwh, unavoidable)));
        requiredKwhBySlot.push(required);
        const recIdx = recoverySlotIdx ?? slots.length - 1;
        replacementCtBySlot.push(replacementCostCtPerKwh(slots, i, recIdx));
    }
    const parts = [];
    if (night > 0)
        parts.push(`Nachtreserve-Anker ~${night.toFixed(1)} kWh forecastabhängig`);
    if (recoverySlotIdx !== null && slots[recoverySlotIdx]) {
        parts.push(`PV-Recovery ab ${slots[recoverySlotIdx].startIso}`);
    }
    parts.push(`Safety ~${safetyKwh.toFixed(1)} kWh`);
    return {
        requiredKwhBySlot,
        recoverySlotIdx,
        replacementCtBySlot,
        reasonDe: parts.join("; ") + ".",
    };
}
exports.buildBatteryReserveFloor = buildBatteryReserveFloor;
/**
 * Intern: Haus − conf×PV bis Recovery.
 * null wenn keine belastbare Hauslast (nie 0 als Missing-Sentinel).
 * 0 ist gültig, wenn Recovery bereits jetzt/erreicht ist (kein Brückenbedarf).
 */
function netDemandUntilRecoveryKwh(slots, fromIdx, recoveryIdx, pvConfidence01) {
    if (slots.length === 0)
        return null;
    const houseKnown = slots.some((s) => s.houseKwh > exports.FLOOR_EPS);
    if (!houseKnown)
        return null;
    /** Recovery läuft / ist erreicht → kein Intervall zu brücken. */
    if (recoveryIdx !== null && recoveryIdx <= fromIdx)
        return 0;
    const end = recoveryIdx !== null ? Math.max(fromIdx, recoveryIdx) : slots.length - 1;
    let net = 0;
    for (let j = fromIdx; j < end && j < slots.length; j++) {
        const s = slots[j];
        net += Math.max(0, s.houseKwh - s.pvKwh * pvConfidence01);
    }
    return round3(net);
}
function reserveFloorAt(floor, slotIdx, fallback) {
    const v = floor.requiredKwhBySlot[slotIdx];
    return v !== undefined && Number.isFinite(v) ? v : fallback;
}
exports.reserveFloorAt = reserveFloorAt;
function usableBatteryEnergyKwh(socKwh, floorKwh, dischargeEff) {
    const drawRoom = socKwh - floorKwh;
    if (!(drawRoom > exports.FLOOR_EPS))
        return 0;
    return round3(drawRoom * Math.max(dischargeEff, 0.1));
}
exports.usableBatteryEnergyKwh = usableBatteryEnergyKwh;
