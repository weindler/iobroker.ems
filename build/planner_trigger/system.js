"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlannerTriggerSystem = void 0;
const planner_config_1 = require("../planner_config");
const aggregator_1 = require("./aggregator");
const catalog_1 = require("./catalog");
const constants_1 = require("./constants");
const schedule_1 = require("./schedule");
/**
 * Lightweight trigger collector — must not import snapshot / worker / preparation.
 */
class PlannerTriggerSystem {
    options;
    aggregator;
    schedule;
    mode;
    startupTimer = null;
    stopped = false;
    lastAutoRequestAt = null;
    nextScheduledAt = null;
    lastTriggerClass = "";
    lastCoalescedCount = 0;
    pending = false;
    constructor(options) {
        this.options = options;
        this.mode = options.mode;
        this.aggregator = new aggregator_1.PlannerTriggerAggregator({
            now: options.now,
            onFlush: (req) => this.emit(req),
        });
        if ((0, planner_config_1.plannerRuntimeModeAllowsAuto)(options.mode)) {
            this.schedule = new schedule_1.PlannerScheduleTrigger({
                now: options.now,
                onTick: (tick) => {
                    if (this.stopped)
                        return;
                    this.nextScheduledAt = tick.nextAt.toISOString();
                    this.aggregator.push({
                        class: "schedule",
                        reasonCode: tick.kind,
                        sourceId: `schedule:${tick.kind}`,
                        observedAt: tick.at.toISOString(),
                    });
                },
            });
        }
        else {
            this.schedule = null;
        }
    }
    start() {
        if (this.stopped)
            return;
        this.schedule?.start();
        const next = this.schedule?.getNextAtMs();
        this.nextScheduledAt = next ? new Date(next).toISOString() : null;
        if ((0, planner_config_1.plannerRuntimeModeAllowsAuto)(this.mode) &&
            this.options.enableStartupTrigger !== false) {
            const delay = this.options.startupDelayMs ?? constants_1.PLANNER_STARTUP_TRIGGER_DELAY_MS;
            this.startupTimer = setTimeout(() => {
                this.startupTimer = null;
                if (this.stopped)
                    return;
                this.aggregator.flushNow({
                    class: "startup",
                    reasonCode: "startup",
                    sourceId: "startup",
                    observedAt: new Date((this.options.now ?? Date.now)()).toISOString(),
                });
            }, delay);
        }
    }
    stop() {
        this.stopped = true;
        if (this.startupTimer) {
            clearTimeout(this.startupTimer);
            this.startupTimer = null;
        }
        this.schedule?.stop();
        this.aggregator.stop();
        this.pending = false;
    }
    /**
     * Observe a relative state change. Returns true if catalog matched (may still be debounced).
     * Auto triggers ignored unless mode is shadow_auto.
     */
    observeStateChange(relativeId, ack) {
        if (this.stopped)
            return false;
        if (!(0, planner_config_1.plannerRuntimeModeAllowsAuto)(this.mode))
            return false;
        const entry = (0, catalog_1.matchPlannerTriggerState)(relativeId, ack);
        if (!entry)
            return false;
        this.pending = true;
        this.aggregator.push({
            class: entry.class,
            reasonCode: entry.reasonCode,
            sourceId: relativeId,
            observedAt: new Date((this.options.now ?? Date.now)()).toISOString(),
        });
        return true;
    }
    /** Manual path — bypasses auto-mode check (caller enforces manual allowance). */
    requestManual(force) {
        if (this.stopped)
            return;
        const event = {
            class: force ? "manual_force" : "manual",
            reasonCode: force ? "manual_force" : "manual",
            sourceId: force ? "manual_force_trigger" : "manual_trigger",
            observedAt: new Date((this.options.now ?? Date.now)()).toISOString(),
            force,
        };
        this.aggregator.flushNow(event);
    }
    getDiagnostics() {
        return {
            pending: this.pending || this.aggregator.hasPending(),
            lastAutoRequestAt: this.lastAutoRequestAt,
            nextScheduledAt: this.nextScheduledAt,
            lastTriggerClass: this.lastTriggerClass,
            lastCoalescedCount: this.lastCoalescedCount,
        };
    }
    emit(request) {
        if (this.stopped)
            return;
        this.pending = false;
        this.lastAutoRequestAt = request.lastObservedAt;
        this.lastTriggerClass = request.primaryClass;
        this.lastCoalescedCount = request.coalescedCount;
        this.options.onRequest(request);
    }
}
exports.PlannerTriggerSystem = PlannerTriggerSystem;
