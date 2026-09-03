"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const buffer_1 = require("./buffer");
const config_1 = require("./config");
const learned_power_1 = require("./learned_power");
const config = (0, config_1.acUnitStatsFromConfig)({ ac_u1_enabled: true, ac_u1_stats_enabled: true }, 1);
(0, node_test_1.describe)("consumer stats — Climate 0-Laufzeit-Tage", () => {
    (0, node_test_1.it)("echter 0-Laufzeit-Tag bei verfügbarem Modus und Raumdaten wird persistiert", () => {
        const base = Date.parse("2026-08-30T10:00:00");
        let entry = (0, buffer_1.emptyConsumerEntry)("air_conditioning.unit_1", base);
        entry = (0, buffer_1.ingestConsumerStatsTick)(entry, {
            consumerKey: "air_conditioning.unit_1",
            nowMs: base + 5_000,
            deviceActive: false,
            countable: false,
            measuredPowerW: null,
            commandedPowerW: 0,
            zeroRuntimeEvaluable: true,
            modesAvailable: ["cooling"],
            roomDataOk: true,
        }, config);
        const rec = (0, buffer_1.dayRecordFromEntry)(entry);
        strict_1.default.ok(rec);
        strict_1.default.equal(rec.runtimeSec, 0);
        strict_1.default.equal(rec.energyKwh, 0);
        strict_1.default.equal(rec.zeroRuntimeEvaluable, true);
        strict_1.default.deepEqual(rec.modesAvailable, ["cooling"]);
    });
    (0, node_test_1.it)("deaktivierter Modus / Unit erzeugt kein künstliches 0-Bedarf-Sample", () => {
        const base = Date.parse("2026-08-30T10:00:00");
        let entry = (0, buffer_1.emptyConsumerEntry)("air_conditioning.unit_1", base);
        entry = (0, buffer_1.ingestConsumerStatsTick)(entry, {
            consumerKey: "air_conditioning.unit_1",
            nowMs: base + 5_000,
            deviceActive: false,
            countable: false,
            measuredPowerW: null,
            commandedPowerW: 0,
            zeroRuntimeEvaluable: false,
            roomDataOk: false,
        }, config);
        strict_1.default.equal((0, buffer_1.dayRecordFromEntry)(entry), null);
    });
    (0, node_test_1.it)("unzureichende Raumdaten erzeugen kein 0-Sample", () => {
        const base = Date.parse("2026-08-30T10:00:00");
        let entry = (0, buffer_1.emptyConsumerEntry)("air_conditioning.unit_1", base);
        entry = (0, buffer_1.ingestConsumerStatsTick)(entry, {
            consumerKey: "air_conditioning.unit_1",
            nowMs: base + 5_000,
            deviceActive: false,
            countable: false,
            measuredPowerW: null,
            commandedPowerW: 0,
            zeroRuntimeEvaluable: true,
            modesAvailable: ["cooling"],
            roomDataOk: false,
        }, config);
        strict_1.default.equal((0, buffer_1.dayRecordFromEntry)(entry), null);
    });
    (0, node_test_1.it)("0-Runtime-Tage beeinflussen Power-Learning und medianRuntime nicht", () => {
        const now = Date.parse("2026-08-30T12:00:00");
        const entry = (0, buffer_1.emptyConsumerEntry)("air_conditioning.unit_1", now);
        for (let i = 0; i < 5; i++) {
            const key = `2026-08-${String(20 + i).padStart(2, "0")}`;
            entry.days[key] = {
                dateKey: key,
                runtimeSec: 7200,
                energyKwh: 1.44,
                lastTickMs: now,
            };
        }
        entry.days["2026-08-29"] = {
            dateKey: "2026-08-29",
            runtimeSec: 0,
            energyKwh: 0,
            lastTickMs: now,
            zeroRuntimeEvaluable: true,
            modesAvailable: ["cooling"],
            roomDataOk: true,
        };
        const metrics = (0, learned_power_1.collectRecentDayMetrics)(entry, now);
        strict_1.default.equal(metrics.runtimeSecs.length, 5);
        strict_1.default.equal(metrics.powerWs.length, 5);
        const learned = (0, learned_power_1.resolveConsumerEffectivePowerW)(entry, 700, now);
        strict_1.default.equal(learned.source, "learned");
        strict_1.default.equal(learned.powerW, 720);
        strict_1.default.equal(learned.sampleDays, 5);
    });
    (0, node_test_1.it)("Rollover persistiert 0-Tag und setzt Tagesflags zurück", () => {
        const day1 = Date.parse("2026-08-30T23:59:50");
        const day2 = Date.parse("2026-08-31T00:00:10");
        let entry = (0, buffer_1.emptyConsumerEntry)("air_conditioning.unit_1", day1);
        entry = (0, buffer_1.ingestConsumerStatsTick)(entry, {
            consumerKey: "air_conditioning.unit_1",
            nowMs: day1,
            deviceActive: false,
            countable: false,
            measuredPowerW: null,
            commandedPowerW: 0,
            zeroRuntimeEvaluable: true,
            modesAvailable: ["cooling", "dehumidify"],
            roomDataOk: true,
        }, config);
        entry = (0, buffer_1.ingestConsumerStatsTick)(entry, {
            consumerKey: "air_conditioning.unit_1",
            nowMs: day2,
            deviceActive: false,
            countable: false,
            measuredPowerW: null,
            commandedPowerW: 0,
        }, config);
        strict_1.default.ok(entry.days["2026-08-30"]);
        strict_1.default.equal(entry.days["2026-08-30"].runtimeSec, 0);
        strict_1.default.equal(entry.days["2026-08-30"].zeroRuntimeEvaluable, true);
        strict_1.default.equal(entry.todayZeroRuntimeEvaluable, false);
        strict_1.default.equal(entry.todayRoomDataOk, false);
    });
});
