"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlannerScheduleTrigger = exports.localDateKeyUtc = exports.nextSlotBoundaryMs = void 0;
const constants_1 = require("./constants");
/**
 * Next 15-minute UTC-aligned boundary after `fromMs` (exclusive of exact boundary).
 */
function nextSlotBoundaryMs(fromMs, slotMs = constants_1.PLANNER_SCHEDULE_SLOT_ALIGN_MS) {
    return Math.floor(fromMs / slotMs) * slotMs + slotMs;
}
exports.nextSlotBoundaryMs = nextSlotBoundaryMs;
function localDateKeyUtc(ms) {
    return new Date(ms).toISOString().slice(0, 10);
}
exports.localDateKeyUtc = localDateKeyUtc;
/**
 * Deterministic schedule planner: fires on 15-min slot change; marks day change when date key differs.
 */
class PlannerScheduleTrigger {
    timer = null;
    stopped = false;
    lastDateKey;
    now;
    onTick;
    constructor(options) {
        this.now = options.now ?? (() => Date.now());
        this.onTick = options.onTick;
        this.lastDateKey = localDateKeyUtc(options.initialMs ?? this.now());
    }
    start() {
        if (this.stopped)
            return;
        this.arm();
    }
    stop() {
        this.stopped = true;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
    isStopped() {
        return this.stopped;
    }
    getNextAtMs() {
        if (this.stopped)
            return null;
        return nextSlotBoundaryMs(this.now());
    }
    /** Test helper: fire as if the next boundary was reached. */
    fireForTest() {
        if (this.stopped)
            return;
        this.fire(nextSlotBoundaryMs(this.now()));
    }
    arm() {
        if (this.stopped)
            return;
        if (this.timer)
            clearTimeout(this.timer);
        const now = this.now();
        const next = nextSlotBoundaryMs(now);
        const delay = Math.max(1, next - now);
        this.timer = setTimeout(() => {
            this.timer = null;
            this.fire(next);
            this.arm();
        }, delay);
    }
    fire(atMs) {
        if (this.stopped)
            return;
        const dateKey = localDateKeyUtc(atMs);
        const kind = dateKey !== this.lastDateKey ? "schedule_day" : "schedule_slot";
        this.lastDateKey = dateKey;
        const nextAt = new Date(nextSlotBoundaryMs(atMs));
        this.onTick({ kind, at: new Date(atMs), nextAt });
    }
}
exports.PlannerScheduleTrigger = PlannerScheduleTrigger;
