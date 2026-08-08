"use strict";
/**
 * Score-basierte iterative Unified-Allocation — kein fester Add-on-Phasen-Order.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runScoreBasedAllocation = exports.scoreCandidate = exports.takePv = exports.pushAlloc = exports.allocatedInSlotKwh = exports.buildSlots = exports.powerFromEnergyKwh = exports.energyFromPowerW = exports.EPS = exports.SLOT_H = void 0;
const mode_policy_1 = require("../../../planner/mode_policy");
const battery_reserve_floor_1 = require("./battery_reserve_floor");
const optimize_weights_1 = require("./optimize_weights");
const reason_codes_1 = require("./reason_codes");
const vehicle_availability_1 = require("./vehicle_availability");
exports.SLOT_H = 0.25;
exports.EPS = 1e-6;
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
function buildSlots(input) {
    const byStart = new Map();
    const nowUsesLive = new Set();
    for (const s of input.time.slots) {
        byStart.set(s.startIso, {
            startIso: s.startIso,
            endIso: s.endIso,
            startMs: Date.parse(s.startIso),
            pvKwh: 0,
            houseKwh: 0,
            surplusKwh: 0,
            importCt: null,
            exportCt: null,
            gridAllowed: true,
            remainPvKwh: 0,
        });
    }
    for (const p of input.pv.slots) {
        const w = byStart.get(p.slot.startIso);
        if (!w)
            continue;
        const pick = pickSlotPowerW(p.forecastPowerW, p.observedPowerW, p.energyKwh);
        if (pick.powerW !== null)
            w.pvKwh = energyFromPowerW(pick.powerW);
        if (pick.fromObserved)
            nowUsesLive.add(p.slot.startIso);
    }
    for (const h of input.houseLoad.slots) {
        const w = byStart.get(h.slot.startIso);
        if (!w)
            continue;
        const pick = pickSlotPowerW(h.forecastPowerW, h.observedPowerW, h.energyKwh);
        if (pick.powerW !== null)
            w.houseKwh = energyFromPowerW(pick.powerW);
        if (!pick.fromObserved)
            nowUsesLive.delete(h.slot.startIso);
    }
    for (const pr of input.prices.slots) {
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
    out.push({
        slot: { startIso: slot.startIso, endIso: slot.endIso },
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
    if (wb.requiredEnergyKwh !== null && wb.requiredEnergyKwh > 0)
        return wb.requiredEnergyKwh;
    if (wb.targetSocPct !== null && wb.vehicleSocPct !== null && wb.vehicleCapacityKwh !== null) {
        return (Math.max(0, wb.targetSocPct - wb.vehicleSocPct) / 100) * wb.vehicleCapacityKwh;
    }
    return wb.fallbackEnergyNeedKwh;
}
function wallboxImmediate(wb) {
    if (wb.batteryHoldRequested === true)
        return true;
    /** Nur Schnell/immediate → Batterie-Hold; min+PV ist PV-orientiert. */
    return wb.evccChargeMode === "now";
}
function buildConsumerStates(input, slots) {
    const out = [];
    const nowMs = Date.parse(input.time.nowIso);
    const wb = input.wallbox;
    if (wb) {
        const need = resolveVehicleNeedKwh(input);
        const loss = wb.chargeLossFactor ?? 1;
        if (need !== null && need > exports.EPS) {
            const deadlineMs = wb.deadlineIso ? Date.parse(wb.deadlineIso) : Number.POSITIVE_INFINITY;
            const chargeMode = wb.evccChargeMode ?? null;
            const gridOk = chargeMode !== "pv" && chargeMode !== "off";
            out.push({
                consumerId: "wallbox",
                kind: "wallbox",
                remainingKwh: need * loss,
                maxPowerW: wb.maxChargePowerW,
                minPowerW: wb.minChargePowerW,
                deadlineMs,
                mandatory: wb.energyGoalHard,
                gridEligible: gridOk,
                pvFirst: chargeMode === "pv" || chargeMode === "minpv" || chargeMode === null,
                /** Batterie-Flex oberhalb Reserve-Floor — Anteil score-/recovery-basiert, keine %-Cap. */
                batteryEligible: chargeMode !== "off",
                energyGoalHard: wb.energyGoalHard,
                maxShiftHours: null,
                earliestSlotIdx: 0,
                thermalBeforeDeadline: false,
                slotAllowed: (slotStartIso) => (0, vehicle_availability_1.vehicleSlotAllocatable)(wb, slotStartIso),
            });
        }
    }
    const th = input.thermal;
    if (th && th.headroomEnergyKwh !== null && th.headroomEnergyKwh > exports.EPS) {
        const deadlineMs = th.deadlineIso ? Date.parse(th.deadlineIso) : Number.NaN;
        out.push({
            consumerId: "immersion_heater",
            kind: "immersion_heater",
            remainingKwh: th.headroomEnergyKwh,
            maxPowerW: th.availablePowerW,
            minPowerW: th.minPowerW ?? th.availablePowerW,
            deadlineMs: Number.isFinite(deadlineMs) ? deadlineMs : Number.POSITIVE_INFINITY,
            mandatory: false,
            gridEligible: false,
            pvFirst: true,
            /** Thermal darf Batterie nutzen, wenn Floor + Opportunity Cost es erlauben. */
            batteryEligible: true,
            energyGoalHard: th.emptyAtSource === "learned",
            maxShiftHours: null,
            earliestSlotIdx: 0,
            thermalBeforeDeadline: Number.isFinite(deadlineMs),
        });
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
        if (!consumer.batteryEligible)
            return -Infinity;
        if (!weights.allowOptimization)
            return -Infinity;
        const floor = dischargeFloorKwh(state, candidate.slotIdx);
        const draw = candidate.energyKwh / Math.max(state.dischargeEff, 0.1);
        if (state.socKwh - draw < floor - exports.EPS)
            return -Infinity;
        const usable = (0, battery_reserve_floor_1.usableBatteryEnergyKwh)(state.socKwh, floor, state.dischargeEff);
        if (usable + exports.EPS < candidate.energyKwh)
            return -Infinity;
        /*
         * Keine Batterie-Entladung solange derselbe Slot noch PV-Surplus hat —
         * sonst entsteht künstliche Export-Arbitrage (PV einspeisen, Klima aus Batterie).
         */
        const need = Math.min(candidate.energyKwh, consumer.remainingKwh);
        if (slot.remainPvKwh + exports.EPS >= need)
            return -Infinity;
    }
    if (state.batteryHold && candidate.kind === "battery_charge")
        return -Infinity;
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
        priority = consumer.energyGoalHard ? 4.2 * weights.vehicleUrgencyBoost : 2.4 * weights.vehicleUrgencyBoost;
    }
    else if (candidate.kind === "climate" && consumer.mandatory) {
        priority = 2.6 * weights.comfortWeight;
    }
    else if (candidate.kind === "immersion_heater") {
        priority = consumer.thermalBeforeDeadline ? 1.75 * weights.thermalDeadlineWeight : 1.25 * weights.comfortWeight;
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
        if (candidate.source === "grid" && state.pvConfidence >= 0.7 && safePv + exports.EPS >= consumer.remainingKwh) {
            score -= e * 4.5 * weights.costWeight;
        }
        else if (candidate.source === "grid" && state.pvConfidence >= 0.7 && safePv > exports.EPS) {
            score -= e * Math.max(0, consumer.remainingKwh - safePv) * 0.05 * weights.costWeight;
        }
        if (candidate.source === "pv_surplus") {
            score += e * 0.55 * weights.pvOpportunityWeight;
            if (pvRem > exports.EPS)
                score += e * 0.25;
        }
        if (consumer.energyGoalHard && state.pvConfidence < 0.7 && candidate.source === "grid") {
            score += e * (0.7 - state.pvConfidence) * weights.deadlineWeight * 0.35;
        }
        /** Netzbedarf: günstige Slots stark bevorzugen (marginale ct). */
        if (candidate.source === "grid" && slot.importCt !== null) {
            const deficit = Math.max(0, consumer.remainingKwh - safePv);
            if (deficit > exports.EPS || state.pvConfidence < 0.7) {
                score += e * 1.1 * weights.deadlineWeight;
            }
            score -= e * (slot.importCt / 100) * weights.costWeight * 2.8;
        }
    }
    if (candidate.kind === "immersion_heater") {
        if (consumer.thermalBeforeDeadline && slotMs < consumer.deadlineMs) {
            score += e * weights.thermalDeadlineWeight * 0.42;
            /** Frühere PV-Fenster vor Deadline bevorzugen (nicht erst kurz vor empty_at). */
            const hoursToDeadline = (consumer.deadlineMs - slotMs) / 3600_000;
            if (hoursToDeadline > 1)
                score += e * Math.min(1.2, hoursToDeadline / 8) * 0.22;
        }
        if (slot.remainPvKwh > exports.EPS && slot.surplusKwh > exports.EPS) {
            score += e * (slot.remainPvKwh / Math.max(slot.surplusKwh, exports.EPS)) * weights.flexShiftWeight * 0.28;
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
            const batAboveFloor = state.socKwh > floor + 0.5;
            const batNearTarget = state.batteryTargetKwh > exports.EPS && state.socKwh + 0.25 >= state.batteryTargetKwh;
            const wb = state.consumers.find((c) => c.kind === "wallbox");
            const hardVehicle = wb != null && wb.energyGoalHard && wb.remainingKwh > 1.0;
            if (batAboveFloor && (batNearTarget || state.socKwh >= state.capacityKwh * 0.8)) {
                score += e * weights.flexShiftWeight * 0.42;
            }
            if (hardVehicle) {
                score -= e * weights.vehicleUrgencyBoost * 0.65;
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
        const room = state.batteryTargetKwh - state.socKwh;
        if (room > exports.EPS) {
            score += e * (Math.min(e, room) / room) * weights.socTargetWeight * 0.28;
        }
        if (state.socKwh < state.reserveKwh - exports.EPS) {
            score += e * weights.reserveProtectWeight * 0.35;
        }
        if (candidate.source === "pv_surplus" && weights.batterySurplusMinFactor > 1) {
            const pvRatio = slot.remainPvKwh / Math.max(slot.surplusKwh, exports.EPS);
            if (pvRatio < 0.5)
                score -= e * (weights.batterySurplusMinFactor - 1) * 0.12;
        }
        if (candidate.source === "grid" && state.socKwh >= state.reserveKwh - exports.EPS) {
            score -= e * 0.06 * weights.costWeight;
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
        if (candidate.source === "pv_surplus") {
            codes.push(reason_codes_1.REASON.PV_EXPECTED_BEFORE_DEADLINE, reason_codes_1.REASON.PV_SURPLUS_AVAILABLE, reason_codes_1.REASON.VEHICLE_PV_WINDOW_AVAILABLE);
            codes.push(...wbPresenceCodes.filter((c) => /predicted|explicit|available_now/.test(c)));
        }
        if (candidate.source === "grid") {
            codes.push(reason_codes_1.REASON.VEHICLE_DEADLINE_REQUIRED, reason_codes_1.REASON.VEHICLE_IMPORT_WINDOW_AVAILABLE);
            codes.push(candidate.conservativeGrid || state.pvConfidence < 0.7
                ? reason_codes_1.REASON.GRID_IMPORT_CONSERVATIVE_DEADLINE
                : reason_codes_1.REASON.GRID_IMPORT_COST_OPTIMAL);
        }
        if (candidate.source === "battery") {
            codes.push(reason_codes_1.REASON.BATTERY_FROM_RESERVE_FLEX, reason_codes_1.REASON.VEHICLE_DEADLINE_REQUIRED);
        }
    }
    if (candidate.kind === "immersion_heater") {
        codes.push(reason_codes_1.REASON.THERMAL_FLEX_AVAILABLE, reason_codes_1.REASON.MIN_POWER_SLOT);
        if (candidate.source === "pv_surplus")
            codes.push(reason_codes_1.REASON.PV_SURPLUS_AVAILABLE);
        if (candidate.source === "battery")
            codes.push(reason_codes_1.REASON.BATTERY_FROM_RESERVE_FLEX);
        if (input.thermal?.deadlineIso && slot.startMs < Date.parse(input.thermal.deadlineIso)) {
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
    const already = allocatedInSlotKwh(allocations, consumer.consumerId, slot.startIso);
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
        sources.push("grid");
    }
    const batFloor = dischargeFloorKwh(state, slotIdx);
    const usableBat = (0, battery_reserve_floor_1.usableBatteryEnergyKwh)(state.socKwh, batFloor, state.dischargeEff);
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
        if (consumer.gridEligible && slot.gridAllowed && slot.importCt !== null)
            sources.push("grid");
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
    const already = allocatedInSlotKwh(allocations, candidate.consumerId, slot.startIso);
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
        if (state.socKwh - draw < floor - exports.EPS)
            return false;
        state.socKwh = Math.max(0, state.socKwh - draw);
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
        state.socKwh = Math.min(state.capacityKwh, state.socKwh + stored);
    }
    consumer.remainingKwh = Math.max(0, consumer.remainingKwh - e);
    dropSubMinRemainder([consumer]);
    return true;
}
function buildGoals(input, state, reasonCodes) {
    const goals = [];
    const wb = input.wallbox;
    if (wb) {
        const wc = state.consumers.find((c) => c.consumerId === "wallbox");
        const need = resolveVehicleNeedKwh(input);
        if (need === null || need <= exports.EPS) {
            goals.push({
                consumerId: "wallbox",
                goalId: "energy",
                met: true,
                detailDe: "Kein Fahrzeug-Energiebedarf.",
            });
        }
        else {
            const feasibility = (0, vehicle_availability_1.evaluateVehicleGoalFeasibility)(input);
            for (const c of feasibility.reasonCodes)
                reasonCodes.push(c);
            const remaining = wc?.remainingKwh ?? need * (wb.chargeLossFactor ?? 1);
            const met = feasibility.status === "unreachable"
                ? false
                : feasibility.status === "at_risk" || feasibility.status === "at_risk_unknown"
                    ? null
                    : remaining <= 0.05;
            goals.push({
                consumerId: "wallbox",
                goalId: "energy_deadline",
                met,
                detailDe: feasibility.status === "unreachable"
                    ? `Fahrzeugziel physisch unerreichbar (max ~${feasibility.maxFeasibleEnergyKwh.toFixed(2)} kWh).`
                    : feasibility.status === "at_risk_unknown"
                        ? "Fahrzeugziel unsicher wegen unknown Presence."
                        : feasibility.status === "at_risk"
                            ? "Fahrzeugziel abhängig von predicted Presence."
                            : remaining <= 0.05
                                ? "Fahrzeugziel im Plan gedeckt."
                                : `Fahrzeugziel unvollständig, Rest ~${remaining.toFixed(2)} kWh.`,
            });
        }
    }
    const th = input.thermal;
    if (th) {
        const tc = state.consumers.find((c) => c.consumerId === "immersion_heater");
        if (th.headroomEnergyKwh === null || th.headroomEnergyKwh <= exports.EPS) {
            goals.push({
                consumerId: "immersion_heater",
                goalId: "thermal_day",
                met: true,
                detailDe: "Kein thermischer Headroom.",
            });
        }
        else {
            const remaining = tc?.remainingKwh ?? th.headroomEnergyKwh;
            const hasDeadline = th.deadlineIso !== null;
            goals.push({
                consumerId: "immersion_heater",
                goalId: "thermal_day",
                met: remaining <= th.headroomEnergyKwh * 0.15,
                detailDe: remaining <= exports.EPS
                    ? hasDeadline
                        ? `Thermisches Vorladen vor ${th.deadlineIso} aus PV geplant.`
                        : "Thermischer Headroom aus PV geplant."
                    : `Thermisch Rest ~${remaining.toFixed(2)} kWh (PV knapp — Batterie-Flex nur oberhalb Reserve-Floor).`,
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
        // Zusätzlich Batterie-Slots ohne PV, wenn Reserve-Floor Freiraum lässt.
        if (consumer.batteryEligible && state.socKwh > floorKwhAt(state, 0) + exports.EPS) {
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
    if (consumer.batteryEligible && state.socKwh > floorKwhAt(state, 0) + exports.EPS) {
        let added = 0;
        for (let si = 0; si < slots.length && added < 8; si++) {
            const slot = slots[si];
            if (slot.startMs >= consumer.deadlineMs)
                continue;
            if (slot.startMs < state.nowMs - 60_000)
                continue;
            if ((0, battery_reserve_floor_1.usableBatteryEnergyKwh)(state.socKwh, floorKwhAt(state, si), state.dischargeEff) <= exports.EPS) {
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
    }
    const th = input.thermal;
    if (th?.emptyAtSource === "estimated")
        reasonCodes.push(reason_codes_1.REASON.THERMAL_EMPTY_AT_ESTIMATED);
    if (th?.deadlineIso)
        reasonCodes.push(reason_codes_1.REASON.THERMAL_DEADLINE_PV_WINDOW);
    const reserveFloor = (0, battery_reserve_floor_1.buildBatteryReserveFloor)(input, slots);
    const modeDischargeMinKwh = weights.batteryMinSocForDeficitPct < 99 && capacity > 0
        ? capacity * (weights.batteryMinSocForDeficitPct / 100)
        : 0;
    const state = {
        slots,
        socKwh: opts?.initialSocKwh ?? (batteryKnown ? (socPct / 100) * capacity : 0),
        capacityKwh: capacity,
        reserveKwh: opts?.reserveKwh ?? 0,
        reserveFloor,
        batteryTargetKwh: targetKwh,
        chargeEff,
        dischargeEff,
        consumers: buildConsumerStates(input, slots),
        nowMs: Date.parse(input.time.nowIso),
        batteryHold: wb ? wallboxImmediate(wb) : false,
        dischargeLiveSupported: bat.dischargeLiveSupported,
        pvConfidence: pvConfidenceFactor(input),
        modePolicy: policy,
        modeDischargeMinKwh,
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
    const goals = buildGoals(input, state, reasonCodes);
    return {
        allocations,
        goals,
        reasonCodes,
        finalSocKwh: state.socKwh,
    };
}
exports.runScoreBasedAllocation = runScoreBasedAllocation;
