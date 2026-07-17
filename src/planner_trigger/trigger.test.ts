import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	isDeniedPlannerTriggerState,
	matchPlannerTriggerState,
	PlannerTriggerAggregator,
	PlannerScheduleTrigger,
	nextSlotBoundaryMs,
} from "./index.js";

describe("planner_trigger catalog", () => {
	it("denies planner output and coordinator states", () => {
		assert.equal(isDeniedPlannerTriggerState("planner.coordinator.state"), true);
		assert.equal(isDeniedPlannerTriggerState("planner.forecast.revision"), true);
		assert.equal(isDeniedPlannerTriggerState("operator.daily_plan.status"), true);
		assert.equal(matchPlannerTriggerState("planner.coordinator.state", false), null);
		assert.equal(matchPlannerTriggerState("planner.coordinator.comparison_status", true), null);
	});

	it("allows relevant telemetry", () => {
		const entry = matchPlannerTriggerState("live.pv.power_w", true);
		assert.ok(entry);
		assert.equal(entry?.class, "telemetry");
	});

	it("ignores irrelevant states", () => {
		assert.equal(matchPlannerTriggerState("support.diagnostic.active", false), null);
		assert.equal(matchPlannerTriggerState("command.inbox", false), null);
	});

	it("respects conscious ack policy for config", () => {
		assert.ok(matchPlannerTriggerState("global.execution_mode", false));
		assert.equal(matchPlannerTriggerState("global.execution_mode", true), null);
	});
});

describe("planner_trigger aggregator", () => {
	it("coalesces burst and preserves force", async () => {
		const flushed: Array<{ count: number; force: boolean }> = [];
		const agg = new PlannerTriggerAggregator({
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
		assert.equal(flushed.length, 1);
		assert.ok(flushed[0].count >= 3);
		assert.equal(flushed[0].force, true);
		agg.stop();
	});

	it("stop discards pending and blocks later flush", async () => {
		let count = 0;
		const agg = new PlannerTriggerAggregator({
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
		assert.equal(count, 0);
		assert.equal(agg.flushNow(), null);
	});
});

describe("planner_trigger schedule", () => {
	it("aligns to 15-minute boundaries", () => {
		const base = Date.parse("2026-07-01T12:07:00.000Z");
		assert.equal(nextSlotBoundaryMs(base), Date.parse("2026-07-01T12:15:00.000Z"));
	});

	it("stops without late ticks", async () => {
		let ticks = 0;
		const sched = new PlannerScheduleTrigger({
			now: () => Date.now(),
			onTick: () => {
				ticks += 1;
			},
		});
		sched.start();
		sched.stop();
		await new Promise((r) => setTimeout(r, 20));
		assert.equal(ticks, 0);
		assert.equal(sched.getNextAtMs(), null);
	});
});
