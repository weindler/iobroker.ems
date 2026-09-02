"use strict";
/**
 * Soft-Heizstab-Dringlichkeit aus thermischer Reichweite.
 * Hard/Hygiene/Forced bleiben unberührt — nur optionaler Puffer-Headroom.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveThermalSoftUrgency = void 0;
const LONG_RANGE_H = 36;
const COHERENT_RANGE_H = 24;
function resolveThermalSoftUrgency(input) {
    const emptyMs = input.emptyMs;
    if (emptyMs == null || !Number.isFinite(emptyMs) || emptyMs <= input.nowMs) {
        return {
            needScale: 0,
            remainingHours: null,
            skipWeakSoftWindows: false,
            requireCoherentBlock: false,
        };
    }
    const remainingHours = (emptyMs - input.nowMs) / 3600_000;
    const recMs = input.nextReliablePvMs;
    if (recMs == null || !Number.isFinite(recMs)) {
        const skip = remainingHours >= LONG_RANGE_H;
        return {
            needScale: skip ? 0 : Math.max(0, Math.min(1, (24 - remainingHours) / 16)),
            remainingHours,
            skipWeakSoftWindows: skip,
            requireCoherentBlock: remainingHours >= COHERENT_RANGE_H,
        };
    }
    if (emptyMs < recMs) {
        const gapH = (recMs - emptyMs) / 3600_000;
        return {
            needScale: Math.max(0, Math.min(1, gapH / 10)),
            remainingHours,
            skipWeakSoftWindows: false,
            requireCoherentBlock: false,
        };
    }
    const surplusH = (emptyMs - recMs) / 3600_000;
    if (remainingHours >= LONG_RANGE_H || surplusH >= 24) {
        return {
            needScale: 0,
            remainingHours,
            skipWeakSoftWindows: true,
            requireCoherentBlock: true,
        };
    }
    if (remainingHours >= COHERENT_RANGE_H) {
        return {
            needScale: Math.max(0, Math.min(0.25, (LONG_RANGE_H - remainingHours) / 48)),
            remainingHours,
            skipWeakSoftWindows: false,
            requireCoherentBlock: true,
        };
    }
    return {
        needScale: Math.max(0, Math.min(1, (12 - surplusH) / 12)),
        remainingHours,
        skipWeakSoftWindows: false,
        requireCoherentBlock: false,
    };
}
exports.resolveThermalSoftUrgency = resolveThermalSoftUrgency;
