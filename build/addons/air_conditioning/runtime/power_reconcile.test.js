"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const buffer_1 = require("../../../learning/consumer_stats/buffer");
const learned_power_1 = require("../../../learning/consumer_stats/learned_power");
const tree_paths_1 = require("../../../tree_paths");
const barrier_1 = require("../../../restore/barrier");
const power_reconcile_1 = require("./power_reconcile");
function daysAround(medianW, n, nowMs, jitterW = 5) {
    const entry = (0, buffer_1.emptyConsumerEntry)("air_conditioning.unit_1", nowMs);
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
function hostWithMode(mode, config) {
    const states = new Map([[tree_paths_1.GLOBAL.executionMode, mode]]);
    return {
        config,
        updateConfigCalls: 0,
        async updateConfig(next) {
            this.updateConfigCalls += 1;
            this.config = { ...next };
        },
        async getStateAsync(id) {
            const ts = Date.now();
            if (!states.has(id)) {
                return { val: null, ack: true, ts, lc: ts, from: "test" };
            }
            return {
                val: states.get(id),
                ack: true,
                ts,
                lc: ts,
                from: "test",
            };
        },
        setMode(next) {
            states.set(tree_paths_1.GLOBAL.executionMode, next);
        },
        log: { info: () => undefined, debug: () => undefined },
    };
}
(0, node_test_1.describe)("AC Learning → Config power reconcile", () => {
    (0, node_test_1.it)("Unit 1/2 stable learning evaluates shouldWrite", () => {
        const now = Date.parse("2026-08-08T12:00:00.000Z");
        const d1 = (0, power_reconcile_1.evaluateAcPowerConfigReconcile)({
            configPowerW: 850,
            consumerStats: daysAround(727, power_reconcile_1.AC_POWER_RECONCILE_MIN_SAMPLE_DAYS, now, 8),
            nowMs: now,
        });
        const d2 = (0, power_reconcile_1.evaluateAcPowerConfigReconcile)({
            configPowerW: 700,
            consumerStats: daysAround(715, power_reconcile_1.AC_POWER_RECONCILE_MIN_SAMPLE_DAYS, now, 4),
            nowMs: now,
        });
        strict_1.default.equal(d1.shouldWrite, true);
        strict_1.default.equal(d2.shouldWrite, true);
    });
    (0, node_test_1.it)("Global Live + stable learning → pending, no updateConfig", async () => {
        (0, power_reconcile_1.resetAcPowerReconcileMemoryForTests)();
        (0, barrier_1.resetRestoreBarrierForTest)();
        const now = Date.parse("2026-08-08T12:00:00.000Z");
        const stats = daysAround(727, power_reconcile_1.AC_POWER_RECONCILE_MIN_SAMPLE_DAYS, now, 6);
        const host = hostWithMode("live", { ac_u1_estimated_power_w: 850 });
        const q = (0, power_reconcile_1.queueAcPowerConfigReconcile)({
            unitIndex: 1,
            configPowerW: 850,
            consumerStats: stats,
            nowMs: now,
        });
        strict_1.default.equal(q.queued, true);
        strict_1.default.equal((0, power_reconcile_1.getPendingAcPowerReconcileForTests)().size, 1);
        const flush = await (0, power_reconcile_1.flushQueuedAcPowerConfigReconcile)({ host, nowMs: now });
        strict_1.default.equal(flush.wrote, false);
        strict_1.default.equal(flush.deferred, true);
        strict_1.default.match(flush.reasonDe, /Global Live/i);
        strict_1.default.equal(host.updateConfigCalls, 0);
        strict_1.default.equal((0, power_reconcile_1.getPendingAcPowerReconcileForTests)().size, 1);
        strict_1.default.equal(host.config.ac_u1_estimated_power_w, 850);
    });
    (0, node_test_1.it)("Live→Dryrun flushes pending once batched", async () => {
        (0, power_reconcile_1.resetAcPowerReconcileMemoryForTests)();
        (0, barrier_1.resetRestoreBarrierForTest)();
        const now = Date.parse("2026-08-08T12:00:00.000Z");
        const s1 = daysAround(727, power_reconcile_1.AC_POWER_RECONCILE_MIN_SAMPLE_DAYS, now, 6);
        const s2 = daysAround(715, power_reconcile_1.AC_POWER_RECONCILE_MIN_SAMPLE_DAYS, now, 4);
        const host = hostWithMode("live", {
            ac_u1_estimated_power_w: 850,
            ac_u2_estimated_power_w: 700,
        });
        (0, power_reconcile_1.queueAcPowerConfigReconcile)({
            unitIndex: 1,
            configPowerW: 850,
            consumerStats: s1,
            nowMs: now,
        });
        (0, power_reconcile_1.queueAcPowerConfigReconcile)({
            unitIndex: 2,
            configPowerW: 700,
            consumerStats: s2,
            nowMs: now,
        });
        strict_1.default.equal((await (0, power_reconcile_1.flushQueuedAcPowerConfigReconcile)({ host, nowMs: now })).wrote, false);
        strict_1.default.equal(host.updateConfigCalls, 0);
        host.setMode("dryrun");
        const flush = await (0, power_reconcile_1.flushQueuedAcPowerConfigReconcile)({ host, nowMs: now + 1000 });
        strict_1.default.equal(flush.wrote, true);
        strict_1.default.equal(host.updateConfigCalls, 1);
        strict_1.default.ok(flush.units.includes(1) && flush.units.includes(2));
        strict_1.default.ok(Math.abs(Number(host.config.ac_u1_estimated_power_w) - 727) <= 15);
        strict_1.default.ok(Math.abs(Number(host.config.ac_u2_estimated_power_w) - 715) <= 10);
        strict_1.default.equal((0, power_reconcile_1.getPendingAcPowerReconcileForTests)().size, 0);
    });
    (0, node_test_1.it)("Config == Median after write → no second write", async () => {
        (0, power_reconcile_1.resetAcPowerReconcileMemoryForTests)();
        (0, barrier_1.resetRestoreBarrierForTest)();
        const now = Date.parse("2026-08-08T12:00:00.000Z");
        const stats = daysAround(727, power_reconcile_1.AC_POWER_RECONCILE_MIN_SAMPLE_DAYS, now, 6);
        const host = hostWithMode("dryrun", { ac_u1_estimated_power_w: 850 });
        (0, power_reconcile_1.queueAcPowerConfigReconcile)({
            unitIndex: 1,
            configPowerW: 850,
            consumerStats: stats,
            nowMs: now,
        });
        const first = await (0, power_reconcile_1.flushQueuedAcPowerConfigReconcile)({ host, nowMs: now });
        strict_1.default.equal(first.wrote, true);
        strict_1.default.equal(host.updateConfigCalls, 1);
        // Neuer Start / erneuter Tick mit Config=Median
        (0, power_reconcile_1.resetAcPowerReconcileMemoryForTests)();
        const cfg = Number(host.config.ac_u1_estimated_power_w);
        const q = (0, power_reconcile_1.queueAcPowerConfigReconcile)({
            unitIndex: 1,
            configPowerW: cfg,
            consumerStats: stats,
            nowMs: now + 60_000,
        });
        strict_1.default.equal(q.queued, false);
        const second = await (0, power_reconcile_1.flushQueuedAcPowerConfigReconcile)({ host, nowMs: now + 60_000 });
        strict_1.default.equal(second.wrote, false);
        strict_1.default.equal(host.updateConfigCalls, 1);
    });
    (0, node_test_1.it)("Planner/Runtime uses learned power while Config pending (Global Live)", async () => {
        (0, power_reconcile_1.resetAcPowerReconcileMemoryForTests)();
        (0, barrier_1.resetRestoreBarrierForTest)();
        const now = Date.parse("2026-08-08T12:00:00.000Z");
        const stats = daysAround(727, power_reconcile_1.AC_POWER_RECONCILE_MIN_SAMPLE_DAYS, now, 6);
        const host = hostWithMode("live", { ac_u1_estimated_power_w: 850 });
        (0, power_reconcile_1.queueAcPowerConfigReconcile)({
            unitIndex: 1,
            configPowerW: 850,
            consumerStats: stats,
            nowMs: now,
        });
        await (0, power_reconcile_1.flushQueuedAcPowerConfigReconcile)({ host, nowMs: now });
        strict_1.default.equal(host.config.ac_u1_estimated_power_w, 850); // Admin noch alt
        const learned = (0, learned_power_1.resolveConsumerEffectivePowerW)(stats, 850, now);
        strict_1.default.equal(learned.source, "learned");
        strict_1.default.ok(Math.abs(learned.powerW - 727) <= 15);
        strict_1.default.notEqual(learned.powerW, 850);
    });
    (0, node_test_1.it)("Restore blocks flush even in Dryrun", async () => {
        (0, power_reconcile_1.resetAcPowerReconcileMemoryForTests)();
        (0, barrier_1.resetRestoreBarrierForTest)();
        (0, barrier_1.setRestoreInProgress)(true);
        try {
            const now = Date.parse("2026-08-08T12:00:00.000Z");
            const stats = daysAround(727, power_reconcile_1.AC_POWER_RECONCILE_MIN_SAMPLE_DAYS, now, 6);
            const host = hostWithMode("dryrun", { ac_u1_estimated_power_w: 850 });
            (0, power_reconcile_1.queueAcPowerConfigReconcile)({
                unitIndex: 1,
                configPowerW: 850,
                consumerStats: stats,
                nowMs: now,
            });
            const flush = await (0, power_reconcile_1.flushQueuedAcPowerConfigReconcile)({ host, nowMs: now });
            strict_1.default.equal(flush.wrote, false);
            strict_1.default.match(flush.reasonDe, /Restore/i);
            strict_1.default.equal(host.updateConfigCalls, 0);
        }
        finally {
            (0, barrier_1.resetRestoreBarrierForTest)();
        }
    });
});
