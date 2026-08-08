"use strict";
/**
 * Nach Unified-Authority Remaining-/Allocated-Felder aus derselben Slot-Bilanz neu ableiten.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.recomputeDailyPlanSlotRemainings = void 0;
function recomputeOneSlot(slot) {
    let allocatedFlexiblePowerW = 0;
    let allocatedPvPowerW = 0;
    let allocatedGridPowerW = 0;
    let allocatedBatteryPowerW = 0;
    for (const a of slot.allocations) {
        const w = a.allocatedPowerW ?? 0;
        if (w > 0)
            allocatedFlexiblePowerW += w;
        allocatedPvPowerW += a.pvPowerW ?? 0;
        allocatedGridPowerW += a.gridPowerW ?? 0;
        allocatedBatteryPowerW += a.batteryPowerW ?? 0;
    }
    const avail = slot.availablePvSurplusPowerW;
    const remainingPv = avail === null ? null : Math.max(0, Math.round(avail - allocatedPvPowerW));
    const gridRemAfter = slot.remainingGridImportPowerW === null
        ? null
        : Math.max(0, Math.round(slot.remainingGridImportPowerW - allocatedGridPowerW));
    return {
        ...slot,
        allocatedFlexiblePowerW: Math.round(allocatedFlexiblePowerW),
        allocatedPvPowerW: Math.round(allocatedPvPowerW),
        allocatedGridPowerW: Math.round(allocatedGridPowerW),
        allocatedBatteryPowerW: Math.round(allocatedBatteryPowerW),
        remainingPvSurplusPowerW: remainingPv,
        remainingGridImportPowerWAfterAlloc: gridRemAfter,
    };
}
/** Recomputiert Slot-Remainings nach autoritativer Allocation (kein Legacy-Floor-Rest). */
function recomputeDailyPlanSlotRemainings(plan) {
    return {
        ...plan,
        slots: plan.slots.map(recomputeOneSlot),
    };
}
exports.recomputeDailyPlanSlotRemainings = recomputeDailyPlanSlotRemainings;
