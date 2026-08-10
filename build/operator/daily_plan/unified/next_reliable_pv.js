"use strict";
/**
 * Nächste belastbare PV-Versorgungsmöglichkeit — gemeinsam für Thermal-Bridge und Battery-Reserve.
 * Kein „PV > 0“, sondern kumulativer Surplus mit Confidence-Abschlag.
 * Pflichtenergie (nicht-thermisch) wird vor Opportunity-Erkennung vom Surplus abgezogen —
 * keine Doppelverwendung derselben PV-kWh als „sichere Versorgung“.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveThermalPlannerEnergy = exports.thermalHardCoverUntilMs = exports.expectedNetDemandUntilPvKwh = exports.findNextReliablePvAfterCurrentWindow = exports.findStartOfNextSurplusWindowIdx = exports.findEndOfCurrentSurplusWindowIdx = exports.findNextReliablePvOpportunity = exports.applyHardPvBoundsToSlots = exports.estimateHardPvBoundKwhBySlot = void 0;
const battery_reserve_floor_1 = require("./battery_reserve_floor");
const flex_demand_1 = require("../../contributions/flexible/flex_demand");
function round3(n) {
    return Math.round(n * 1000) / 1000;
}
/**
 * Früheste-Slot-Bindung harter Pflichtlasten an Roh-Surplus (PV − Haus).
 * Thermal bewusst ausgenommen (Bridge hängt von next-PV ab).
 */
function estimateHardPvBoundKwhBySlot(slots, nowMs, hardConsumers) {
    const bound = slots.map(() => 0);
    const slotH = 0.25;
    for (const c of hardConsumers) {
        let need = c.remainingKwh;
        if (!(need > battery_reserve_floor_1.FLOOR_EPS))
            continue;
        const maxSlot = c.maxPowerW != null && c.maxPowerW > 0 ? (c.maxPowerW / 1000) * slotH : Number.POSITIVE_INFINITY;
        for (let i = 0; i < slots.length && need > battery_reserve_floor_1.FLOOR_EPS; i++) {
            const s = slots[i];
            if (s.startMs < nowMs - 60_000)
                continue;
            if (s.startMs >= c.deadlineMs)
                break;
            if (c.slotAllowed && !c.slotAllowed(s.startIso))
                continue;
            const free = Math.max(0, s.pvKwh - s.houseKwh - bound[i]);
            const take = Math.min(need, maxSlot, free);
            if (take > battery_reserve_floor_1.FLOOR_EPS) {
                bound[i] = bound[i] + take;
                need -= take;
            }
        }
    }
    return bound.map(round3);
}
exports.estimateHardPvBoundKwhBySlot = estimateHardPvBoundKwhBySlot;
/** Reduziert Slot-PV um gebundene Pflichtenergie (Kopie — Allocation-Slots unverändert). */
function applyHardPvBoundsToSlots(slots, boundKwhBySlot) {
    return slots.map((s, i) => {
        const bound = Math.max(0, boundKwhBySlot[i] ?? 0);
        if (!(bound > battery_reserve_floor_1.FLOOR_EPS))
            return s;
        return { ...s, pvKwh: Math.max(0, s.pvKwh - bound) };
    });
}
exports.applyHardPvBoundsToSlots = applyHardPvBoundsToSlots;
/**
 * Wie findPvRecoverySlotIdx, aber PV-kWh werden mit Confidence abgewertet
 * (niedrige Confidence → Recovery später / schwieriger).
 *
 * @param afterMs Optional: erste Recovery mit startMs > afterMs (Slot-Zeitstempel,
 *   keine feste Stundenheuristik). Für Thermal-Bridge bevorzugt
 *   findNextReliablePvAfterCurrentWindow (Ende des aktuellen Surplus-Fensters).
 */
function findNextReliablePvOpportunity(slots, fromIdx, pvConfidence01, afterMs) {
    const conf = Number.isFinite(pvConfidence01) ? Math.max(0.2, Math.min(1, pvConfidence01)) : 0.7;
    const adjusted = slots.map((s) => ({
        ...s,
        pvKwh: s.pvKwh * conf,
    }));
    let searchFrom = Math.max(0, fromIdx);
    if (afterMs != null && Number.isFinite(afterMs)) {
        const afterIdx = slots.findIndex((s) => s.startMs > afterMs);
        if (afterIdx < 0) {
            return {
                slotIdx: null,
                startIso: null,
                startMs: null,
                reasonDe: "Keine belastbare PV-Recovery nach aktuellem Fenster.",
            };
        }
        searchFrom = Math.max(searchFrom, afterIdx);
    }
    const idx = (0, battery_reserve_floor_1.findPvRecoverySlotIdx)(adjusted, searchFrom);
    if (idx === null || !slots[idx]) {
        return {
            slotIdx: null,
            startIso: null,
            startMs: null,
            reasonDe: "Keine belastbare PV-Recovery im Horizon.",
        };
    }
    return {
        slotIdx: idx,
        startIso: slots[idx].startIso,
        startMs: slots[idx].startMs,
        reasonDe: `Belastbare PV-Recovery ab ${slots[idx].startIso} (conf=${(conf * 100).toFixed(0)} %).`,
    };
}
exports.findNextReliablePvOpportunity = findNextReliablePvOpportunity;
/**
 * 1 kW × Slotlänge (0,25 h) — an Raster gebunden, keine Uhrzeit-Heuristik.
 * Wird nur als „PV sichtbar“-Schwelle genutzt, nicht als Stunden-Cutoff.
 */
const SLOT_ENERGY_1KW_KWH = 0.25;
/** Meaningful Surplus/PV im Slot — Surplus > EPS oder mind. ~1 kW×Slot. */
function isMeaningfulSurplusSlot(s) {
    return Math.max(0, s.pvKwh - s.houseKwh) > battery_reserve_floor_1.FLOOR_EPS || s.pvKwh >= SLOT_ENERGY_1KW_KWH;
}
/**
 * Ende des aktuell laufenden / unmittelbar startenden Surplus-Fensters (Slot-Index).
 * Basiert nur auf Forecast-Slots: Surplus-Streak + max. 2 Slot-Lücken (30 min bei 15-min-Raster).
 * Keine Uhrzeit-/Stunden-Heuristik — ein separates Fenster in 2–5 h nach einer echten
 * Surplus-Pause wird nicht übersprungen.
 */
function findEndOfCurrentSurplusWindowIdx(slots, fromIdx) {
    if (slots.length === 0)
        return 0;
    const i = Math.max(0, Math.min(fromIdx, slots.length - 1));
    /** Kurzes Vorlauf-Fenster: Ramp-in ohne sofortigen Surplus (max. 4 Slots). */
    let start = i;
    while (start < slots.length && !isMeaningfulSurplusSlot(slots[start])) {
        if (start > i + 4)
            return i; // kein aktuelles Fenster → nichts überspringen
        start++;
    }
    if (start >= slots.length)
        return i;
    let end = start;
    let gap = 0;
    /** Strukturelle Slot-Lücke (2×15 min), keine Tages-/Stundenkonstante. */
    const gapSlots = 2;
    while (end < slots.length) {
        if (isMeaningfulSurplusSlot(slots[end])) {
            gap = 0;
            end++;
        }
        else {
            gap++;
            if (gap > gapSlots)
                break;
            end++;
        }
    }
    return Math.min(slots.length, end);
}
exports.findEndOfCurrentSurplusWindowIdx = findEndOfCurrentSurplusWindowIdx;
/**
 * Erster Surplus-Slot ab afterIdx (Start des nächsten Fensters).
 * Wichtig: nicht mit findPvRecoverySlotIdx verwechseln — der kann mitten in einer
 * Lücke starten, sobald der Blick voraus genug kumulativen Surplus sieht.
 */
function findStartOfNextSurplusWindowIdx(slots, afterIdx) {
    const start = Math.max(0, afterIdx);
    for (let i = start; i < slots.length; i++) {
        if (isMeaningfulSurplusSlot(slots[i]))
            return i;
    }
    return null;
}
exports.findStartOfNextSurplusWindowIdx = findStartOfNextSurplusWindowIdx;
/**
 * Nächste PV-Gelegenheit für Thermal-Bridge: Recovery NACH dem aktuellen Surplus-Fenster
 * (damit „hält bis nächste Versorgung“ nicht mit dem laufenden Peak verwechselt wird).
 *
 * Fenstergrenzen aus Roh-PV (keine Fragmentierung durch Pflichtbindung).
 * Zuverlässigkeit / freier Surplus: optional nach Abzug hard-bound kWh.
 */
function findNextReliablePvAfterCurrentWindow(slots, fromIdx, pvConfidence01, _nowMs, boundKwhBySlot) {
    void _nowMs;
    const hasBound = boundKwhBySlot != null && boundKwhBySlot.some((b) => b > battery_reserve_floor_1.FLOOR_EPS);
    const checkSlots = hasBound ? applyHardPvBoundsToSlots(slots, boundKwhBySlot) : slots;
    const afterIdx = findEndOfCurrentSurplusWindowIdx(slots, fromIdx);
    let nextSurplusIdx = findStartOfNextSurplusWindowIdx(slots, afterIdx);
    if (nextSurplusIdx !== null && nextSurplusIdx > fromIdx && hasBound) {
        /** Wenn Roh-Start nach Bindung keinen freien Surplus hat → nächstes freies Fenster. */
        const free = Math.max(0, (checkSlots[nextSurplusIdx]?.pvKwh ?? 0) - (checkSlots[nextSurplusIdx]?.houseKwh ?? 0));
        if (free <= battery_reserve_floor_1.FLOOR_EPS) {
            nextSurplusIdx = findStartOfNextSurplusWindowIdx(checkSlots, nextSurplusIdx);
        }
    }
    if (nextSurplusIdx !== null && nextSurplusIdx > fromIdx) {
        const reliable = findNextReliablePvOpportunity(checkSlots, nextSurplusIdx, pvConfidence01);
        if (reliable.slotIdx !== null) {
            const s = slots[nextSurplusIdx];
            return {
                slotIdx: nextSurplusIdx,
                startIso: s.startIso,
                startMs: s.startMs,
                reasonDe: hasBound
                    ? `Nächstes Surplus-Fenster ab ${s.startIso} (nach Pflichtbindung conf-geprüft).`
                    : `Nächstes Surplus-Fenster ab ${s.startIso} (conf-geprüft).`,
            };
        }
    }
    /** Kein Folgef Fenster / kurzer Horizon: erste Recovery ab now. */
    return findNextReliablePvOpportunity(checkSlots, fromIdx, pvConfidence01);
}
exports.findNextReliablePvAfterCurrentWindow = findNextReliablePvAfterCurrentWindow;
/**
 * Erwarteter Nettobedarf (Haus − abgewertete PV) von fromIdx bis recoveryIdx (exklusiv Recovery-Start).
 * Nie negativ; Unsicherheitsanteil über (1−confidence).
 */
function expectedNetDemandUntilPvKwh(slots, fromIdx, recoveryIdx, pvConfidence01) {
    if (slots.length === 0)
        return 0;
    const conf = Number.isFinite(pvConfidence01) ? Math.max(0.2, Math.min(1, pvConfidence01)) : 0.7;
    const end = recoveryIdx !== null ? Math.max(fromIdx, recoveryIdx) : slots.length - 1;
    let net = 0;
    for (let j = fromIdx; j < end && j < slots.length; j++) {
        const s = slots[j];
        const pvEff = s.pvKwh * conf;
        net += Math.max(0, s.houseKwh - pvEff);
    }
    return Math.round(net * 1000) / 1000;
}
exports.expectedNetDemandUntilPvKwh = expectedNetDemandUntilPvKwh;
/**
 * Cover-Horizont für Hard-Bridge:
 * - Solange das aktuelle Surplus-Fenster noch Rest hat → Fensterende (heutige PV-Phase).
 * - Sonst nextReliablePv (nächstes Fenster nach Lücke / morgen).
 */
function thermalHardCoverUntilMs(input) {
    const windowEnd = input.currentWindowEndMs;
    if (windowEnd != null && Number.isFinite(windowEnd) && windowEnd > input.nowMs + 60_000) {
        return windowEnd;
    }
    if (input.nextReliablePvMs != null && Number.isFinite(input.nextReliablePvMs)) {
        return input.nextReliablePvMs;
    }
    return null;
}
exports.thermalHardCoverUntilMs = thermalHardCoverUntilMs;
/**
 * Mindestenergie bis Cover-Horizont vs. wirtschaftlichem Precharge-Rest.
 * emptyAt = Reichweite bis MinTemp — nicht „bis dahin auf Target laden“.
 * Fehlt Physik: Soft-Headroom, kein Fake-Hard aus vollständigem Target-Headroom.
 */
function resolveThermalPlannerEnergy(input) {
    const headroom = input.headroomEnergyKwh !== null && Number.isFinite(input.headroomEnergyKwh)
        ? Math.max(0, input.headroomEnergyKwh)
        : 0;
    const kwhPerC = input.kwhPerDegreeC != null && input.kwhPerDegreeC > 0
        ? input.kwhPerDegreeC
        : flex_demand_1.IMMERSION_DEFAULT_KWH_PER_DEGREE_C;
    const conf = Number.isFinite(input.pvConfidence01)
        ? Math.max(0.2, Math.min(1, input.pvConfidence01))
        : 0.7;
    const softOnlyFallback = (reasonDe) => ({
        plannerEnergyKwh: headroom,
        mandatoryEnergyKwh: 0,
        economicHeadroomKwh: headroom,
        coversUntilNextPv: true,
        coverUntilMs: null,
        reasonDe,
    });
    const coverUntilMs = thermalHardCoverUntilMs(input);
    if (input.bufferTempC === null ||
        input.minTempC === null ||
        input.coolingRateCPerH === null ||
        !(input.coolingRateCPerH > 0) ||
        coverUntilMs === null ||
        !(coverUntilMs >= input.nowMs - 60_000)) {
        return softOnlyFallback("Thermal-Bridge ohne belastbare Kühlrate/Min/PV — optionaler Headroom (soft).");
    }
    const hoursToCover = (coverUntilMs - input.nowMs) / 3600_000;
    const emptyAtKnown = input.estimatedEmptyAtMs !== null &&
        Number.isFinite(input.estimatedEmptyAtMs) &&
        input.estimatedEmptyAtMs > input.nowMs;
    const pack = (mandatory, covers, reasonDe) => {
        const m = round3(Math.max(0, mandatory));
        const soft = round3(Math.max(0, headroom - m));
        return {
            plannerEnergyKwh: round3(m + soft),
            mandatoryEnergyKwh: m,
            economicHeadroomKwh: soft,
            coversUntilNextPv: covers,
            coverUntilMs,
            reasonDe,
        };
    };
    /*
     * emptyAt nach Cover-Horizont (Rest des laufenden PV-Fensters bzw. next PV):
     * Hard-Bridge 0 (+ Unsicherheitsmarge) — Target-Precharge bleibt Soft.
     */
    if (emptyAtKnown && input.estimatedEmptyAtMs >= coverUntilMs - 60_000) {
        const uncertaintyK = conf < 0.7
            ? input.coolingRateCPerH * Math.max(0, hoursToCover) * ((0.7 - conf) / 0.7) * 0.35
            : 0;
        const mandatory = uncertaintyK * kwhPerC;
        return pack(mandatory, true, `emptyAt nach Cover (${new Date(coverUntilMs).toISOString()}) — Hard-Bridge ~0, Precharge soft (conf=${(conf * 100).toFixed(0)} %).`);
    }
    /** emptyAt vor Cover oder ohne emptyAt: Physik bis Cover-Horizont. */
    const tempAtCover = input.bufferTempC - input.coolingRateCPerH * Math.max(0, hoursToCover);
    const marginK = conf < 0.7
        ? input.coolingRateCPerH * Math.max(0, hoursToCover) * ((0.7 - conf) / 0.7) * 0.5
        : 0;
    const covers = tempAtCover >= input.minTempC + marginK - battery_reserve_floor_1.FLOOR_EPS;
    if (covers) {
        return pack(marginK * kwhPerC, true, `Puffer hält bis Cover (~${tempAtCover.toFixed(1)} °C ≥ ${input.minTempC} °C) — Precharge soft.`);
    }
    const needDeltaC = input.minTempC + marginK - tempAtCover;
    const mandatory = Math.max(0, needDeltaC) * kwhPerC;
    return pack(mandatory, false, `Hard-Bridge ~${round3(mandatory).toFixed(2)} kWh bis Cover (Δ${needDeltaC.toFixed(1)} K); Precharge soft.`);
}
exports.resolveThermalPlannerEnergy = resolveThermalPlannerEnergy;
