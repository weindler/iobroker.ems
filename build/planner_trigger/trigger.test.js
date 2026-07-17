"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const index_js_1 = require("./index.js");
(0, node_test_1.describe)("planner_trigger catalog", () => {
    (0, node_test_1.it)("denies planner output and coordinator states", () => {
        strict_1.default.equal((0, index_js_1.isDeniedPlannerTriggerState)("planner.coordinator.state"), true);
        strict_1.default.equal((0, index_js_1.isDeniedPlannerTriggerState)("planner.forecast.revision"), true);
        strict_1.default.equal((0, index_js_1.isDeniedPlannerTriggerState)("operator.daily_plan.status"), true);
        strict_1.default.equal((0, index_js_1.matchPlannerTriggerState)("planner.coordinator.state", false), null);
        strict_1.default.equal((0, index_js_1.matchPlannerTriggerState)("planner.coordinator.comparison_status", true), null);
    });
    (0, node_test_1.it)("allows relevant telemetry", () => {
        const entry = (0, index_js_1.matchPlannerTriggerState)("live.pv.power_w", true);
        strict_1.default.ok(entry);
        strict_1.default.equal(entry?.class, "telemetry");
    });
    (0, node_test_1.it)("ignores irrelevant states", () => {
        strict_1.default.equal((0, index_js_1.matchPlannerTriggerState)("support.diagnostic.active", false), null);
        strict_1.default.equal((0, index_js_1.matchPlannerTriggerState)("command.inbox", false), null);
    });
    (0, node_test_1.it)("respects conscious ack policy for config", () => {
        strict_1.default.ok((0, index_js_1.matchPlannerTriggerState)("global.execution_mode", false));
        strict_1.default.equal((0, index_js_1.matchPlannerTriggerState)("global.execution_mode", true), null);
    });
});
(0, node_test_1.describe)("planner_trigger aggregator", () => {
    (0, node_test_1.it)("coalesces burst and preserves force", async () => {
        const flushed = [];
        const agg = new index_js_1.PlannerTriggerAggregator({
            debounceMs: 20,
            minIntervalMs: 0,
            maxDelayMs: 200,
            now: () => Date.now(),
            onFlush: (r) => flushed.push({ count: r.coalescedCount, force: r.force }),
        });
        agg.push({
            class: "telemetry",
            reasonCode: "telemetry_change",
            sourceId: "live.pv.power_w",
            observedAt: new Date().toISOString(),
        });
        agg.push({
            class: "price",
            reasonCode: "price_change",
            sourceId: "live.price.now_ct_per_kwh",
            observedAt: new Date().toISOString(),
            force: true,
        });
        agg.push({
            class: "telemetry",
            reasonCode: "telemetry_change",
            sourceId: "live.battery.soc_pct",
            observedAt: new Date().toISOString(),
            force: false,
        });
        await new Promise((r) => setTimeout(r, 40));
        strict_1.default.equal(flushed.length, 1);
        strict_1.default.ok(flushed[0].count >= 3);
        strict_1.default.equal(flushed[0].force, true);
        agg.stop();
    });
    (0, node_test_1.it)("stop discards pending and blocks later flush", async () => {
        let count = 0;
        const agg = new index_js_1.PlannerTriggerAggregator({
            debounceMs: 30,
            minIntervalMs: 0,
            maxDelayMs: 200,
            onFlush: () => {
                count += 1;
            },
        });
        agg.push({
            class: "telemetry",
            reasonCode: "telemetry_change",
            sourceId: "live.pv.power_w",
            observedAt: new Date().toISOString(),
        });
        agg.stop();
        await new Promise((r) => setTimeout(r, 50));
        strict_1.default.equal(count, 0);
        strict_1.default.equal(agg.flushNow(), null);
    });
});
(0, node_test_1.describe)("planner_trigger schedule", () => {
    (0, node_test_1.it)("aligns to 15-minute boundaries", () => {
        const base = Date.parse("2026-07-01T12:07:00.000Z");
        strict_1.default.equal((0, index_js_1.nextSlotBoundaryMs)(base), Date.parse("2026-07-01T12:15:00.000Z"));
    });
    (0, node_test_1.it)("stops without late ticks", async () => {
        let ticks = 0;
        const sched = new index_js_1.PlannerScheduleTrigger({
            now: () => Date.now(),
            onTick: () => {
                ticks += 1;
            },
        });
        sched.start();
        sched.stop();
        await new Promise((r) => setTimeout(r, 20));
        strict_1.default.equal(ticks, 0);
        strict_1.default.equal(sched.getNextAtMs(), null);
    });
});
