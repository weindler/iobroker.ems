"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.currentOrFutureSlots = exports.computeExternalPlanRemainingEnergy = void 0;
function originalDurationHours(slot) {
    const start = Date.parse(slot.start);
    const end = Date.parse(slot.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
        return null;
    return (end - start) / 3_600_000;
}
function slotPowerKw(slot, fallbackMaxAcKw) {
    const durH = originalDurationHours(slot);
    if (slot.plannedEnergyKWh != null && slot.plannedEnergyKWh >= 0 && durH != null && durH > 0) {
        return { powerKw: slot.plannedEnergyKWh / durH, estimated: false };
    }
    if (slot.plannedPowerKw != null && slot.plannedPowerKw > 0) {
        return { powerKw: slot.plannedPowerKw, estimated: false };
    }
    if (fallbackMaxAcKw != null && fallbackMaxAcKw > 0) {
        return { powerKw: fallbackMaxAcKw, estimated: true };
    }
    return { powerKw: null, estimated: false };
}
function clip(startMs, endMs, nowMs, deadlineMs) {
    const lo = Math.max(startMs, nowMs);
    const hi = deadlineMs != null ? Math.min(endMs, deadlineMs) : endMs;
    if (!(hi > lo))
        return null;
    return { startMs: lo, endMs: hi };
}
/**
 * Remaining plan energy from `now`, optional deadline, no double-counting of overlaps.
 * Missing power+energy+fallback → null (never fake 0).
 * Only-past slots → 0 kWh / 0 min (evaluated empty remainder).
 */
function computeExternalPlanRemainingEnergy(input) {
    const { slots, nowMs, deadlineMs, fallbackMaxAcKw } = input;
    const segs = [];
    let missingPower = false;
    for (const slot of slots) {
        const start = Date.parse(slot.start);
        const end = Date.parse(slot.end);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
            continue;
        const clipped = clip(start, end, nowMs, deadlineMs);
        if (!clipped)
            continue;
        const { powerKw, estimated } = slotPowerKw(slot, fallbackMaxAcKw);
        if (powerKw === null) {
            missingPower = true;
            break;
        }
        segs.push({ ...clipped, powerKw, estimated });
    }
    if (missingPower) {
        return { remainingEnergyKWh: null, remainingMinutes: null, estimated: false, clippedSlotCount: 0 };
    }
    if (segs.length === 0) {
        return { remainingEnergyKWh: 0, remainingMinutes: 0, estimated: false, clippedSlotCount: 0 };
    }
    const events = [];
    for (const s of segs) {
        events.push({ t: s.startMs, delta: 1, power: s.powerKw, estimated: s.estimated, open: true });
        events.push({ t: s.endMs, delta: -1, power: s.powerKw, estimated: s.estimated, open: false });
    }
    events.sort((a, b) => a.t - b.t || Number(a.open) - Number(b.open));
    const active = [];
    let cursor = null;
    let energy = 0;
    let minutes = 0;
    let estimated = false;
    const activeMax = () => {
        if (active.length === 0)
            return null;
        let best = active[0];
        for (const a of active) {
            if (a.power > best.power)
                best = a;
        }
        return best;
    };
    for (const ev of events) {
        if (cursor !== null && ev.t > cursor) {
            const cur = activeMax();
            if (cur) {
                const dtMs = ev.t - cursor;
                energy += cur.power * (dtMs / 3_600_000);
                minutes += dtMs / 60_000;
                if (cur.estimated)
                    estimated = true;
            }
        }
        if (ev.open)
            active.push({ power: ev.power, estimated: ev.estimated });
        else {
            const idx = active.findIndex((a) => a.power === ev.power && a.estimated === ev.estimated);
            if (idx >= 0)
                active.splice(idx, 1);
        }
        cursor = ev.t;
    }
    return {
        remainingEnergyKWh: Math.round(energy * 1000) / 1000,
        remainingMinutes: Math.round(minutes * 10) / 10,
        estimated,
        clippedSlotCount: segs.length,
    };
}
exports.computeExternalPlanRemainingEnergy = computeExternalPlanRemainingEnergy;
function currentOrFutureSlots(slots, nowMs) {
    return slots.filter((s) => {
        const end = Date.parse(s.end);
        return Number.isFinite(end) && end > nowMs;
    });
}
exports.currentOrFutureSlots = currentOrFutureSlots;
