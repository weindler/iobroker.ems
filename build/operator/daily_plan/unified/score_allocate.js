"use strict";
/**
 * Score-basierte iterative Unified-Allocation — kein fester Add-on-Phasen-Order.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runScoreBasedAllocation = exports.scoreCandidate = exports.hardPvConsumersFromInput = exports.takePv = exports.pushAlloc = exports.wallboxAllocatedInSlotKwh = exports.immersionAllocatedInSlotKwh = exports.allocatedInSlotKwh = exports.buildSlots = exports.powerFromEnergyKwh = exports.energyFromPowerW = exports.projectedSocAt = exports.EPS = exports.SLOT_H = exports.IMMERSION_HARD_CONSUMER_ID = exports.IMMERSION_SOFT_CONSUMER_ID = void 0;
const mode_policy_1 = require("../../../planner/mode_policy");
const battery_reserve_floor_1 = require("./battery_reserve_floor");
const next_reliable_pv_1 = require("./next_reliable_pv");
/** Soft-Precharge-Consumer — kind bleibt immersion_heater; Power teilt sich mit Hard. */
exports.IMMERSION_SOFT_CONSUMER_ID = "immersion_heater_soft";
exports.IMMERSION_HARD_CONSUMER_ID = "immersion_heater";
const optimize_weights_1 = require("./optimize_weights");
const reason_codes_1 = require("./reason_codes");
const vehicle_availability_1 = require("./vehicle_availability");
const ev_energy_1 = require("./ev_energy");
const slot_geometry_1 = require("./slot_geometry");
exports.SLOT_H = slot_geometry_1.CANONICAL_SLOT_H;
exports.EPS = 1e-6;
/** SOC am Ende von slotIdx nach chronologischer Propagation der gebuchten Deltas. */
function projectedSocAt(state, slotIdx) {
    let soc = state.initialSocKwh;
    const last = Math.min(slotIdx, state.socDeltaBySlot.length - 1);
    for (let i = 0; i <= last; i++) {
        soc += state.socDeltaBySlot[i] ?? 0;
        soc = Math.max(0, Math.min(state.capacityKwh, soc));
    }
    return soc;
}
exports.projectedSocAt = projectedSocAt;
function syncFinalSoc(state) {
    state.socKwh =
        state.slots.length === 0
            ? state.initialSocKwh
            : projectedSocAt(state, state.slots.length - 1);
}
function floorKwhAt(state, slotIdx) {
    return (0, battery_reserve_floor_1.reserveFloorAt)(state.reserveFloor, slotIdx, state.reserveKwh);
}
/**
 * Effektiver Discharge-Floor für einen Zug: Maximum der noch kommenden
 * Reserve-Pflichten (ab now bis Recovery) ∪ Mode-MinSoc.
 * Verhindert, nachmittags „nächtlich abschmelzende“ Floors zu nutzen und so
 * die Nachtreserve vorzeitig zu verplanen.
 */
function dischargeFloorKwh(state, _slotIdx) {
    let peak = state.modeDischargeMinKwh;
    const rec = state.reserveFloor.recoverySlotIdx;
    const last = rec !== null && rec >= 0
        ? Math.min(state.slots.length - 1, Math.max(rec, 0))
        : state.slots.length - 1;
    for (let j = 0; j <= last; j++) {
        const slot = state.slots[j];
        if (!slot || slot.startMs < state.nowMs - 60_000)
            continue;
        peak = Math.max(peak, floorKwhAt(state, j));
    }
    return peak;
}
function round3(n) {
    return Math.round(n * 1000) / 1000;
}
function energyFromPowerW(powerW) {
    return (powerW / 1000) * exports.SLOT_H;
}
exports.energyFromPowerW = energyFromPowerW;
function powerFromEnergyKwh(kwh) {
    return (kwh / exports.SLOT_H) * 1000;
}
exports.powerFromEnergyKwh = powerFromEnergyKwh;
function pvConfidenceFactor(input) {
    const c = input.pv.uncertainty.confidencePct;
    if (c === null || !Number.isFinite(c))
        return 1;
    return Math.max(0.2, Math.min(1, c / 100));
}
/** Observed vor Forecast — eine Welt pro Slot (NOW live-live oder forecast-forecast). */
function pickSlotPowerW(forecastPowerW, observedPowerW, energyKwh) {
    if (observedPowerW != null && Number.isFinite(observedPowerW) && observedPowerW >= 0) {
        return { powerW: observedPowerW, fromObserved: true };
    }
    if (forecastPowerW != null && Number.isFinite(forecastPowerW)) {
        return { powerW: forecastPowerW, fromObserved: false };
    }
    if (energyKwh != null && Number.isFinite(energyKwh)) {
        return { powerW: powerFromEnergyKwh(energyKwh), fromObserved: false };
    }
    return { powerW: null, fromObserved: false };
}
function emptySlotWork(startIso, endIso) {
    return {
        startIso,
        endIso,
        startMs: Date.parse(startIso),
        pvKwh: 0,
        houseKwh: 0,
        surplusKwh: 0,
        importCt: null,
        exportCt: null,
        gridAllowed: true,
        remainPvKwh: 0,
        reservedEvKwh: 0,
        evGridReserved: false,
    };
}
/**
 * Ausführbare Unified-Zeitachse: ausschließlich kanonische 15-Min-Slots.
 * Mehrstündige Hauslast-Segmente (z. B. midday 10–14) liefern Leistung auf
 * überlappende Quarters — sie überschreiben niemals endIso.
 */
function buildSlots(input) {
    const byStart = new Map();
    const nowUsesLive = new Set();
    const ensureQuarter = (startIso, endIso) => {
        if (!(0, slot_geometry_1.isCanonicalQuarterSlot)(startIso, endIso))
            return;
        if (byStart.has(startIso))
            return;
        byStart.set(startIso, emptySlotWork(startIso, endIso));
    };
    /** 1) Kanonische Geometrie nur aus 15-Min-Zeitachsen (PV/Preis/time). */
    for (const s of input.time.slots) {
        ensureQuarter(s.startIso, s.endIso);
    }
    for (const p of input.pv.slots) {
        ensureQuarter(p.slot.startIso, p.slot.endIso);
    }
    for (const pr of input.prices.slots) {
        ensureQuarter(pr.slot.startIso, pr.slot.endIso);
    }
    /**
     * 2) Mehrstündige Segmente → fehlende Quarters auffüllen (ohne endIso-Overwrite).
     *    startIso allein ist kein Schlüssel für Geometrie.
     */
    for (const s of input.time.slots) {
        if ((0, slot_geometry_1.isCanonicalQuarterSlot)(s.startIso, s.endIso))
            continue;
        const start = Date.parse(s.startIso);
        const end = Date.parse(s.endIso);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
            continue;
        for (let t = start; t < end; t += slot_geometry_1.CANONICAL_SLOT_MS) {
            const startIso = new Date(t).toISOString();
            const endIso = new Date(t + slot_geometry_1.CANONICAL_SLOT_MS).toISOString();
            ensureQuarter(startIso, endIso);
        }
    }
    for (const h of input.houseLoad.slots) {
        if ((0, slot_geometry_1.isCanonicalQuarterSlot)(h.slot.startIso, h.slot.endIso))
            continue;
        const start = Date.parse(h.slot.startIso);
        const end = Date.parse(h.slot.endIso);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
            continue;
        for (let t = start; t < end; t += slot_geometry_1.CANONICAL_SLOT_MS) {
            const startIso = new Date(t).toISOString();
            const endIso = new Date(t + slot_geometry_1.CANONICAL_SLOT_MS).toISOString();
            ensureQuarter(startIso, endIso);
        }
    }
    for (const p of input.pv.slots) {
        if (!(0, slot_geometry_1.isCanonicalQuarterSlot)(p.slot.startIso, p.slot.endIso))
            continue;
        const w = byStart.get(p.slot.startIso);
        if (!w)
            continue;
        const pick = pickSlotPowerW(p.forecastPowerW, p.observedPowerW, p.energyKwh);
        if (pick.powerW !== null)
            w.pvKwh = energyFromPowerW(pick.powerW);
        if (pick.fromObserved)
            nowUsesLive.add(p.slot.startIso);
    }
    /** Hauslast: Segmente auf alle überlappenden Quarters projizieren. */
    for (const h of input.houseLoad.slots) {
        const pick = pickSlotPowerW(h.forecastPowerW, h.observedPowerW, h.energyKwh);
        if (pick.powerW === null)
            continue;
        const e = energyFromPowerW(pick.powerW);
        const hStart = Date.parse(h.slot.startIso);
        const hEnd = Date.parse(h.slot.endIso);
        if (!Number.isFinite(hStart) || !Number.isFinite(hEnd))
            continue;
        if ((0, slot_geometry_1.isCanonicalQuarterSlot)(h.slot.startIso, h.slot.endIso)) {
            const w = byStart.get(h.slot.startIso);
            if (!w)
                continue;
            w.houseKwh = e;
            if (!pick.fromObserved)
                nowUsesLive.delete(h.slot.startIso);
            continue;
        }
        for (const w of byStart.values()) {
            if (w.startMs >= hStart && w.startMs < hEnd) {
                w.houseKwh = e;
                if (!pick.fromObserved)
                    nowUsesLive.delete(w.startIso);
            }
        }
    }
    for (const pr of input.prices.slots) {
        if (!(0, slot_geometry_1.isCanonicalQuarterSlot)(pr.slot.startIso, pr.slot.endIso))
            continue;
        const w = byStart.get(pr.slot.startIso);
        if (!w)
            continue;
        w.importCt = pr.importCtPerKwh;
        w.exportCt = pr.exportCtPerKwh;
        w.gridAllowed = pr.gridImportAllowed;
    }
    const slots = [...byStart.values()].sort((a, b) => a.startMs - b.startMs);
    for (const w of slots) {
        w.surplusKwh = Math.max(0, w.pvKwh - w.houseKwh);
        w.remainPvKwh = w.surplusKwh;
    }
    /*
     * Runtime-Hold AC: bei Forecast-NOW (ohne Live-HL) reale Hold-Last von Surplus nehmen.
     * Bei Live-HL ist AC bereits in observedHouse enthalten — keine Extra-Reserve.
     */
    const nowMs = Date.parse(input.time.nowIso);
    const nowSlot = slots.find((s) => nowMs >= s.startMs && nowMs < Date.parse(s.endIso));
    if (nowSlot && input.climate && !nowUsesLive.has(nowSlot.startIso)) {
        for (const u of input.climate.units) {
            if (!u.runtimeHold)
                continue;
            const holdW = u.holdPowerW ?? u.typicalPowerW;
            if (holdW == null || !(holdW > 0))
                continue;
            const e = energyFromPowerW(holdW);
            nowSlot.houseKwh += e;
            nowSlot.surplusKwh = Math.max(0, nowSlot.pvKwh - nowSlot.houseKwh);
            nowSlot.remainPvKwh = nowSlot.surplusKwh;
        }
    }
    return slots;
}
exports.buildSlots = buildSlots;
/** Bereits allokierte Energie eines Consumers in einem Slot (max. eine Zelle pro Slot). */
function allocatedInSlotKwh(out, consumerId, slotStartIso) {
    const cell = out.find((a) => a.consumerId === consumerId && a.slot.startIso === slotStartIso);
    return cell?.allocatedEnergyKwh ?? 0;
}
exports.allocatedInSlotKwh = allocatedInSlotKwh;
/** Heizstab Hard+Soft teilen dieselbe Leistungsstufe pro Slot. */
function immersionAllocatedInSlotKwh(out, slotStartIso) {
    let sum = 0;
    for (const a of out) {
        if (a.kind === "immersion_heater" && a.slot.startIso === slotStartIso) {
            sum += a.allocatedEnergyKwh;
        }
    }
    return sum;
}
exports.immersionAllocatedInSlotKwh = immersionAllocatedInSlotKwh;
/** Wallbox Hard+Target teilen dieselbe AC-Ladeleistung pro Slot. */
function wallboxAllocatedInSlotKwh(out, slotStartIso) {
    let sum = 0;
    for (const a of out) {
        if (a.kind === "wallbox" && a.slot.startIso === slotStartIso) {
            sum += a.allocatedEnergyKwh;
        }
    }
    return sum;
}
exports.wallboxAllocatedInSlotKwh = wallboxAllocatedInSlotKwh;
function wallboxGridInSlotKwh(out, slotStartIso) {
    let sum = 0;
    for (const a of out) {
        if (a.kind === "wallbox" &&
            a.slot.startIso === slotStartIso &&
            (a.energySource === "grid" || a.energySource === "mixed")) {
            sum += a.allocatedEnergyKwh;
        }
    }
    return sum;
}
function batteryGridInSlotKwh(out, slotStartIso) {
    let sum = 0;
    for (const a of out) {
        if (a.kind === "battery_charge" &&
            a.slot.startIso === slotStartIso &&
            (a.energySource === "grid" || a.energySource === "mixed")) {
            sum += a.allocatedEnergyKwh;
        }
    }
    return sum;
}
function alreadyAllocatedForConsumer(out, consumer, slotStartIso) {
    if (consumer.kind === "immersion_heater")
        return immersionAllocatedInSlotKwh(out, slotStartIso);
    if (consumer.kind === "wallbox")
        return wallboxAllocatedInSlotKwh(out, slotStartIso);
    return allocatedInSlotKwh(out, consumer.consumerId, slotStartIso);
}
/**
 * Schreibt/merged Allocation — maximal eine Zelle pro (consumerId, slot).
 * Verhindert Runtime-„duplicate“-Rejects im Daily-Plan-Merge.
 * @returns tatsächlich verbuchte Energie (0 wenn Slot schon voll).
 */
function pushAlloc(out, slot, consumerId, kind, energyKwh, source, constraintIds, reasonCodes, maxPowerW) {
    if (energyKwh <= exports.EPS)
        return 0;
    let e = energyKwh;
    const existing = out.find((a) => a.consumerId === consumerId && a.slot.startIso === slot.startIso);
    const already = existing?.allocatedEnergyKwh ?? 0;
    if (maxPowerW !== null && maxPowerW > 0) {
        const cap = energyFromPowerW(maxPowerW);
        e = Math.min(e, Math.max(0, cap - already));
    }
    if (e <= exports.EPS)
        return 0;
    if (existing) {
        existing.allocatedEnergyKwh = round3(already + e);
        existing.allocatedPowerW = round3(powerFromEnergyKwh(existing.allocatedEnergyKwh));
        if (existing.energySource !== source)
            existing.energySource = "mixed";
        for (const id of constraintIds) {
            if (!existing.constraintIds.includes(id))
                existing.constraintIds.push(id);
        }
        for (const code of reasonCodes) {
            if (!existing.reasonCodes.includes(code))
                existing.reasonCodes.push(code);
        }
        return e;
    }
    const endIso = (0, slot_geometry_1.isCanonicalQuarterSlot)(slot.startIso, slot.endIso)
        ? slot.endIso
        : new Date(slot.startMs + slot_geometry_1.CANONICAL_SLOT_MS).toISOString();
    out.push({
        slot: { startIso: slot.startIso, endIso },
        consumerId,
        kind,
        allocatedPowerW: round3(powerFromEnergyKwh(e)),
        allocatedEnergyKwh: round3(e),
        energySource: source,
        constraintIds: [...constraintIds],
        reasonCodes: [...reasonCodes],
    });
    return e;
}
exports.pushAlloc = pushAlloc;
function takePv(slot, wantKwh) {
    const take = Math.min(slot.remainPvKwh, wantKwh);
    slot.remainPvKwh = Math.max(0, slot.remainPvKwh - take);
    return take;
}
exports.takePv = takePv;
function resolveVehicleNeedKwh(input) {
    const wb = input.wallbox;
    if (!wb)
        return null;
    return (0, ev_energy_1.totalEvAcNeedKwh)((0, ev_energy_1.resolveEvEnergyClasses)(wb));
}
function wallboxImmediate(wb) {
    if (wb.batteryHoldRequested === true)
        return true;
    /** Nur Schnell/immediate → Batterie-Hold; min+PV ist PV-orientiert. */
    return wb.evccChargeMode === "now";
}
function applyExternalEvReservations(input, slots, reasonCodes) {
    const wb = input.wallbox;
    if (!wb?.externalReservations?.length)
        return;
    const mode = (0, ev_energy_1.evManagementFromWallbox)(wb);
    /**
     * EMS-Kandidat/Takeover-Kandidat belegt den Slot selbst.
     * Reservierung gilt für andere Verbraucher nur bei externer Hoheit.
     */
    if ((0, ev_energy_1.evEmsAllocates)(mode))
        return;
    let any = false;
    for (const slot of slots) {
        const slotEndMs = Date.parse(slot.endIso);
        let reserved = 0;
        let grid = false;
        for (const r of wb.externalReservations) {
            const h = (0, ev_energy_1.overlapHours)(slot.startMs, slotEndMs, Date.parse(r.startIso), Date.parse(r.endIso));
            if (h <= exports.EPS)
                continue;
            let e = 0;
            if (r.powerW != null && r.powerW > 0)
                e = (r.powerW / 1000) * h;
            else if (r.energyKwh != null && r.energyKwh > 0) {
                const durH = (Date.parse(r.endIso) - Date.parse(r.startIso)) / 3_600_000;
                e = durH > 0 ? r.energyKwh * (h / durH) : 0;
            }
            if (e > exports.EPS || r.powerW != null) {
                reserved += e;
                grid = true;
            }
        }
        if (reserved > exports.EPS || grid) {
            slot.reservedEvKwh = reserved;
            slot.evGridReserved = true;
            any = true;
        }
    }
    if (any) {
        reasonCodes.push(reason_codes_1.REASON.VEHICLE_EXTERNAL_RESERVATION);
        reasonCodes.push(reason_codes_1.REASON.VEHICLE_EXTERNALLY_MANAGED);
    }
}
/**
 * Nicht-thermische Pflichtlasten für Opportunity-Surplus (vor next-PV / Reserve).
 * Thermal absichtlich ausgenommen — Bridge hängt von next-PV ab (keine Zirkularität).
 */
function hardPvConsumersFromInput(input) {
    const out = [];
    const wb = input.wallbox;
    if (wb && (0, ev_energy_1.evEmsAllocates)((0, ev_energy_1.evManagementFromWallbox)(wb))) {
        const classes = (0, ev_energy_1.resolveEvEnergyClasses)(wb);
        if (classes.energyGoalHard && classes.hardRequiredEnergyKwh > exports.EPS) {
            out.push({
                remainingKwh: classes.hardRequiredEnergyKwh,
                maxPowerW: wb.maxChargePowerW,
                deadlineMs: wb.deadlineIso ? Date.parse(wb.deadlineIso) : Number.POSITIVE_INFINITY,
                slotAllowed: (slotStartIso) => (0, vehicle_availability_1.vehicleSlotAllocatable)(wb, slotStartIso),
            });
        }
    }
    const cl = input.climate;
    if (cl) {
        for (const u of cl.units) {
            if (u.mandatoryComfort !== true)
                continue;
            const maxW = u.typicalPowerW;
            if (maxW === null || !(maxW > 0))
                continue;
            const need = u.expectedEnergyKwh ?? energyFromPowerW(maxW) * 4;
            if (!(need > exports.EPS))
                continue;
            out.push({
                remainingKwh: need,
                maxPowerW: maxW,
                deadlineMs: Number.POSITIVE_INFINITY,
            });
        }
    }
    return out;
}
exports.hardPvConsumersFromInput = hardPvConsumersFromInput;
function hardPvBoundForPlanning(input, slots) {
    const nowMs = Date.parse(input.time.nowIso);
    return (0, next_reliable_pv_1.estimateHardPvBoundKwhBySlot)(slots, nowMs, hardPvConsumersFromInput(input));
}
function buildConsumerStates(input, slots) {
    const out = [];
    const nowMs = Date.parse(input.time.nowIso);
    const wb = input.wallbox;
    if (wb) {
        const mode = (0, ev_energy_1.evManagementFromWallbox)(wb);
        const classes = (0, ev_energy_1.resolveEvEnergyClasses)(wb);
        if (mode === "externally_managed") {
            /* Reservierung separat; keine parallele EMS-EV-Energie. */
        }
        else if (mode === "unavailable" || classes.insufficientData) {
            /* Keine Fake-kWh. */
        }
        else if ((0, ev_energy_1.evEmsAllocates)(mode)) {
            const chargeMode = wb.evccChargeMode ?? null;
            const gridOk = chargeMode !== "pv" && chargeMode !== "off";
            const hardDeadlineMs = wb.deadlineIso ? Date.parse(wb.deadlineIso) : Number.POSITIVE_INFINITY;
            const base = {
                kind: "wallbox",
                maxPowerW: wb.maxChargePowerW,
                minPowerW: wb.minChargePowerW,
                gridEligible: gridOk,
                pvFirst: chargeMode === "pv" || chargeMode === "minpv" || chargeMode === null,
                batteryEligible: chargeMode !== "off",
                maxShiftHours: null,
                earliestSlotIdx: 0,
                thermalBeforeDeadline: false,
                thermalSoftOnly: false,
                slotAllowed: (slotStartIso) => (0, vehicle_availability_1.vehicleSlotAllocatable)(wb, slotStartIso),
            };
            if (classes.energyGoalHard && classes.hardRequiredEnergyKwh > exports.EPS) {
                out.push({
                    ...base,
                    consumerId: ev_energy_1.WALLBOX_HARD_CONSUMER_ID,
                    remainingKwh: classes.hardRequiredEnergyKwh,
                    deadlineMs: hardDeadlineMs,
                    mandatory: true,
                    energyGoalHard: true,
                });
            }
            if (classes.targetFlexEnergyKwh > exports.EPS) {
                out.push({
                    ...base,
                    consumerId: classes.hardRequiredEnergyKwh > exports.EPS ? ev_energy_1.WALLBOX_TARGET_CONSUMER_ID : ev_energy_1.WALLBOX_HARD_CONSUMER_ID,
                    remainingKwh: classes.targetFlexEnergyKwh,
                    deadlineMs: Number.POSITIVE_INFINITY,
                    mandatory: false,
                    energyGoalHard: false,
                });
            }
        }
    }
    const th = input.thermal;
    if (th &&
        ((th.headroomEnergyKwh !== null && th.headroomEnergyKwh > exports.EPS) ||
            th.boilerTempC != null ||
            th.hygieneDue === true)) {
        const emptyDeadlineMs = th.boilerEmptyAtUsable === true && th.estimatedEmptyAtIso
            ? Date.parse(th.estimatedEmptyAtIso)
            : Number.NaN;
        const nowMsLocal = Date.parse(input.time.nowIso);
        const fromIdx = Math.max(0, slots.findIndex((s) => s.startMs + 15 * 60_000 > nowMsLocal));
        const conf = pvConfidenceFactor(input);
        /** Fenster roh; Zuverlässigkeit nach nicht-thermischer Pflichtbindung. */
        const bound = hardPvBoundForPlanning(input, slots);
        const nextPv = (0, next_reliable_pv_1.findNextReliablePvAfterCurrentWindow)(slots, fromIdx, conf, nowMsLocal, bound);
        const windowEndIdx = (0, next_reliable_pv_1.findEndOfCurrentSurplusWindowIdx)(slots, fromIdx);
        const currentWindowEndMs = windowEndIdx > fromIdx && slots[windowEndIdx - 1]
            ? Date.parse(slots[windowEndIdx - 1].endIso)
            : null;
        const emptyMs = th.boilerEmptyAtUsable === true && th.estimatedEmptyAtIso
            ? Date.parse(th.estimatedEmptyAtIso)
            : Number.NaN;
        const bridge = (0, next_reliable_pv_1.resolveThermalPlannerEnergy)({
            nowMs: nowMsLocal,
            bufferTempC: th.bufferTempC,
            minTempC: th.boilerMinTempC ?? th.minTempC,
            boilerTempC: th.boilerTempC ?? null,
            boilerMinTempC: th.boilerMinTempC ?? th.minTempC,
            bufferMaxTempC: th.maxTempC,
            headroomEnergyKwh: th.headroomEnergyKwh,
            coolingRateCPerH: th.coolingRateCPerH,
            estimatedEmptyAtMs: Number.isFinite(emptyMs) ? emptyMs : null,
            boilerEmptyAtUsable: th.boilerEmptyAtUsable === true,
            boilerSensorDegraded: th.boilerSensorDegraded === true,
            hygieneMandatoryKwh: th.hygieneMandatoryKwh ?? 0,
            nextReliablePvMs: nextPv.startMs,
            currentWindowEndMs,
            pvConfidence01: conf,
        });
        const hardKwh = bridge.mandatoryEnergyKwh;
        const softKwh = bridge.economicHeadroomKwh;
        /*
         * Hard = Boiler (+ Hygiene), Deadline nur Boiler-emptyAt wenn usable.
         * Soft = Puffer-Headroom, keine Buffer-emptyAt-Urgency.
         */
        if (hardKwh > exports.EPS) {
            const hardDeadline = th.boilerEmptyAtUsable === true && Number.isFinite(emptyDeadlineMs)
                ? emptyDeadlineMs
                : Number.POSITIVE_INFINITY;
            out.push({
                consumerId: exports.IMMERSION_HARD_CONSUMER_ID,
                kind: "immersion_heater",
                remainingKwh: hardKwh,
                maxPowerW: th.availablePowerW,
                minPowerW: th.minPowerW ?? th.availablePowerW,
                deadlineMs: hardDeadline,
                mandatory: true,
                gridEligible: false,
                pvFirst: true,
                batteryEligible: true,
                energyGoalHard: th.emptyAtSource === "learned" || hardKwh > exports.EPS,
                maxShiftHours: null,
                earliestSlotIdx: 0,
                thermalBeforeDeadline: Number.isFinite(hardDeadline),
                thermalSoftOnly: false,
            });
        }
        if (softKwh > exports.EPS) {
            out.push({
                consumerId: exports.IMMERSION_SOFT_CONSUMER_ID,
                kind: "immersion_heater",
                remainingKwh: softKwh,
                maxPowerW: th.availablePowerW,
                minPowerW: th.minPowerW ?? th.availablePowerW,
                deadlineMs: Number.POSITIVE_INFINITY,
                mandatory: false,
                gridEligible: false,
                pvFirst: true,
                batteryEligible: false,
                energyGoalHard: false,
                maxShiftHours: null,
                earliestSlotIdx: 0,
                thermalBeforeDeadline: false,
                thermalSoftOnly: true,
            });
        }
    }
    const cl = input.climate;
    if (cl) {
        const nowSlotStart = slots.find((s) => nowMs >= s.startMs && nowMs < Date.parse(s.endIso))?.startIso;
        for (const u of cl.units) {
            const maxW = u.typicalPowerW;
            if (maxW === null || !(maxW > 0))
                continue;
            const slotEnergy = energyFromPowerW(maxW);
            const isMandatory = u.mandatoryComfort === true;
            let need = u.expectedEnergyKwh ?? (isMandatory ? slotEnergy * 4 : 0);
            if (need <= exports.EPS)
                continue;
            /*
             * Pflicht-Komfort: kein künstliches now+2h-Deadline-Hard-Cutoff
             * (sonst 00:05-Plan mit Slots ab 06:00 → 0 Klima). Urgency nur über Score.
             * Runtime-Hold: keine zusätzliche Flex-Allocation im NOW-Slot.
             */
            out.push({
                consumerId: u.unitId,
                kind: "climate",
                remainingKwh: need,
                maxPowerW: maxW,
                minPowerW: null,
                deadlineMs: Number.POSITIVE_INFINITY,
                mandatory: isMandatory,
                gridEligible: isMandatory,
                pvFirst: !isMandatory,
                /** Pflicht- und Flex-Klima konkurrieren um usableBatteryEnergy. */
                batteryEligible: true,
                energyGoalHard: isMandatory,
                maxShiftHours: u.maxShiftHours,
                earliestSlotIdx: 0,
                thermalBeforeDeadline: false,
                thermalSoftOnly: false,
                slotAllowed: u.runtimeHold === true && nowSlotStart
                    ? (slotStartIso) => slotStartIso !== nowSlotStart
                    : undefined,
            });
        }
    }
    const bat = input.battery;
    const cap = bat.usableCapacityKwh;
    const socPct = bat.socPct;
    if (cap !== null && cap > 0 && socPct !== null && bat.allowedModes.includes("charge")) {
        const policy = (0, mode_policy_1.plannerModePolicyFromGlobalMode)(input.globalMode);
        /*
         * Befund 004: dynamisches Endziel aus Contribution (`endSocTargetPct`) —
         * nicht pauschal Mode-Policy 90/95/100. Explizites requiredChargeEnergyKwh=0
         * bedeutet „kein Soft-SOC-Nachladen“ (nur Reserve-Lücke bleibt Pflicht).
         */
        const endSoc = bat.endSocTargetPct != null && Number.isFinite(bat.endSocTargetPct)
            ? bat.endSocTargetPct
            : policy.chargeTargetSocPct;
        const targetKwh = cap * (endSoc / 100);
        const reservePct = bat.reserveSocPct ?? bat.minSocPct ?? 0;
        const minReserve = cap * (reservePct / 100);
        const nightReserve = bat.nightReserveKwh !== null && bat.nightReserveKwh > exports.EPS ? bat.nightReserveKwh : 0;
        const reserveKwh = Math.max(minReserve, nightReserve);
        const socKwh = (socPct / 100) * cap;
        let chargeNeed = 0;
        if (bat.requiredChargeEnergyKwh === 0) {
            chargeNeed = 0;
        }
        else if (bat.requiredChargeEnergyKwh !== null && bat.requiredChargeEnergyKwh > exports.EPS) {
            chargeNeed = bat.requiredChargeEnergyKwh;
        }
        else {
            chargeNeed = Math.max(0, targetKwh - socKwh);
        }
        if (socKwh < reserveKwh - exports.EPS) {
            chargeNeed = Math.max(chargeNeed, reserveKwh - socKwh);
        }
        if (chargeNeed > exports.EPS) {
            const deadlineMs = bat.chargeDeadlineIso
                ? Date.parse(bat.chargeDeadlineIso)
                : Number.POSITIVE_INFINITY;
            const chargeEff = bat.chargeEfficiency ?? 1;
            const reserveGap = socKwh < reserveKwh - exports.EPS;
            const deficitNeed = bat.requiredChargeEnergyKwh !== null && bat.requiredChargeEnergyKwh > exports.EPS;
            out.push({
                consumerId: "battery",
                kind: "battery_charge",
                remainingKwh: chargeNeed / Math.max(chargeEff, 0.1),
                maxPowerW: bat.maxChargePowerW,
                minPowerW: null,
                deadlineMs,
                mandatory: reserveGap || deficitNeed,
                /** Soft SOC-Ziel nur PV; Netz nur bei Reserve-/Defizit-Pflicht. */
                gridEligible: bat.gridChargeAllowed && (reserveGap || deficitNeed),
                pvFirst: true,
                batteryEligible: false,
                energyGoalHard: deficitNeed,
                maxShiftHours: null,
                earliestSlotIdx: 0,
                thermalBeforeDeadline: false,
                thermalSoftOnly: false,
            });
        }
    }
    for (const o of input.otherFlex) {
        const need = o.requiredEnergyKwh ?? 0;
        if (need <= exports.EPS)
            continue;
        const deadlineMs = o.deadlineIso ? Date.parse(o.deadlineIso) : Number.POSITIVE_INFINITY;
        out.push({
            consumerId: o.consumerId,
            kind: o.kind,
            remainingKwh: need,
            maxPowerW: o.maxPowerW,
            minPowerW: o.minPowerW,
            deadlineMs,
            mandatory: false,
            gridEligible: o.gridEligible,
            pvFirst: o.pvFirst,
            batteryEligible: false,
            energyGoalHard: false,
            maxShiftHours: null,
            earliestSlotIdx: 0,
            thermalBeforeDeadline: false,
            thermalSoftOnly: false,
            slotAllowed: o.availableWindows.length
                ? (slotStartIso) => o.availableWindows.some((w) => w.startIso === slotStartIso)
                : undefined,
        });
    }
    return out;
}
function maxChunkKwh(consumer, slot) {
    let chunk = consumer.remainingKwh;
    if (consumer.maxPowerW !== null && consumer.maxPowerW > 0) {
        chunk = Math.min(chunk, energyFromPowerW(consumer.maxPowerW));
    }
    return chunk;
}
function applyMinPower(take, minW, available, remainingCap) {
    if (take <= exports.EPS)
        return 0;
    const capped = Math.min(take, remainingCap);
    if (minW && minW > 0) {
        const minE = energyFromPowerW(minW);
        if (capped + exports.EPS < minE) {
            // Nie über remaining aufblasen — sonst gewinnt der Kandidat im Score,
            // apply verwirft ihn (Partial < Stufe) und die Iteration stagniert.
            return 0;
        }
        if (available + exports.EPS < minE)
            return 0;
    }
    return capped;
}
/** Rest unter Mindestleistung ist nicht ausführbar → Consumer aus der Auswahl nehmen. */
function dropSubMinRemainder(consumers) {
    for (const c of consumers) {
        if (c.minPowerW === null || !(c.minPowerW > 0) || c.remainingKwh <= exports.EPS)
            continue;
        if (c.remainingKwh + exports.EPS < energyFromPowerW(c.minPowerW)) {
            c.remainingKwh = 0;
        }
    }
}
function horizonHours(slots) {
    if (slots.length === 0)
        return 24;
    const a = slots[0].startMs;
    const b = slots[slots.length - 1].startMs + exports.SLOT_H * 3600_000;
    return Math.max(1, (b - a) / 3600_000);
}
function slotUrgency(deadlineMs, slotStartMs, horizonH) {
    if (!Number.isFinite(deadlineMs))
        return 0;
    const hoursLeft = (deadlineMs - slotStartMs) / 3600_000;
    if (hoursLeft <= 0)
        return 2;
    return Math.max(0, 1.5 - hoursLeft / Math.max(horizonH, 6));
}
function ctCostPerKwh(importCt) {
    if (importCt === null || !Number.isFinite(importCt))
        return 0.35;
    return importCt * 0.01;
}
function peakFutureImportCt(state, fromSlotIdx) {
    let peak = 0;
    for (let i = fromSlotIdx; i < state.slots.length; i++) {
        const ct = state.slots[i].importCt;
        if (ct !== null && ct > peak)
            peak = ct;
    }
    return peak > 0 ? peak : 35;
}
/**
 * Gemeinsame Verdrängungskosten: wenn dieser Consumer den aktuellen (günstigen)
 * Slot nicht bekommt, wie viel Restenergie in teurere Slots kippt.
 * Kein EV-Sonderpfad — gilt für Wallbox und Batterie-Charge.
 */
function gridSpillCostEur(state, consumer, slotIdx, takeKwh) {
    const slot = state.slots[slotIdx];
    if (!slot || slot.importCt == null)
        return 0;
    const leftover = Math.max(0, consumer.remainingKwh - takeKwh);
    if (leftover <= exports.EPS)
        return 0;
    const maxSlotE = consumer.maxPowerW && consumer.maxPowerW > 0 ? energyFromPowerW(consumer.maxPowerW) : leftover;
    let cheapCap = 0;
    let expensiveCt = null;
    for (let i = 0; i < state.slots.length; i++) {
        if (i === slotIdx)
            continue;
        const s = state.slots[i];
        if (s.startMs < state.nowMs - 60_000)
            continue;
        if (s.startMs >= consumer.deadlineMs)
            continue;
        if (!s.gridAllowed || s.importCt == null)
            continue;
        if (s.evGridReserved && consumer.kind !== "wallbox")
            continue;
        if (consumer.slotAllowed && !consumer.slotAllowed(s.startIso))
            continue;
        if (s.importCt <= slot.importCt + 1e-6)
            cheapCap += maxSlotE;
        else
            expensiveCt = expensiveCt == null ? s.importCt : Math.min(expensiveCt, s.importCt);
    }
    const spill = Math.max(0, leftover - cheapCap);
    if (spill <= exports.EPS)
        return 0;
    /*
     * Teurere Slots vor der Deadline: echte Verdrängung.
     * Keine teureren Slots mehr vor der Deadline (Rest wäre unplatziert):
     * Peak-Import im Horizont als implizite Fehlmengen-/Opportunitätskosten —
     * sonst wäre ein harter Batterie-/EV-Slot gegen weiche große Chunks unsichtbar.
     */
    let displCt = expensiveCt;
    if (displCt == null) {
        const peak = peakFutureImportCt(state, slotIdx);
        if (peak > slot.importCt + 1e-6)
            displCt = peak;
    }
    if (displCt == null)
        return 0;
    return (spill * (displCt - slot.importCt)) / 100;
}
function laterCheapestGridCt(state, consumer, fromSlotIdx) {
    let minCt = null;
    for (let i = 0; i < state.slots.length; i++) {
        if (i === fromSlotIdx)
            continue;
        const s = state.slots[i];
        if (s.startMs < state.nowMs - 60_000)
            continue;
        if (s.startMs >= consumer.deadlineMs)
            continue;
        if (!s.gridAllowed || s.importCt == null)
            continue;
        if (s.evGridReserved && consumer.kind !== "wallbox")
            continue;
        if (consumer.slotAllowed && !consumer.slotAllowed(s.startIso))
            continue;
        minCt = minCt == null ? s.importCt : Math.min(minCt, s.importCt);
    }
    return minCt;
}
/**
 * Soft + grid-fähig: PV jetzt verbraucht Export, obwohl später billigeres Netz existiert.
 * Volume-Push (e×priority) darf das nicht überstimmen — gilt für Wallbox und Batterie-Charge.
 */
function softPvDeferToCheaperGridDelta(state, consumer, slot, slotIdx, energyKwh, priority, weights) {
    if (consumer.energyGoalHard || !consumer.gridEligible)
        return 0;
    if (slot.exportCt == null)
        return 0;
    const laterGridCt = laterCheapestGridCt(state, consumer, slotIdx);
    if (laterGridCt == null || !(slot.exportCt > laterGridCt + 1e-6))
        return 0;
    const oppEur = energyKwh * ((slot.exportCt - laterGridCt) / 100) * weights.costWeight * 2.8;
    const volumePush = energyKwh * priority * 0.38;
    return -(oppEur + volumePush);
}
/**
 * Opportunity-Kosten einer Batterie-kWh jetzt (zeitabhängig bis PV-Recovery):
 * Ersatzkosten bis Recovery (niedrig bei starker PV, hoch bei Knappheit) + Roundtrip + Zyklus.
 * Verhindert „Batterie für Klima → PV exportieren“-Arbitrage, erlaubt aber Flex-Einsatz
 * wenn die kWh bald günstig wiederbeschafft werden kann.
 */
function batteryDischargeOpportunityScore(state, slotIdx, energyKwh, weights) {
    const slot = state.slots[slotIdx];
    const replacementCt = state.reserveFloor.replacementCtBySlot[slotIdx] ?? peakFutureImportCt(state, slotIdx);
    const peakCt = peakFutureImportCt(state, slotIdx);
    /*
     * Knappheit: wenn Ersatz ≈ Peak-Import, volle Vermeidungskosten.
     * Starke Recovery (niedrige replacementCt): kWh weniger wertvoll → mehr Flex-Freigabe.
     */
    const effectiveCt = Math.min(peakCt, Math.max(replacementCt, replacementCt * 0.5 + peakCt * 0.15));
    const replaceEur = (effectiveCt * 0.01) / Math.max(state.dischargeEff, 0.1);
    const roundtripFactor = Math.max(0, 1 - state.chargeEff * state.dischargeEff);
    const roundtripEur = replaceEur * roundtripFactor;
    const cycleEur = 0.05 * Math.max(0.05, weights.batteryCyclePenalty);
    const exportNowEur = exportOpportunityPerKwh(slot.exportCt);
    const modeMult = weights.batteryCyclePenalty >= 0.3 ? 1.35 : weights.batteryCyclePenalty <= 0.08 ? 0.85 : 1.0;
    const oppEur = Math.max(replaceEur + roundtripEur + cycleEur, exportNowEur + cycleEur + 0.02);
    return energyKwh * oppEur * weights.costWeight * 1.15 * modeMult;
}
function exportOpportunityPerKwh(exportCt) {
    if (exportCt === null || !Number.isFinite(exportCt))
        return 0.06;
    return exportCt * 0.01;
}
function pvBeforeDeadlineKwh(state, deadlineMs, slotAllowed) {
    let sum = 0;
    for (const s of state.slots) {
        if (s.startMs >= deadlineMs)
            break;
        if (slotAllowed && !slotAllowed(s.startIso))
            continue;
        sum += s.remainPvKwh;
    }
    return sum;
}
/** Verbleibende lieferbare PV-Kapazität vor Deadline vs. Restbedarf (Starvation-Druck). */
function thermalFeasibility(state, consumer) {
    const minE = consumer.minPowerW && consumer.minPowerW > 0 ? energyFromPowerW(consumer.minPowerW) : 0.05;
    const maxSlotE = consumer.maxPowerW && consumer.maxPowerW > 0 ? energyFromPowerW(consumer.maxPowerW) : minE;
    let capKwh = 0;
    let slotsN = 0;
    let peakRemainPv = 0;
    for (const s of state.slots) {
        if (s.startMs < state.nowMs - 60_000)
            continue;
        if (s.startMs >= consumer.deadlineMs)
            break;
        if (consumer.slotAllowed && !consumer.slotAllowed(s.startIso))
            continue;
        peakRemainPv = Math.max(peakRemainPv, s.remainPvKwh);
        const add = Math.min(maxSlotE, s.remainPvKwh);
        if (add + exports.EPS >= minE) {
            capKwh += add;
            slotsN += 1;
        }
    }
    const pressure = consumer.remainingKwh / Math.max(capKwh, exports.EPS);
    return { capKwh, pressure, peakRemainPv, slotsN };
}
/** Bewertet einen Einzel-Kandidaten (höher = besser). -Infinity = hart unzulässig. */
function scoreCandidate(input, state, candidate, weights) {
    const slot = state.slots[candidate.slotIdx];
    if (!slot || candidate.energyKwh <= exports.EPS)
        return -Infinity;
    const consumer = state.consumers.find((c) => c.consumerId === candidate.consumerId);
    if (!consumer || consumer.remainingKwh <= exports.EPS)
        return -Infinity;
    if (consumer.slotAllowed && !consumer.slotAllowed(slot.startIso))
        return -Infinity;
    if (slot.startMs >= consumer.deadlineMs)
        return -Infinity;
    if (candidate.slotIdx < consumer.earliestSlotIdx)
        return -Infinity;
    if (candidate.kind === "battery_discharge")
        return -Infinity;
    if (candidate.source === "grid") {
        if (!slot.gridAllowed || slot.importCt === null)
            return -Infinity;
        if (!consumer.gridEligible)
            return -Infinity;
        if (!weights.allowOptimization && input.globalMode === "off")
            return -Infinity;
    }
    if (candidate.source === "pv_surplus") {
        if (slot.remainPvKwh + exports.EPS < candidate.energyKwh)
            return -Infinity;
        if (candidate.kind === "battery_charge" && !weights.allowPvCharge)
            return -Infinity;
    }
    if (candidate.source === "battery") {
        if (!state.passiveBatteryEnergyAvailable)
            return -Infinity;
        if (!consumer.batteryEligible)
            return -Infinity;
        if (!weights.allowOptimization)
            return -Infinity;
        const floor = dischargeFloorKwh(state, candidate.slotIdx);
        const draw = candidate.energyKwh / Math.max(state.dischargeEff, 0.1);
        const socAt = projectedSocAt(state, candidate.slotIdx);
        if (socAt - draw < floor - exports.EPS)
            return -Infinity;
        const usable = (0, battery_reserve_floor_1.usableBatteryEnergyKwh)(socAt, floor, state.dischargeEff);
        if (usable + exports.EPS < candidate.energyKwh)
            return -Infinity;
        /*
         * Keine Batterie-Entladung solange derselbe Slot noch PV-Surplus hat —
         * sonst entsteht künstliche Export-Arbitrage (PV einspeisen, Klima aus Batterie).
         */
        const need = Math.min(candidate.energyKwh, consumer.remainingKwh);
        if (slot.remainPvKwh + exports.EPS >= need)
            return -Infinity;
        /*
         * Wallbox: in PV-Surplus-Slots nicht aus Batterie (auch wenn remainPv schon
         * von battery_charge verbraucht wurde — sonst Roundtrip statt Direktladung).
         */
        if (candidate.kind === "wallbox" && slot.surplusKwh > 0.05)
            return -Infinity;
    }
    if (state.batteryHold && candidate.kind === "battery_charge")
        return -Infinity;
    if (candidate.source === "grid" && candidate.kind === "battery_charge" && slot.evGridReserved) {
        return -Infinity;
    }
    if (candidate.kind === "immersion_heater" &&
        candidate.source !== "pv_surplus" &&
        candidate.source !== "battery") {
        return -Infinity;
    }
    if (candidate.kind === "immersion_heater" && !weights.allowThermalAuto)
        return -Infinity;
    const e = Math.min(candidate.energyKwh, consumer.remainingKwh);
    const slotMs = slot.startMs;
    const horizonH = horizonHours(state.slots);
    const urg = slotUrgency(consumer.deadlineMs, slotMs, horizonH);
    let priority = 0.85;
    if (candidate.kind === "wallbox") {
        priority = consumer.energyGoalHard ? 4.2 * weights.vehicleUrgencyBoost : 1.15 * weights.vehicleUrgencyBoost;
    }
    else if (candidate.kind === "climate" && consumer.mandatory) {
        priority = 2.6 * weights.comfortWeight;
    }
    else if (candidate.kind === "immersion_heater") {
        if (consumer.thermalBeforeDeadline) {
            priority = 1.75 * weights.thermalDeadlineWeight;
        }
        else if (consumer.thermalSoftOnly) {
            /** Soft: Peer zu Flex/Batterie-Charge — Wirtschaftlichkeit im Score, nicht Komfort-Boost. */
            priority = 1.0 * weights.flexShiftWeight;
        }
        else {
            priority = 1.25 * weights.comfortWeight;
        }
    }
    else if (candidate.kind === "battery_charge") {
        priority =
            state.socKwh < state.reserveKwh - exports.EPS
                ? 2.1 * weights.reserveProtectWeight
                : 1.05 * weights.socTargetWeight;
    }
    else if (candidate.kind === "climate") {
        priority = 0.95 * weights.flexShiftWeight;
    }
    let score = e * priority * 0.38;
    /*
     * Deadline-Urgency: globaler Restbedarf (nicht Slot-Nähe zur Deadline).
     * Sonst gewinnen teure Spät-Slots gegen günstige Früh-Slots.
     */
    const needUrgency = Number.isFinite(consumer.deadlineMs)
        ? Math.max(0.15, Math.min(1.8, consumer.remainingKwh / Math.max(e, 0.25)))
        : 0;
    if (candidate.source !== "grid") {
        score += e * urg * weights.deadlineWeight * (consumer.energyGoalHard ? 0.5 : 0.12);
    }
    else {
        score += e * needUrgency * 0.08 * weights.deadlineWeight;
    }
    if (candidate.kind === "wallbox") {
        const pvRem = pvBeforeDeadlineKwh(state, consumer.deadlineMs, consumer.slotAllowed);
        const safePv = pvRem * state.pvConfidence;
        if (consumer.energyGoalHard &&
            candidate.source === "grid" &&
            state.pvConfidence >= 0.7 &&
            safePv + exports.EPS >= consumer.remainingKwh) {
            score -= e * 4.5 * weights.costWeight;
        }
        else if (candidate.source === "grid" && state.pvConfidence >= 0.7 && safePv > exports.EPS) {
            score -= e * Math.max(0, consumer.remainingKwh - safePv) * 0.05 * weights.costWeight;
        }
        if (candidate.source === "pv_surplus") {
            if (consumer.energyGoalHard) {
                score += e * 0.55 * weights.pvOpportunityWeight;
                if (pvRem > exports.EPS)
                    score += e * 0.25;
            }
            score += softPvDeferToCheaperGridDelta(state, consumer, slot, candidate.slotIdx, e, priority, weights);
        }
        if (consumer.energyGoalHard && state.pvConfidence < 0.7 && candidate.source === "grid") {
            score += e * (0.7 - state.pvConfidence) * weights.deadlineWeight * 0.35;
        }
        /** Netzbedarf: günstige Slots stark bevorzugen (marginale ct). */
        if (candidate.source === "grid" && slot.importCt !== null) {
            const deficit = Math.max(0, consumer.remainingKwh - safePv);
            if (consumer.energyGoalHard && (deficit > exports.EPS || state.pvConfidence < 0.7)) {
                score += e * 1.1 * weights.deadlineWeight;
            }
            score -= e * (slot.importCt / 100) * weights.costWeight * 2.8;
            score += gridSpillCostEur(state, consumer, candidate.slotIdx, e) * weights.costWeight * 2.2;
        }
    }
    if (candidate.kind === "immersion_heater") {
        if (consumer.thermalSoftOnly) {
            /*
             * Optionale Wärme (Bridge bis next-PV bereits gedeckt): kein Basis-Prioritäts-Push.
             * Wert skaliert mit post-PV-Kühlbrücke (emptyAt − Recovery): kurz → wenig Nutzen
             * für Target-Fill; lang (z. B. Leerung abends nach Morgen-PV) → Speichern sinnvoll.
             * Opportunity vs. PV→Batterie über gemeinsamen Peak-/SOC-Wert — kein Hardcode.
             */
            if (candidate.source !== "pv_surplus")
                return -Infinity;
            score -= e * priority * 0.38;
            const peakEur = peakFutureImportCt(state, candidate.slotIdx) * 0.01;
            const socAt = projectedSocAt(state, candidate.slotIdx);
            const batRoom = Math.max(0, Math.min(state.capacityKwh - socAt, state.batteryTargetKwh - socAt));
            const batConsumer = state.consumers.find((c) => c.kind === "battery_charge");
            const batStillWants = batConsumer != null && batConsumer.remainingKwh > 0.4;
            const recMs = state.nextReliablePvMs;
            const emptyMs = input.thermal?.estimatedEmptyAtIso
                ? Date.parse(input.thermal.estimatedEmptyAtIso)
                : Number.NaN;
            /*
             * Speichernutzen ohne emptyAt-Deadline-Urgency:
             * - emptyAt nach Recovery → Kühlbrücke danach (kurz = wenig Soft-Nutzen)
             * - emptyAt vor Recovery (typisch: reicht durch heutiges PV-Fenster, Nachtlücke)
             *   → Overnight-Shortfall skaliert Soft-Nutzen (PV jetzt speichern sinnvoll)
             */
            let bridgeH = 0;
            if (recMs != null && Number.isFinite(emptyMs)) {
                bridgeH =
                    emptyMs > recMs
                        ? (emptyMs - recMs) / 3600_000
                        : (recMs - emptyMs) / 3600_000;
            }
            const needScale = Math.max(0, Math.min(1, bridgeH / 10));
            /*
             * Kein fixer 0.25-Floor: bei needScale≈0 (Puffer hält über Recovery) kein Soft-Dump
             * gegen Export. Bei Overnight-Lücke (needScale hoch) wirtschaftlich speichern.
             */
            const storeEur = peakEur * weights.costWeight * (0.85 * needScale - 0.05);
            score += e * storeEur;
            if (batRoom > 0.4 || batStillWants) {
                /** Bei Overnight-Lücke (needScale hoch) Soft weniger gegen Batterie abstrafen. */
                const batPen = 0.65 * (1 - 0.55 * needScale);
                score -= e * peakEur * weights.costWeight * weights.socTargetWeight * batPen;
            }
            else if (batRoom <= 0.4 && !batStillWants && needScale > 0.2) {
                /** Batterie satt + Speichernutzen: Soft belohnen (skaliert). */
                score += e * weights.flexShiftWeight * 0.42 * needScale;
            }
        }
        else if (consumer.thermalBeforeDeadline && slotMs < consumer.deadlineMs) {
            score += e * weights.thermalDeadlineWeight * 0.42;
            /*
             * Kontinuierliche Feasibility-Pressure (kein if pressure≥X-Sprung):
             * pressure = remaining / lieferbare PV-Kapazität vor Deadline.
             * slackWeight→1 bei viel Kapazität, tightWeight→1 bei Knappheit.
             */
            const feas = thermalFeasibility(state, consumer);
            const pressure = Math.max(0, feas.pressure);
            const slackWeight = 1 / (1 + pressure);
            const tightWeight = pressure / (1 + pressure);
            const hoursToDeadline = (consumer.deadlineMs - slotMs) / 3600_000;
            const slackH = Math.max(exports.SLOT_H, (consumer.deadlineMs - Math.max(slotMs, state.nowMs)) / 3600_000);
            const needH = consumer.remainingKwh / Math.max((consumer.maxPowerW ?? 1700) / 1000, exports.EPS);
            const timePressure = needH / slackH;
            /** Earliness relativ zur Deadline-Restzeit — keine feste Stundenkonstante. */
            const horizonToDeadlineMs = Math.max(exports.SLOT_H * 3600_000, consumer.deadlineMs - state.nowMs);
            const earliness = Math.max(0, 1 - (slotMs - state.nowMs) / horizonToDeadlineMs);
            if (hoursToDeadline > 1) {
                score +=
                    e *
                        slackWeight *
                        Math.min(1.0, hoursToDeadline / Math.max(horizonH, 8)) *
                        0.12;
            }
            score +=
                e *
                    weights.thermalDeadlineWeight *
                    tightWeight *
                    (0.55 * Math.min(2.0, pressure) +
                        0.35 * Math.min(2.0, timePressure) +
                        0.4 * earliness);
            if (slot.remainPvKwh > exports.EPS && feas.peakRemainPv > exports.EPS) {
                score -=
                    e * tightWeight * (slot.remainPvKwh / feas.peakRemainPv) * 0.15;
            }
        }
        if (!consumer.thermalSoftOnly) {
            if (slot.remainPvKwh > exports.EPS && slot.surplusKwh > exports.EPS) {
                score +=
                    e *
                        (slot.remainPvKwh / Math.max(slot.surplusKwh, exports.EPS)) *
                        weights.flexShiftWeight *
                        0.28;
            }
            /** Volle Mindeststufe belohnen. */
            if (consumer.minPowerW && e + exports.EPS >= energyFromPowerW(consumer.minPowerW)) {
                score += 0.08;
            }
            /*
             * Thermischer Flexspeicher: bei PV und Batterie über Reserve-Floor
             * Wärme vorladen → spätere elektrische Flexibilität. Bei hartem Fahrzeugziel
             * PV bewusst freigeben (kein festes Add-on-Ranking — Score).
             */
            if (candidate.source === "pv_surplus") {
                const floor = dischargeFloorKwh(state, candidate.slotIdx);
                const socAt = projectedSocAt(state, candidate.slotIdx);
                const batAboveFloor = socAt > floor + 0.5;
                const batNearTarget = state.batteryTargetKwh > exports.EPS && socAt + 0.25 >= state.batteryTargetKwh;
                const wbC = state.consumers.find((c) => c.kind === "wallbox");
                const hardVehicle = wbC != null && wbC.energyGoalHard && wbC.remainingKwh > 1.0;
                if (batAboveFloor && (batNearTarget || socAt >= state.capacityKwh * 0.8)) {
                    score += e * weights.flexShiftWeight * 0.42;
                }
                if (hardVehicle) {
                    score -= e * weights.vehicleUrgencyBoost * 0.65;
                }
            }
        }
        /** Live-NOW-Boost auch für Soft-Precharge (B1) — kein emptyAt-Deadline-Druck. */
        if (candidate.source === "pv_surplus") {
            const slotEndMs = Date.parse(slot.endIso);
            if (input.preferImmersionLiveSurplusNow === true &&
                Number.isFinite(slotEndMs) &&
                slotMs <= state.nowMs &&
                state.nowMs < slotEndMs) {
                score += e * weights.flexShiftWeight * 2.4 + 0.55;
            }
        }
    }
    if (candidate.kind === "climate") {
        if (consumer.mandatory) {
            const earliness = Math.max(0, 1 - (slotMs - state.nowMs) / (2 * 3600_000));
            score += e * weights.comfortWeight * (0.35 + earliness * 0.25);
        }
        else if (slot.remainPvKwh > exports.EPS) {
            const pvRich = slot.remainPvKwh / Math.max(energyFromPowerW(consumer.maxPowerW ?? 900), exports.EPS);
            score += e * Math.min(1.2, pvRich) * weights.flexShiftWeight * 0.22;
        }
    }
    if (candidate.kind === "battery_charge") {
        const socBefore = projectedSocAt(state, candidate.slotIdx);
        const room = state.batteryTargetKwh - socBefore;
        if (room > exports.EPS) {
            score += e * (Math.min(e, room) / room) * weights.socTargetWeight * 0.28;
        }
        if (socBefore < state.reserveKwh - exports.EPS) {
            score += e * weights.reserveProtectWeight * 0.35;
        }
        if (candidate.source === "pv_surplus" && weights.batterySurplusMinFactor > 1) {
            const pvRatio = slot.remainPvKwh / Math.max(slot.surplusKwh, exports.EPS);
            if (pvRatio < 0.5)
                score -= e * (weights.batterySurplusMinFactor - 1) * 0.12;
        }
        if (candidate.source === "pv_surplus") {
            score += softPvDeferToCheaperGridDelta(state, consumer, slot, candidate.slotIdx, e, priority, weights);
        }
        if (candidate.source === "grid" && socBefore >= state.reserveKwh - exports.EPS) {
            score -= e * 0.06 * weights.costWeight;
        }
        if (candidate.source === "grid") {
            score += gridSpillCostEur(state, consumer, candidate.slotIdx, e) * weights.costWeight * 2.2;
        }
    }
    if (candidate.source === "grid" && candidate.kind !== "wallbox") {
        score -= e * ctCostPerKwh(slot.importCt) * weights.costWeight;
    }
    if (candidate.source === "pv_surplus") {
        score -= e * exportOpportunityPerKwh(slot.exportCt) * weights.pvOpportunityWeight;
    }
    if (candidate.source === "battery") {
        score -= batteryDischargeOpportunityScore(state, candidate.slotIdx, e, weights);
        /** Harte Deadlines: Batterie-Flex etwas belohnen, wenn Recovery die kWh ersetzt. */
        if (consumer.energyGoalHard || consumer.thermalBeforeDeadline) {
            const repl = state.reserveFloor.replacementCtBySlot[candidate.slotIdx] ?? 28;
            if (repl < 12)
                score += e * 0.22 * weights.deadlineWeight;
        }
    }
    if (candidate.conservativeGrid)
        score += e * 0.1 * weights.deadlineWeight;
    return score;
}
exports.scoreCandidate = scoreCandidate;
function reasonCodesForCandidate(input, candidate, state, wbPresenceCodes) {
    const codes = [];
    const slot = state.slots[candidate.slotIdx];
    if (candidate.kind === "wallbox") {
        codes.push(reason_codes_1.REASON.VEHICLE_PRESENCE_REQUIRED);
        if (!candidate.mandatory)
            codes.push(reason_codes_1.REASON.VEHICLE_TARGET_SOFT);
        if (candidate.source === "pv_surplus") {
            codes.push(reason_codes_1.REASON.PV_EXPECTED_BEFORE_DEADLINE, reason_codes_1.REASON.PV_SURPLUS_AVAILABLE, reason_codes_1.REASON.VEHICLE_PV_WINDOW_AVAILABLE);
            codes.push(...wbPresenceCodes.filter((c) => /predicted|explicit|available_now/.test(c)));
        }
        if (candidate.source === "grid") {
            codes.push(reason_codes_1.REASON.VEHICLE_IMPORT_WINDOW_AVAILABLE);
            if (candidate.mandatory)
                codes.push(reason_codes_1.REASON.VEHICLE_DEADLINE_REQUIRED);
            codes.push(candidate.conservativeGrid || state.pvConfidence < 0.7
                ? reason_codes_1.REASON.GRID_IMPORT_CONSERVATIVE_DEADLINE
                : reason_codes_1.REASON.GRID_IMPORT_COST_OPTIMAL);
        }
        if (candidate.source === "battery") {
            codes.push(reason_codes_1.REASON.BATTERY_FROM_RESERVE_FLEX);
            if (candidate.mandatory)
                codes.push(reason_codes_1.REASON.VEHICLE_DEADLINE_REQUIRED);
        }
    }
    if (candidate.kind === "immersion_heater") {
        codes.push(reason_codes_1.REASON.THERMAL_FLEX_AVAILABLE, reason_codes_1.REASON.MIN_POWER_SLOT);
        if (candidate.source === "pv_surplus")
            codes.push(reason_codes_1.REASON.PV_SURPLUS_AVAILABLE);
        if (candidate.source === "battery")
            codes.push(reason_codes_1.REASON.BATTERY_FROM_RESERVE_FLEX);
        const cons = state.consumers.find((c) => c.consumerId === candidate.consumerId);
        if (cons?.thermalBeforeDeadline &&
            Number.isFinite(cons.deadlineMs) &&
            slot.startMs < cons.deadlineMs) {
            codes.push(reason_codes_1.REASON.THERMAL_DEADLINE_PV_WINDOW);
        }
    }
    if (candidate.kind === "climate") {
        codes.push(reason_codes_1.REASON.CLIMATE_FLEX);
        if (candidate.source === "pv_surplus")
            codes.push(reason_codes_1.REASON.PV_SURPLUS_AVAILABLE);
        if (candidate.source === "grid")
            codes.push(reason_codes_1.REASON.GRID_IMPORT_COST_OPTIMAL);
        if (candidate.source === "battery")
            codes.push(reason_codes_1.REASON.BATTERY_FROM_RESERVE_FLEX);
    }
    if (candidate.kind === "battery_charge") {
        codes.push(reason_codes_1.REASON.BATTERY_SOC_TARGET, reason_codes_1.REASON.PV_SURPLUS_AVAILABLE);
        if (candidate.source === "grid") {
            codes.push(reason_codes_1.REASON.GRID_IMPORT_COST_OPTIMAL);
            const bat = input.battery;
            codes.push(bat.chargeDeadlineIso ? reason_codes_1.REASON.BATTERY_CHARGE_DEADLINE : reason_codes_1.REASON.BATTERY_RESERVE_PROTECTED);
        }
    }
    if (candidate.kind === "other") {
        codes.push(reason_codes_1.REASON.OTHER_FLEX, reason_codes_1.REASON.PV_SURPLUS_AVAILABLE);
    }
    return codes;
}
function constraintIdsForCandidate(candidate) {
    switch (candidate.kind) {
        case "wallbox":
            return candidate.source === "grid"
                ? ["wallbox.presence", "wallbox.energy_goal"]
                : ["wallbox.presence"];
        case "immersion_heater":
            return candidate.constraintIds.length
                ? candidate.constraintIds
                : ["thermal.flex"];
        case "climate":
            return candidate.mandatory ? ["climate.comfort"] : ["climate.flex"];
        case "battery_charge":
            return ["battery.limits"];
        default:
            return candidate.constraintIds;
    }
}
function generateCandidatesForConsumer(input, state, consumer, slotIdx, wbPresenceCodes, allocations, weights) {
    const slot = state.slots[slotIdx];
    if (consumer.remainingKwh <= exports.EPS)
        return [];
    if (consumer.slotAllowed && !consumer.slotAllowed(slot.startIso))
        return [];
    if (slot.startMs >= consumer.deadlineMs)
        return [];
    if (slotIdx < consumer.earliestSlotIdx)
        return [];
    /*
     * Soft-Precharge: laufenden Slot ohne Live-Prefer nicht anbrechen
     * (Mid-Slot-Restart / B1 — Prefer setzt den NOW-Boost bewusst).
     */
    if (consumer.kind === "immersion_heater" &&
        consumer.thermalSoftOnly &&
        slot.startMs < state.nowMs &&
        input.preferImmersionLiveSurplusNow !== true) {
        return [];
    }
    const already = alreadyAllocatedForConsumer(allocations, consumer, slot.startIso);
    if (consumer.maxPowerW !== null && consumer.maxPowerW > 0) {
        const headroom = energyFromPowerW(consumer.maxPowerW) - already;
        if (headroom <= exports.EPS)
            return [];
    }
    let chunk = maxChunkKwh(consumer, slot);
    if (consumer.maxPowerW !== null && consumer.maxPowerW > 0) {
        chunk = Math.min(chunk, Math.max(0, energyFromPowerW(consumer.maxPowerW) - already));
    }
    if (chunk <= exports.EPS)
        return [];
    const out = [];
    const sources = [];
    /*
     * PV-Surplus für alle Flex-Verbraucher inkl. Wallbox (auch Modus now) —
     * sonst Grid-Strafe „PV reicht vor Deadline“ ohne PV-Kandidat → Ziel unerreicht.
     */
    if (slot.remainPvKwh > exports.EPS)
        sources.push("pv_surplus");
    if (consumer.gridEligible && slot.gridAllowed && slot.importCt !== null) {
        const mutexBattery = consumer.kind === "wallbox" && batteryGridInSlotKwh(allocations, slot.startIso) > exports.EPS;
        const mutexEv = consumer.kind === "battery_charge" &&
            (slot.evGridReserved || wallboxGridInSlotKwh(allocations, slot.startIso) > exports.EPS);
        if (!mutexBattery && !mutexEv)
            sources.push("grid");
    }
    const batFloor = dischargeFloorKwh(state, slotIdx);
    const usableBat = (0, battery_reserve_floor_1.usableBatteryEnergyKwh)(projectedSocAt(state, slotIdx), batFloor, state.dischargeEff);
    if (consumer.batteryEligible &&
        usableBat > exports.EPS &&
        // PV im Slot deckt den Chunk → keine Batterie-Kandidaten (Export-Arbitrage).
        slot.remainPvKwh + exports.EPS < Math.min(chunk, consumer.remainingKwh)) {
        sources.push("battery");
    }
    if (consumer.kind === "immersion_heater") {
        sources.length = 0;
        const minE = consumer.minPowerW && consumer.minPowerW > 0 ? energyFromPowerW(consumer.minPowerW) : 0;
        // Keine Teil-Slots unter Mindeststufe (sonst Runtime stage 0).
        if (slot.remainPvKwh + exports.EPS >= Math.max(minE, exports.EPS))
            sources.push("pv_surplus");
        const pvBeforeDl = pvBeforeDeadlineKwh(state, consumer.deadlineMs, consumer.slotAllowed);
        const thermalNeedsBattery = consumer.thermalBeforeDeadline &&
            pvBeforeDl + exports.EPS < consumer.remainingKwh &&
            usableBat + exports.EPS >= Math.max(minE, exports.EPS) &&
            slot.remainPvKwh + exports.EPS < Math.max(minE, exports.EPS);
        if (thermalNeedsBattery)
            sources.push("battery");
    }
    if (consumer.kind === "battery_charge") {
        sources.length = 0;
        if (slot.remainPvKwh > exports.EPS && state.modePolicy.allowPvCharge)
            sources.push("pv_surplus");
        if (consumer.gridEligible &&
            slot.gridAllowed &&
            slot.importCt !== null &&
            !slot.evGridReserved &&
            wallboxGridInSlotKwh(allocations, slot.startIso) <= exports.EPS) {
            sources.push("grid");
        }
    }
    for (const source of sources) {
        let take = chunk;
        if (source === "pv_surplus") {
            take = Math.min(take, slot.remainPvKwh);
            take = applyMinPower(take, consumer.minPowerW, slot.remainPvKwh, consumer.remainingKwh);
        }
        else if (source === "battery") {
            take = Math.min(take, usableBat);
            take = applyMinPower(take, consumer.minPowerW, take, consumer.remainingKwh);
        }
        else {
            take = applyMinPower(take, consumer.minPowerW, take, consumer.remainingKwh);
        }
        if (take <= exports.EPS)
            continue;
        if (consumer.minPowerW &&
            consumer.minPowerW > 0 &&
            take + exports.EPS < energyFromPowerW(consumer.minPowerW)) {
            continue;
        }
        const conservativeGrid = consumer.kind === "wallbox" &&
            source === "grid" &&
            consumer.energyGoalHard &&
            state.pvConfidence < 0.7;
        const base = {
            slotIdx,
            consumerId: consumer.consumerId,
            kind: consumer.kind,
            energyKwh: take,
            source,
            constraintIds: [],
            reasonCodes: [],
            maxPowerW: consumer.maxPowerW,
            deadlineMs: consumer.deadlineMs,
            mandatory: consumer.mandatory,
            conservativeGrid,
        };
        base.reasonCodes = reasonCodesForCandidate(input, base, state, wbPresenceCodes);
        base.constraintIds = constraintIdsForCandidate(base);
        if (consumer.kind === "immersion_heater" && consumer.thermalBeforeDeadline) {
            if (slot.startMs < consumer.deadlineMs) {
                base.constraintIds = ["thermal.flex", "thermal.deadline"];
            }
        }
        out.push(base);
    }
    return out;
}
/** @returns true wenn Energie tatsächlich verbucht wurde. */
function applyCandidate(state, candidate, allocations) {
    const slot = state.slots[candidate.slotIdx];
    const consumer = state.consumers.find((c) => c.consumerId === candidate.consumerId);
    if (!consumer)
        return false;
    const already = alreadyAllocatedForConsumer(allocations, consumer, slot.startIso);
    let e = candidate.energyKwh;
    if (candidate.maxPowerW !== null && candidate.maxPowerW > 0) {
        e = Math.min(e, Math.max(0, energyFromPowerW(candidate.maxPowerW) - already));
    }
    e = Math.min(e, consumer.remainingKwh);
    if (e <= exports.EPS)
        return false;
    if (consumer.minPowerW &&
        consumer.minPowerW > 0 &&
        already <= exports.EPS &&
        e + exports.EPS < energyFromPowerW(consumer.minPowerW)) {
        return false;
    }
    if (candidate.source === "pv_surplus") {
        e = takePv(slot, e);
    }
    else if (candidate.source === "battery") {
        const draw = e / Math.max(state.dischargeEff, 0.1);
        const floor = dischargeFloorKwh(state, candidate.slotIdx);
        const socAt = projectedSocAt(state, candidate.slotIdx);
        if (socAt - draw < floor - exports.EPS)
            return false;
        state.socDeltaBySlot[candidate.slotIdx] =
            (state.socDeltaBySlot[candidate.slotIdx] ?? 0) - draw;
        syncFinalSoc(state);
    }
    else if (candidate.source === "grid") {
        if (candidate.kind === "wallbox" && batteryGridInSlotKwh(allocations, slot.startIso) > exports.EPS) {
            return false;
        }
        if (candidate.kind === "battery_charge" &&
            (slot.evGridReserved || wallboxGridInSlotKwh(allocations, slot.startIso) > exports.EPS)) {
            return false;
        }
    }
    if (e <= exports.EPS)
        return false;
    if (consumer.minPowerW &&
        consumer.minPowerW > 0 &&
        already <= exports.EPS &&
        e + exports.EPS < energyFromPowerW(consumer.minPowerW)) {
        if (candidate.source === "pv_surplus")
            slot.remainPvKwh += e;
        return false;
    }
    const booked = pushAlloc(allocations, slot, candidate.consumerId, candidate.kind, e, candidate.source, candidate.constraintIds, candidate.reasonCodes, candidate.maxPowerW);
    if (booked <= exports.EPS) {
        if (candidate.source === "pv_surplus")
            slot.remainPvKwh += e;
        return false;
    }
    if (booked + exports.EPS < e && candidate.source === "pv_surplus") {
        slot.remainPvKwh += e - booked;
    }
    e = booked;
    if (candidate.kind === "battery_charge") {
        const stored = e * state.chargeEff;
        const socBefore = projectedSocAt(state, candidate.slotIdx);
        const room = Math.max(0, state.capacityKwh - socBefore);
        const storedClamped = Math.min(stored, room);
        state.socDeltaBySlot[candidate.slotIdx] =
            (state.socDeltaBySlot[candidate.slotIdx] ?? 0) + storedClamped;
        syncFinalSoc(state);
    }
    if (candidate.kind === "wallbox" && candidate.source === "grid") {
        slot.evGridReserved = true;
    }
    consumer.remainingKwh = Math.max(0, consumer.remainingKwh - e);
    dropSubMinRemainder([consumer]);
    return true;
}
function buildGoals(input, state, reasonCodes) {
    const goals = [];
    const wb = input.wallbox;
    if (wb) {
        const mode = (0, ev_energy_1.evManagementFromWallbox)(wb);
        const need = resolveVehicleNeedKwh(input);
        const remaining = state.consumers
            .filter((c) => c.kind === "wallbox")
            .reduce((a, c) => a + c.remainingKwh, 0);
        if (mode === "externally_managed") {
            goals.push({
                consumerId: "wallbox",
                goalId: "energy",
                met: true,
                detailDe: "Fahrzeug extern verwaltet — kein konkurrierender EMS-Ladeplan.",
            });
        }
        else if (mode === "unavailable" || need === null || need <= exports.EPS) {
            goals.push({
                consumerId: "wallbox",
                goalId: "energy",
                met: true,
                detailDe: mode === "unavailable"
                    ? "Fahrzeug nicht verfügbar — keine EV-Planung."
                    : "Kein Fahrzeug-Energiebedarf.",
            });
        }
        else {
            const feasibility = (0, vehicle_availability_1.evaluateVehicleGoalFeasibility)(input);
            for (const c of feasibility.reasonCodes)
                reasonCodes.push(c);
            const classes = (0, ev_energy_1.resolveEvEnergyClasses)(wb);
            const met = feasibility.status === "unreachable"
                ? false
                : feasibility.status === "at_risk" || feasibility.status === "at_risk_unknown"
                    ? null
                    : remaining <= 0.05;
            const prefix = mode === "takeover_candidate" ? "Takeover-Kandidat: " : "";
            goals.push({
                consumerId: "wallbox",
                goalId: classes.energyGoalHard ? "energy_deadline" : "energy",
                met,
                detailDe: feasibility.status === "unreachable"
                    ? `${prefix}Fahrzeugziel physisch unerreichbar (max ~${feasibility.maxFeasibleEnergyKwh.toFixed(2)} kWh).`
                    : feasibility.status === "at_risk_unknown"
                        ? `${prefix}Fahrzeugziel unsicher wegen unknown Presence.`
                        : feasibility.status === "at_risk"
                            ? `${prefix}Fahrzeugziel abhängig von predicted Presence.`
                            : remaining <= 0.05
                                ? `${prefix}Fahrzeugziel im Plan gedeckt.`
                                : `${prefix}Fahrzeugziel unvollständig, Rest ~${remaining.toFixed(2)} kWh.`,
            });
        }
    }
    const th = input.thermal;
    if (th) {
        const hardC = state.consumers.find((c) => c.consumerId === exports.IMMERSION_HARD_CONSUMER_ID);
        const softC = state.consumers.find((c) => c.consumerId === exports.IMMERSION_SOFT_CONSUMER_ID);
        const legacyC = state.consumers.find((c) => c.consumerId === "immersion_heater");
        const remaining = (hardC?.remainingKwh ?? 0) + (softC?.remainingKwh ?? 0) + (legacyC?.remainingKwh ?? 0);
        const headroom = th.headroomEnergyKwh ?? 0;
        if (headroom <= exports.EPS && remaining <= exports.EPS) {
            goals.push({
                consumerId: "immersion_heater",
                goalId: "thermal_day",
                met: true,
                detailDe: "Kein thermischer Headroom.",
            });
        }
        else {
            const bridgeRem = hardC?.remainingKwh ?? 0;
            const softRem = softC?.remainingKwh ?? legacyC?.remainingKwh ?? 0;
            const baseT = th.forecastTargetTempC ?? th.minTempC;
            const effT = th.dayTargetTempC;
            const prechargeNote = th.pvPrechargeActive === true && effT != null && baseT != null && effT > baseT + 0.15
                ? ` Basisziel ${baseT} °C, optionales Precharge-Ziel ${effT} °C.`
                : "";
            const parts = [];
            if (hardC) {
                parts.push(bridgeRem <= exports.EPS
                    ? "Hard-Bridge aus PV geplant"
                    : `Hard-Bridge Rest ~${bridgeRem.toFixed(2)} kWh`);
            }
            if (softC || (legacyC && !hardC)) {
                parts.push(softRem <= exports.EPS
                    ? "Soft-Precharge aus PV geplant"
                    : `Soft-Precharge Rest ~${softRem.toFixed(2)} kWh`);
            }
            goals.push({
                consumerId: "immersion_heater",
                goalId: "thermal_day",
                met: remaining <= Math.max(headroom, 0.01) * 0.15,
                detailDe: `${parts.join("; ") || "Thermisch"}.${prechargeNote}`,
            });
        }
    }
    return goals;
}
function rebuildPvActiveIndices(slots) {
    const out = [];
    for (let i = 0; i < slots.length; i++) {
        if (slots[i].remainPvKwh > exports.EPS)
            out.push(i);
    }
    return out;
}
/** Max. PV-Slots pro Consumer/Iteration (Beam) — hält CPU niedrig. */
const PV_BEAM = 20;
/**
 * Slot-Shortlist pro Consumer — kein voller Horizon-Scan jede Iteration.
 * PV: Top-Beam. Grid: ein bester Slot (Preis bzw. Frühe).
 */
function slotIndicesForConsumer(consumer, state, pvActive, allocations) {
    const slots = state.slots;
    const out = [];
    const seen = new Set();
    const push = (si) => {
        if (seen.has(si))
            return;
        seen.add(si);
        out.push(si);
    };
    const pvRanked = [];
    for (const si of pvActive) {
        const slot = slots[si];
        if (slot.startMs >= consumer.deadlineMs)
            continue;
        if (consumer.slotAllowed && !consumer.slotAllowed(slot.startIso))
            continue;
        let h = slot.remainPvKwh;
        if (consumer.kind === "climate" && consumer.mandatory) {
            h += Math.max(0, 2 - (slot.startMs - state.nowMs) / 3600_000);
        }
        else if (consumer.thermalBeforeDeadline && slot.startMs < consumer.deadlineMs) {
            h *= 1.25;
        }
        pvRanked.push({ si, h });
    }
    pvRanked.sort((a, b) => b.h - a.h || a.si - b.si);
    for (let i = 0; i < Math.min(PV_BEAM, pvRanked.length); i++) {
        push(pvRanked[i].si);
    }
    if (consumer.kind === "immersion_heater") {
        /*
         * Alle PV-Slots vor Deadline in die Shortlist (Peak-Beam allein reicht nicht).
         * Auswahl bleibt kontinuierlich über Score/Pressure — keine pressure≥X-Schwelle.
         */
        for (let si = 0; si < slots.length; si++) {
            const slot = slots[si];
            if (slot.startMs < state.nowMs - 60_000)
                continue;
            if (slot.startMs >= consumer.deadlineMs)
                break;
            if (slot.remainPvKwh > exports.EPS)
                push(si);
        }
        // Zusätzlich Batterie-Slots ohne PV, wenn Reserve-Floor Freiraum lässt.
        if (consumer.batteryEligible && projectedSocAt(state, 0) > floorKwhAt(state, 0) + exports.EPS) {
            let added = 0;
            for (let si = 0; si < slots.length && added < 10; si++) {
                const slot = slots[si];
                if (slot.startMs >= consumer.deadlineMs)
                    continue;
                if (slot.startMs < state.nowMs - 60_000)
                    continue;
                if (slot.remainPvKwh > exports.EPS)
                    continue; // PV-Slots bereits via Beam
                push(si);
                added++;
            }
        }
        return out;
    }
    if (consumer.gridEligible) {
        let bestSi = null;
        let bestKey = Number.POSITIVE_INFINITY;
        for (let si = 0; si < slots.length; si++) {
            const slot = slots[si];
            if (slot.startMs >= consumer.deadlineMs)
                continue;
            if (!slot.gridAllowed || slot.importCt === null)
                continue;
            if (consumer.slotAllowed && !consumer.slotAllowed(slot.startIso))
                continue;
            if (consumer.maxPowerW !== null && consumer.maxPowerW > 0) {
                const already = allocatedInSlotKwh(allocations, consumer.consumerId, slot.startIso);
                if (already + exports.EPS >= energyFromPowerW(consumer.maxPowerW))
                    continue;
            }
            const key = consumer.kind === "climate" && consumer.mandatory
                ? si
                : slot.importCt * 1000 + si * 0.001;
            if (key < bestKey) {
                bestKey = key;
                bestSi = si;
            }
        }
        if (bestSi !== null)
            push(bestSi);
    }
    if (consumer.batteryEligible && projectedSocAt(state, 0) > floorKwhAt(state, 0) + exports.EPS) {
        let added = 0;
        for (let si = 0; si < slots.length && added < 8; si++) {
            const slot = slots[si];
            if (slot.startMs >= consumer.deadlineMs)
                continue;
            if (slot.startMs < state.nowMs - 60_000)
                continue;
            const socAt = projectedSocAt(state, si);
            if ((0, battery_reserve_floor_1.usableBatteryEnergyKwh)(socAt, floorKwhAt(state, si), state.dischargeEff) <= exports.EPS) {
                continue;
            }
            push(si);
            added++;
        }
    }
    return out;
}
function pickBestCandidate(input, state, weights, pvActive, allocations, wbPresenceCodes, blocked, onlyConsumerId) {
    let best = null;
    let bestScore = weights.minScoreThreshold;
    for (const consumer of state.consumers) {
        if (onlyConsumerId && consumer.consumerId !== onlyConsumerId)
            continue;
        if (consumer.remainingKwh <= exports.EPS)
            continue;
        const slotIndices = slotIndicesForConsumer(consumer, state, pvActive, allocations);
        for (const si of slotIndices) {
            const candidates = generateCandidatesForConsumer(input, state, consumer, si, wbPresenceCodes, allocations, weights);
            for (const cand of candidates) {
                const key = `${cand.consumerId}|${cand.slotIdx}|${cand.source}`;
                if (blocked.has(key))
                    continue;
                const sc = scoreCandidate(input, state, cand, weights);
                if (sc > bestScore + exports.EPS) {
                    bestScore = sc;
                    best = cand;
                }
                else if (Math.abs(sc - bestScore) <= exports.EPS && best) {
                    const tie = cand.slotIdx - best.slotIdx ||
                        cand.consumerId.localeCompare(best.consumerId) ||
                        cand.source.localeCompare(best.source);
                    if (tie < 0) {
                        best = cand;
                        bestScore = sc;
                    }
                }
            }
        }
    }
    return best ? { candidate: best, score: bestScore } : null;
}
function runScoreBasedAllocation(input, slots, opts) {
    const weights = (0, optimize_weights_1.optimizeWeightsFromInput)(input);
    const allocations = [];
    const reasonCodes = opts?.reasonCodes ? [...opts.reasonCodes] : [];
    const bat = input.battery;
    const capacity = bat.usableCapacityKwh ?? 0;
    const socPct = bat.socPct;
    const batteryKnown = capacity > 0 && socPct !== null;
    const policy = (0, mode_policy_1.plannerModePolicyFromGlobalMode)(input.globalMode);
    const endSocPct = bat.endSocTargetPct != null && Number.isFinite(bat.endSocTargetPct)
        ? bat.endSocTargetPct
        : policy.chargeTargetSocPct;
    const targetKwh = batteryKnown ? capacity * (endSocPct / 100) : 0;
    const chargeEff = bat.chargeEfficiency ?? 1;
    const dischargeEff = bat.dischargeEfficiency ?? 1;
    const wb = input.wallbox;
    const wbPresenceCodes = wb ? (0, vehicle_availability_1.collectPresenceReasonCodes)(wb.presenceWindows) : [];
    if (wb) {
        for (const c of wbPresenceCodes)
            reasonCodes.push(c);
        const mode = (0, ev_energy_1.evManagementFromWallbox)(wb);
        if (mode === "externally_managed")
            reasonCodes.push(reason_codes_1.REASON.VEHICLE_EXTERNALLY_MANAGED);
        if (mode === "takeover_candidate")
            reasonCodes.push(reason_codes_1.REASON.VEHICLE_TAKEOVER_CANDIDATE);
        if (mode === "ems_candidate" && !(0, ev_energy_1.resolveEvEnergyClasses)(wb).energyGoalHard) {
            reasonCodes.push(reason_codes_1.REASON.VEHICLE_TARGET_SOFT);
        }
    }
    applyExternalEvReservations(input, slots, reasonCodes);
    const th = input.thermal;
    if (th?.emptyAtSource === "estimated")
        reasonCodes.push(reason_codes_1.REASON.THERMAL_EMPTY_AT_ESTIMATED);
    /** Reserve: freier Surplus nach Pflichtbindung. next-PV: Fenster roh, Check gebunden. */
    const hardBound = hardPvBoundForPlanning(input, slots);
    const reserveFloor = (0, battery_reserve_floor_1.buildBatteryReserveFloor)(input, (0, next_reliable_pv_1.applyHardPvBoundsToSlots)(slots, hardBound));
    const nowMsPlan = Date.parse(input.time.nowIso);
    const fromIdxPlan = Math.max(0, slots.findIndex((s) => s.startMs + 15 * 60_000 > nowMsPlan));
    const nextPvPlan = (0, next_reliable_pv_1.findNextReliablePvAfterCurrentWindow)(slots, fromIdxPlan, pvConfidenceFactor(input), nowMsPlan, hardBound);
    const modeDischargeMinKwh = weights.batteryMinSocForDeficitPct < 99 && capacity > 0
        ? capacity * (weights.batteryMinSocForDeficitPct / 100)
        : 0;
    const initialSocKwh = opts?.initialSocKwh ?? (batteryKnown ? (socPct / 100) * capacity : 0);
    const consumers = buildConsumerStates(input, slots);
    if (consumers.some((c) => c.kind === "immersion_heater" && c.thermalBeforeDeadline)) {
        reasonCodes.push(reason_codes_1.REASON.THERMAL_DEADLINE_PV_WINDOW);
    }
    const state = {
        slots,
        socKwh: initialSocKwh,
        initialSocKwh,
        socDeltaBySlot: slots.map(() => 0),
        capacityKwh: capacity,
        reserveKwh: opts?.reserveKwh ?? 0,
        reserveFloor,
        batteryTargetKwh: targetKwh,
        chargeEff,
        dischargeEff,
        consumers,
        nowMs: nowMsPlan,
        batteryHold: wb ? wallboxImmediate(wb) : false,
        dischargeLiveSupported: bat.dischargeLiveSupported,
        passiveBatteryEnergyAvailable: bat.passiveBatteryEnergyAvailable === true,
        pvConfidence: pvConfidenceFactor(input),
        modePolicy: policy,
        modeDischargeMinKwh,
        nextReliablePvMs: nextPvPlan.startMs,
    };
    if (!weights.allowOptimization) {
        return {
            allocations,
            goals: buildGoals(input, state, reasonCodes),
            reasonCodes,
            finalSocKwh: state.socKwh,
        };
    }
    dropSubMinRemainder(state.consumers);
    const totalNeedAc = state.consumers.reduce((a, c) => a + c.remainingKwh, 0);
    const minChunk = 0.05;
    const maxIter = Math.min(2500, Math.ceil(totalNeedAc / minChunk) + slots.length * 4);
    const blocked = new Set();
    let stagnant = 0;
    /** Nur Slots mit Rest-PV — vermeidet O(Horizon) Vollscans (CPU). */
    let pvActive = rebuildPvActiveIndices(slots);
    const touchPv = (si, before) => {
        const after = state.slots[si]?.remainPvKwh ?? 0;
        if (before > exports.EPS && after <= exports.EPS) {
            pvActive = pvActive.filter((i) => i !== si);
        }
    };
    for (let iter = 0; iter < maxIter;) {
        const pick = pickBestCandidate(input, state, weights, pvActive, allocations, wbPresenceCodes, blocked, null);
        if (!pick)
            break;
        const appliedSi = pick.candidate.slotIdx;
        const pvBefore = state.slots[appliedSi]?.remainPvKwh ?? 0;
        const applied = applyCandidate(state, pick.candidate, allocations);
        iter++;
        if (!applied) {
            blocked.add(`${pick.candidate.consumerId}|${pick.candidate.slotIdx}|${pick.candidate.source}`);
            stagnant++;
            if (stagnant >= 64)
                break;
            continue;
        }
        stagnant = 0;
        touchPv(appliedSi, pvBefore);
        /**
         * Local-Fill: denselben Consumer weiter bedienen ohne globalen Rescan.
         * Deutlich weniger CPU bei großen Fahrzeug-/Thermal-Bedarfen.
         */
        const focusId = pick.candidate.consumerId;
        for (let burst = 0; burst < 12 && iter < maxIter; burst++) {
            const local = pickBestCandidate(input, state, weights, pvActive, allocations, wbPresenceCodes, blocked, focusId);
            if (!local || local.score < weights.minScoreThreshold)
                break;
            const si = local.candidate.slotIdx;
            const before = state.slots[si]?.remainPvKwh ?? 0;
            const ok = applyCandidate(state, local.candidate, allocations);
            iter++;
            if (!ok) {
                blocked.add(`${local.candidate.consumerId}|${local.candidate.slotIdx}|${local.candidate.source}`);
                break;
            }
            touchPv(si, before);
        }
    }
    if (batteryKnown && state.socKwh + exports.EPS >= state.reserveKwh && (opts?.reserveKwh ?? 0) > exports.EPS) {
        reasonCodes.push(reason_codes_1.REASON.BATTERY_RESERVE_PROTECTED);
    }
    const nowFloor = floorKwhAt(state, 0);
    if (batteryKnown && (0, battery_reserve_floor_1.usableBatteryEnergyKwh)(state.socKwh, nowFloor, state.dischargeEff) > 0.25) {
        reasonCodes.push(reason_codes_1.REASON.BATTERY_FLEX_USABLE);
    }
    if (allocations.some((a) => a.energySource === "battery" ||
        (a.energySource === "mixed" && a.kind !== "battery_charge"))) {
        reasonCodes.push(reason_codes_1.REASON.BATTERY_FROM_RESERVE_FLEX);
    }
    if (state.consumers.some((c) => c.kind === "battery_charge") &&
        slots.some((s) => s.evGridReserved)) {
        reasonCodes.push(reason_codes_1.REASON.VEHICLE_GRID_MUTEX_BATTERY);
    }
    const goals = buildGoals(input, state, reasonCodes);
    return {
        allocations,
        goals,
        reasonCodes,
        finalSocKwh: state.socKwh,
    };
}
exports.runScoreBasedAllocation = runScoreBasedAllocation;
