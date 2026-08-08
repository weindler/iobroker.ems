import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyConsumerEntry } from "../../../learning/consumer_stats/buffer";
import { resolveConsumerEffectivePowerW } from "../../../learning/consumer_stats/learned_power";
import { GLOBAL } from "../../../tree_paths";
import { resetRestoreBarrierForTest, setRestoreInProgress } from "../../../restore/barrier";
import {
	AC_POWER_RECONCILE_MIN_SAMPLE_DAYS,
	evaluateAcPowerConfigReconcile,
	flushQueuedAcPowerConfigReconcile,
	getPendingAcPowerReconcileForTests,
	queueAcPowerConfigReconcile,
	resetAcPowerReconcileMemoryForTests,
} from "./power_reconcile";

function daysAround(medianW: number, n: number, nowMs: number, jitterW = 5): ReturnType<typeof emptyConsumerEntry> {
	const entry = emptyConsumerEntry("air_conditioning.unit_1", nowMs);
	for (let i = 0; i < n; i++) {
		const d = new Date(nowMs - i * 86_400_000);
		const key = d.toISOString().slice(0, 10);
		const w = medianW + ((i % 2 === 0 ? 1 : -1) * (jitterW * (i % 3 === 0 ? 1 : 0.4)));
		const runtimeSec = 7200;
		const energyKwh = (w / 1000) * (runtimeSec / 3600);
		entry.days[key] = {
			dateKey: key,
			runtimeSec,
			energyKwh,
			lastTickMs: nowMs,
		};
	}
	return entry;
}

function hostWithMode(mode: "live" | "dryrun" | "off", config: Record<string, unknown>) {
	const states = new Map<string, unknown>([[GLOBAL.executionMode, mode]]);
	return {
		config,
		updateConfigCalls: 0,
		async updateConfig(next: Record<string, unknown>) {
			this.updateConfigCalls += 1;
			this.config = { ...next };
		},
		async getStateAsync(id: string): Promise<ioBroker.State | null | undefined> {
			const ts = Date.now();
			if (!states.has(id)) {
				return { val: null, ack: true, ts, lc: ts, from: "test" };
			}
			return {
				val: states.get(id) as ioBroker.StateValue,
				ack: true,
				ts,
				lc: ts,
				from: "test",
			};
		},
		setMode(next: "live" | "dryrun" | "off") {
			states.set(GLOBAL.executionMode, next);
		},
		log: { info: () => undefined, debug: () => undefined },
	};
}

describe("AC Learning → Config power reconcile", () => {
	it("Unit 1/2 stable learning evaluates shouldWrite", () => {
		const now = Date.parse("2026-08-08T12:00:00.000Z");
		const d1 = evaluateAcPowerConfigReconcile({
			configPowerW: 850,
			consumerStats: daysAround(727, AC_POWER_RECONCILE_MIN_SAMPLE_DAYS, now, 8),
			nowMs: now,
		});
		const d2 = evaluateAcPowerConfigReconcile({
			configPowerW: 700,
			consumerStats: daysAround(715, AC_POWER_RECONCILE_MIN_SAMPLE_DAYS, now, 4),
			nowMs: now,
		});
		assert.equal(d1.shouldWrite, true);
		assert.equal(d2.shouldWrite, true);
	});

	it("Global Live + stable learning → pending, no updateConfig", async () => {
		resetAcPowerReconcileMemoryForTests();
		resetRestoreBarrierForTest();
		const now = Date.parse("2026-08-08T12:00:00.000Z");
		const stats = daysAround(727, AC_POWER_RECONCILE_MIN_SAMPLE_DAYS, now, 6);
		const host = hostWithMode("live", { ac_u1_estimated_power_w: 850 });
		const q = queueAcPowerConfigReconcile({
			unitIndex: 1,
			configPowerW: 850,
			consumerStats: stats,
			nowMs: now,
		});
		assert.equal(q.queued, true);
		assert.equal(getPendingAcPowerReconcileForTests().size, 1);
		const flush = await flushQueuedAcPowerConfigReconcile({ host, nowMs: now });
		assert.equal(flush.wrote, false);
		assert.equal(flush.deferred, true);
		assert.match(flush.reasonDe, /Global Live/i);
		assert.equal(host.updateConfigCalls, 0);
		assert.equal(getPendingAcPowerReconcileForTests().size, 1);
		assert.equal(host.config.ac_u1_estimated_power_w, 850);
	});

	it("Live→Dryrun flushes pending once batched", async () => {
		resetAcPowerReconcileMemoryForTests();
		resetRestoreBarrierForTest();
		const now = Date.parse("2026-08-08T12:00:00.000Z");
		const s1 = daysAround(727, AC_POWER_RECONCILE_MIN_SAMPLE_DAYS, now, 6);
		const s2 = daysAround(715, AC_POWER_RECONCILE_MIN_SAMPLE_DAYS, now, 4);
		const host = hostWithMode("live", {
			ac_u1_estimated_power_w: 850,
			ac_u2_estimated_power_w: 700,
		});
		queueAcPowerConfigReconcile({
			unitIndex: 1,
			configPowerW: 850,
			consumerStats: s1,
			nowMs: now,
		});
		queueAcPowerConfigReconcile({
			unitIndex: 2,
			configPowerW: 700,
			consumerStats: s2,
			nowMs: now,
		});
		assert.equal(
			(await flushQueuedAcPowerConfigReconcile({ host, nowMs: now })).wrote,
			false,
		);
		assert.equal(host.updateConfigCalls, 0);

		host.setMode("dryrun");
		const flush = await flushQueuedAcPowerConfigReconcile({ host, nowMs: now + 1000 });
		assert.equal(flush.wrote, true);
		assert.equal(host.updateConfigCalls, 1);
		assert.ok(flush.units.includes(1) && flush.units.includes(2));
		assert.ok(Math.abs(Number(host.config.ac_u1_estimated_power_w) - 727) <= 15);
		assert.ok(Math.abs(Number(host.config.ac_u2_estimated_power_w) - 715) <= 10);
		assert.equal(getPendingAcPowerReconcileForTests().size, 0);
	});

	it("Config == Median after write → no second write", async () => {
		resetAcPowerReconcileMemoryForTests();
		resetRestoreBarrierForTest();
		const now = Date.parse("2026-08-08T12:00:00.000Z");
		const stats = daysAround(727, AC_POWER_RECONCILE_MIN_SAMPLE_DAYS, now, 6);
		const host = hostWithMode("dryrun", { ac_u1_estimated_power_w: 850 });
		queueAcPowerConfigReconcile({
			unitIndex: 1,
			configPowerW: 850,
			consumerStats: stats,
			nowMs: now,
		});
		const first = await flushQueuedAcPowerConfigReconcile({ host, nowMs: now });
		assert.equal(first.wrote, true);
		assert.equal(host.updateConfigCalls, 1);

		// Neuer Start / erneuter Tick mit Config=Median
		resetAcPowerReconcileMemoryForTests();
		const cfg = Number(host.config.ac_u1_estimated_power_w);
		const q = queueAcPowerConfigReconcile({
			unitIndex: 1,
			configPowerW: cfg,
			consumerStats: stats,
			nowMs: now + 60_000,
		});
		assert.equal(q.queued, false);
		const second = await flushQueuedAcPowerConfigReconcile({ host, nowMs: now + 60_000 });
		assert.equal(second.wrote, false);
		assert.equal(host.updateConfigCalls, 1);
	});

	it("Planner/Runtime uses learned power while Config pending (Global Live)", async () => {
		resetAcPowerReconcileMemoryForTests();
		resetRestoreBarrierForTest();
		const now = Date.parse("2026-08-08T12:00:00.000Z");
		const stats = daysAround(727, AC_POWER_RECONCILE_MIN_SAMPLE_DAYS, now, 6);
		const host = hostWithMode("live", { ac_u1_estimated_power_w: 850 });
		queueAcPowerConfigReconcile({
			unitIndex: 1,
			configPowerW: 850,
			consumerStats: stats,
			nowMs: now,
		});
		await flushQueuedAcPowerConfigReconcile({ host, nowMs: now });
		assert.equal(host.config.ac_u1_estimated_power_w, 850); // Admin noch alt
		const learned = resolveConsumerEffectivePowerW(stats, 850, now);
		assert.equal(learned.source, "learned");
		assert.ok(Math.abs(learned.powerW - 727) <= 15);
		assert.notEqual(learned.powerW, 850);
	});

	it("Restore blocks flush even in Dryrun", async () => {
		resetAcPowerReconcileMemoryForTests();
		resetRestoreBarrierForTest();
		setRestoreInProgress(true);
		try {
			const now = Date.parse("2026-08-08T12:00:00.000Z");
			const stats = daysAround(727, AC_POWER_RECONCILE_MIN_SAMPLE_DAYS, now, 6);
			const host = hostWithMode("dryrun", { ac_u1_estimated_power_w: 850 });
			queueAcPowerConfigReconcile({
				unitIndex: 1,
				configPowerW: 850,
				consumerStats: stats,
				nowMs: now,
			});
			const flush = await flushQueuedAcPowerConfigReconcile({ host, nowMs: now });
			assert.equal(flush.wrote, false);
			assert.match(flush.reasonDe, /Restore/i);
			assert.equal(host.updateConfigCalls, 0);
		} finally {
			resetRestoreBarrierForTest();
		}
	});
});
