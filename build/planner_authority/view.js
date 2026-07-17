"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearAuthoritativeViewCacheForTest = exports.getActiveAuthoritativePlannerView = exports.buildAuthoritativePlannerView = void 0;
const fs = __importStar(require("node:fs/promises"));
const constants_1 = require("./constants");
const pointer_1 = require("./pointer");
function compactSlot(candidate, slotStart, slotEnd) {
    const allocations = candidate.allocations
        .filter((a) => a.slotStart === slotStart && a.slotEnd === slotEnd)
        .map((a) => ({
        contributionId: a.contributionId,
        powerW: a.powerW,
        energyKwh: a.energyKwh,
        status: a.status,
    }));
    return { slotStart, slotEnd, allocations };
}
function findSlots(candidate, nowMs) {
    const slots = [...candidate.forecastSlots].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    let currentIdx = -1;
    for (let i = 0; i < slots.length; i++) {
        const start = Date.parse(slots[i].start);
        const end = Date.parse(slots[i].end);
        if (nowMs >= start && nowMs < end) {
            currentIdx = i;
            break;
        }
    }
    if (currentIdx === -1)
        return { current: null, next: null };
    const cur = slots[currentIdx];
    const nxt = slots[currentIdx + 1];
    return {
        current: compactSlot(candidate, cur.start, cur.end),
        next: nxt ? compactSlot(candidate, nxt.start, nxt.end) : null,
    };
}
/**
 * Build a compact authoritative view. Only the current + next slot metadata are
 * retained — the full plan is never held in a long-lived store.
 */
async function buildAuthoritativePlannerView(input) {
    const nowIso = new Date(input.nowMs).toISOString();
    const pointer = input.pointer;
    if (!pointer || pointer.source === "legacy") {
        return {
            source: "legacy",
            quality: pointer ? "valid" : "missing",
            generation: pointer?.generation ?? null,
            planRevision: null,
            currentSlot: null,
            nextSlot: null,
            loadedAt: nowIso,
        };
    }
    // worker_dryrun
    if (!pointer.planPath) {
        return baseWorker(pointer, "missing", nowIso);
    }
    let raw;
    try {
        raw = await fs.readFile(pointer.planPath, "utf8");
    }
    catch {
        return baseWorker(pointer, "missing", nowIso);
    }
    let candidate;
    try {
        candidate = JSON.parse(raw);
    }
    catch {
        return baseWorker(pointer, "invalid", nowIso);
    }
    if (candidate.candidateRevision !== pointer.planRevision) {
        return baseWorker(pointer, "invalid", nowIso);
    }
    const { current, next } = findSlots(candidate, input.nowMs);
    let quality = "valid";
    if (!current) {
        const horizonEnd = Date.parse(candidate.horizonEnd);
        quality =
            Number.isFinite(horizonEnd) && input.nowMs > horizonEnd + constants_1.WORKER_PLAN_STALE_GRACE_MS
                ? "stale"
                : "invalid";
    }
    return {
        source: "worker_dryrun",
        quality,
        generation: pointer.generation,
        planRevision: pointer.planRevision,
        currentSlot: current,
        nextSlot: next,
        loadedAt: nowIso,
    };
}
exports.buildAuthoritativePlannerView = buildAuthoritativePlannerView;
function baseWorker(pointer, quality, nowIso) {
    return {
        source: "worker_dryrun",
        quality,
        generation: pointer.generation,
        planRevision: pointer.planRevision,
        currentSlot: null,
        nextSlot: null,
        loadedAt: nowIso,
    };
}
let cachedView = null;
async function getActiveAuthoritativePlannerView(input) {
    if (cachedView && !input.refresh)
        return cachedView;
    const pointer = await (0, pointer_1.readPointer)(input.layout);
    cachedView = await buildAuthoritativePlannerView({
        layout: input.layout,
        pointer,
        nowMs: input.nowMs,
    });
    return cachedView;
}
exports.getActiveAuthoritativePlannerView = getActiveAuthoritativePlannerView;
function clearAuthoritativeViewCacheForTest() {
    cachedView = null;
}
exports.clearAuthoritativeViewCacheForTest = clearAuthoritativeViewCacheForTest;
